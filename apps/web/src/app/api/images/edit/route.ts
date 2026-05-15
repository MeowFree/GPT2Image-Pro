import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { getUserApiConfig } from "@/features/image-generation/service";
import { runImageGenerationForUser } from "@/features/image-generation/operations";
import {
  parseImageSize,
  validateImageSize,
} from "@/features/image-generation/resolution";
import { createImageStreamResponse } from "@/features/image-generation/streaming";
import type {
  ImageInputFile,
  ImageQuality,
} from "@/features/image-generation/types";

const MAX_EDIT_IMAGES = 16;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_EDIT_REQUEST_BYTES = 75 * 1024 * 1024;
const MODERATION_UPLOAD_URL_EXPIRES = 600;
const VALID_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const VALID_QUALITIES = new Set<ImageQuality>([
  "auto",
  "low",
  "medium",
  "high",
]);
const MAX_BATCH_COUNT = 10;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getCount(formData: FormData, key: string) {
  const value = getText(formData, key);
  if (!value) return 1;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${key} must be an integer.`);
  }
  const count = Number(value);
  if (count < 1 || count > MAX_BATCH_COUNT) {
    throw new Error(`${key} must be between 1 and ${MAX_BATCH_COUNT}.`);
  }
  return count;
}

function getOptionalBoolean(formData: FormData, ...keys: string[]) {
  for (const key of keys) {
    const value = getText(formData, key).toLowerCase();
    if (!value) continue;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
  }
  return undefined;
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

function validateImageFile(file: File, options?: { mask?: boolean }) {
  if (file.size <= 0) {
    throw new Error(`${file.name || "Image"} is empty.`);
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `${file.name || "Image"} exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit.`
    );
  }

  if (options?.mask) {
    if (file.type !== "image/png") {
      throw new Error("Mask must be a PNG file.");
    }
    return;
  }

  if (!VALID_IMAGE_TYPES.has(file.type)) {
    throw new Error("Source images must be PNG, JPEG, or WebP files.");
  }
}

function getTotalUploadSize(files: File[], maskFile?: File) {
  return (
    files.reduce((total, file) => total + file.size, 0) + (maskFile?.size || 0)
  );
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
  const publicBaseUrl =
    (await getRuntimeSettingString("ALIYUN_MODERATION_PUBLIC_BASE_URL")) ||
    (await getRuntimeSettingString("CONTENT_MODERATION_PUBLIC_BASE_URL")) ||
    (await getRuntimeSettingString("NEXT_PUBLIC_APP_URL")) ||
    (await getRuntimeSettingString("BETTER_AUTH_URL"));
  if (!(await getRuntimeSettingString("STORAGE_ENDPOINT")) && !publicBaseUrl) {
    return undefined;
  }

  const storage = await getStorageProvider();
  const bucket =
    (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
    "generations";

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
  if (!images?.length) {
    return;
  }

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
      "Upload is too large or incomplete. Use smaller source images and try again.",
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
  const promptOptimization = getOptionalBoolean(
    formData,
    "promptOptimization",
    "prompt_optimization"
  );

  const size = getText(formData, "size") || undefined;
  if (size) {
    const sizeCheck = validateImageSize(size);
    if (!sizeCheck.valid) {
      return errorResponse(sizeCheck.message);
    }
  }

  const qualityValue = getText(formData, "quality") || "auto";
  if (!VALID_QUALITIES.has(qualityValue as ImageQuality)) {
    return errorResponse("Invalid quality.");
  }
  const quality = qualityValue as ImageQuality;
  let count = 1;
  try {
    count = getCount(formData, "count");
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Invalid count."
    );
  }

  const model = getText(formData, "model") || undefined;
  const displaySize = getText(formData, "displaySize") || undefined;
  if (displaySize && !parseImageSize(displaySize)) {
    return errorResponse("Invalid display size.");
  }
  const sourceFiles = getImageFiles(formData);
  if (sourceFiles.length === 0) {
    return errorResponse("At least one source image is required.");
  }

  if (sourceFiles.length > MAX_EDIT_IMAGES) {
    return errorResponse(`No more than ${MAX_EDIT_IMAGES} images are allowed.`);
  }

  try {
    for (const file of sourceFiles) {
      validateImageFile(file);
    }
    const maskFile = formData.get("mask");
    if (maskFile !== null && !(maskFile instanceof File)) {
      return errorResponse("Mask must be a PNG file.");
    }
    if (maskFile instanceof File) {
      validateImageFile(maskFile, { mask: true });
    }
    if (
      getTotalUploadSize(
        sourceFiles,
        maskFile instanceof File ? maskFile : undefined
      ) > MAX_EDIT_REQUEST_BYTES
    ) {
      return errorResponse(
        `Total upload size must be no more than ${MAX_EDIT_REQUEST_BYTES / 1024 / 1024}MB.`,
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

    const runEdit = async (
      generationId: string,
      onPartialImage?: Parameters<typeof runImageGenerationForUser>[1]
    ) =>
      await runImageGenerationForUser(
        {
          mode: "edit",
          userId: session.user.id,
          generationId,
          prompt,
          apiPrompt,
          promptOptimization,
          size: displaySize || size,
          model,
          quality,
          n: 1,
          images: await Promise.all(
            sourceFiles.map((file, index) =>
              toImageInput(file, { publicUrl: moderationImages?.[index]?.url })
            )
          ),
          mask:
            maskFile instanceof File ? await toImageInput(maskFile) : undefined,
        },
        onPartialImage
      );

    try {
      if (useStreamResponse) {
        return createImageStreamResponse(async (emit) => {
          try {
            for (let index = 0; index < count; index++) {
              const result = await runEdit(randomUUID(), {
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
        const result = await runEdit(randomUUID());
        return NextResponse.json(result);
      }

      const results = [];
      for (let index = 0; index < count; index++) {
        const result = await runEdit(randomUUID());
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
      error instanceof Error ? error.message : "Failed to edit image."
    );
  }
});
