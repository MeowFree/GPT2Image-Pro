import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { runImageGenerationForUser } from "@/features/image-generation/operations";
import {
  DEFAULT_IMAGE_SIZE,
  validateImageSize,
} from "@/features/image-generation/resolution";
import { getUserApiConfig } from "@/features/image-generation/service";
import { createImageStreamResponse } from "@/features/image-generation/streaming";
import type {
  ImageInputFile,
  ImageModeration,
  ImageQuality,
} from "@/features/image-generation/types";

const MAX_CHAT_IMAGES = 16;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_CHAT_REQUEST_BYTES = 75 * 1024 * 1024;
const MODERATION_UPLOAD_URL_EXPIRES = 600;
const VALID_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const VALID_QUALITIES = new Set<ImageQuality>([
  "auto",
  "low",
  "medium",
  "high",
]);
const VALID_MODERATION = new Set<ImageModeration>(["auto", "low"]);
const MAX_BATCH_COUNT = 10;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getCount(formData: FormData) {
  const value = getText(formData, "count");
  if (!value) return 1;
  if (!/^\d+$/.test(value)) {
    throw new Error("count must be an integer.");
  }
  const count = Number(value);
  if (count < 1 || count > MAX_BATCH_COUNT) {
    throw new Error(`count must be between 1 and ${MAX_BATCH_COUNT}.`);
  }
  return count;
}

function wantsStreamResponse(request: NextRequest, formData: FormData) {
  if (formData.get("stream") === "true") return true;
  return request.headers.get("accept")?.includes("text/event-stream") ?? false;
}

function getImageFiles(formData: FormData) {
  const images: File[] = [];

  for (const [key, value] of formData.entries()) {
    if (
      value instanceof File &&
      (key === "image" || key === "image[]" || key.startsWith("image_"))
    ) {
      images.push(value);
    }
  }

  return images;
}

function validateImageFile(file: File) {
  if (file.size <= 0) {
    throw new Error(`${file.name || "Image"} is empty.`);
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `${file.name || "Image"} exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit.`
    );
  }

  if (!VALID_IMAGE_TYPES.has(file.type)) {
    throw new Error("Reference images must be PNG, JPEG, or WebP files.");
  }
}

async function toImageInput(
  file: File,
  options?: { publicUrl?: string }
): Promise<ImageInputFile> {
  return {
    data: Buffer.from(await file.arrayBuffer()),
    name: file.name || "image.png",
    type: file.type || "image/png",
    url: options?.publicUrl,
  };
}

async function uploadModerationImages(
  userId: string,
  generationId: string,
  files: File[]
) {
  if (files.length === 0) return undefined;

  const publicBaseUrl =
    process.env.ALIYUN_MODERATION_PUBLIC_BASE_URL ||
    process.env.CONTENT_MODERATION_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL;
  if (!process.env.STORAGE_ENDPOINT && !publicBaseUrl) {
    return undefined;
  }

  const storage = await getStorageProvider();
  const bucket =
    process.env.NEXT_PUBLIC_GENERATIONS_BUCKET_NAME || "generations";

  return Promise.all(
    files.map(async (file, index) => {
      const extension =
        file.type === "image/jpeg"
          ? "jpg"
          : file.type === "image/webp"
            ? "webp"
            : "png";
      const key = `${userId}/moderation/${generationId}-${index}.${extension}`;
      await storage.putObject(
        key,
        bucket,
        Buffer.from(await file.arrayBuffer()),
        file.type || "image/png"
      );
      const url = await storage.getSignedUrl(
        key,
        bucket,
        MODERATION_UPLOAD_URL_EXPIRES
      );
      return {
        bucket,
        key,
        url: url.startsWith("http")
          ? url
          : `${publicBaseUrl?.replace(/\/$/, "")}${url}`,
      };
    })
  );
}

async function deleteModerationImages(
  images: Awaited<ReturnType<typeof uploadModerationImages>> | undefined
) {
  if (!images?.length) return;

  const storage = await getStorageProvider();
  await Promise.allSettled(
    images.map((image) => storage.deleteObject(image.key, image.bucket))
  );
}

export const POST = withApiLogging(async (request: NextRequest) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return errorResponse("Unauthorized", 401);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      "Upload is too large or incomplete. Use smaller reference images and try again.",
      413
    );
  }

  const prompt = getText(formData, "prompt");
  if (!prompt) {
    return errorResponse("Prompt is required.");
  }
  if (prompt.length > 4000) {
    return errorResponse("Prompt exceeds the 4000 character limit.");
  }

  const apiPrompt = getText(formData, "apiPrompt") || undefined;
  if (apiPrompt && apiPrompt.length > 8000) {
    return errorResponse("Context prompt exceeds the 8000 character limit.");
  }

  const size = getText(formData, "size") || DEFAULT_IMAGE_SIZE;
  const sizeCheck = validateImageSize(size);
  if (!sizeCheck.valid) {
    return errorResponse(sizeCheck.message);
  }

  const qualityValue = getText(formData, "quality") || "auto";
  if (!VALID_QUALITIES.has(qualityValue as ImageQuality)) {
    return errorResponse("Invalid quality.");
  }
  const quality = qualityValue as ImageQuality;

  const moderationValue = getText(formData, "moderation") || "auto";
  if (!VALID_MODERATION.has(moderationValue as ImageModeration)) {
    return errorResponse("Invalid moderation.");
  }
  const moderation = moderationValue as ImageModeration;

  let count = 1;
  try {
    count = getCount(formData);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Invalid count."
    );
  }

  const model = getText(formData, "model") || undefined;
  const sourceFiles = getImageFiles(formData);
  if (sourceFiles.length > MAX_CHAT_IMAGES) {
    return errorResponse(`No more than ${MAX_CHAT_IMAGES} images are allowed.`);
  }

  try {
    for (const file of sourceFiles) {
      validateImageFile(file);
    }

    const totalUploadSize = sourceFiles.reduce(
      (total, file) => total + file.size,
      0
    );
    if (totalUploadSize > MAX_CHAT_REQUEST_BYTES) {
      return errorResponse(
        `Total upload size must be no more than ${MAX_CHAT_REQUEST_BYTES / 1024 / 1024}MB.`,
        413
      );
    }

    const batchId = randomUUID();
    const moderationImages = await uploadModerationImages(
      session.user.id,
      batchId,
      sourceFiles
    );
    const useStreamResponse =
      wantsStreamResponse(request, formData) &&
      Boolean((await getUserApiConfig(session.user.id))?.useStream);

    const buildImages = async () =>
      await Promise.all(
        sourceFiles.map((file, index) =>
          toImageInput(file, { publicUrl: moderationImages?.[index]?.url })
        )
      );

    const runChat = async (
      generationId: string,
      onPartialImage?: Parameters<typeof runImageGenerationForUser>[1]
    ) =>
      await runImageGenerationForUser(
        {
          mode: "chat",
          userId: session.user.id,
          generationId,
          prompt,
          apiPrompt,
          images: await buildImages(),
          size,
          model,
          quality,
          n: 1,
          moderation,
        },
        onPartialImage
      );

    try {
      if (useStreamResponse) {
        return createImageStreamResponse(async (emit) => {
          try {
            for (let index = 0; index < count; index++) {
              const result = await runChat(randomUUID(), {
                onPartialImage: async (image) => {
                  await emit({
                    type: "partial_image",
                    index,
                    partial_image_index: image.partialImageIndex,
                    b64_json: image.imageBase64,
                    url: image.imageUrl,
                  });
                },
              });

              if (result.error) {
                await emit({
                  type: "error",
                  error: result.error,
                  generationId: result.generationId,
                  creditsConsumed: result.creditsConsumed,
                });
                return null;
              }

              await emit({ type: "completed", ...result });
            }

            return null;
          } finally {
            await deleteModerationImages(moderationImages);
          }
        });
      }

      if (count === 1) {
        const result = await runChat(randomUUID());
        return NextResponse.json(result);
      }

      const results = [];
      for (let index = 0; index < count; index++) {
        const result = await runChat(randomUUID());
        results.push(result);
        if (result.error) break;
      }

      return NextResponse.json({
        results,
        error: results.find((result) => result.error)?.error,
      });
    } finally {
      if (!useStreamResponse) {
        await deleteModerationImages(moderationImages);
      }
    }
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to generate image."
    );
  }
});
