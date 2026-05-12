import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { runImageGenerationForUser } from "@/features/image-generation/operations";
import {
  parseImageSize,
  validateImageSize,
} from "@/features/image-generation/resolution";
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

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
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
    process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL;
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

    const generationId = randomUUID();
    const moderationImages = await uploadModerationImages(
      session.user.id,
      generationId,
      sourceFiles
    );
    try {
      const result = await runImageGenerationForUser({
        mode: "edit",
        userId: session.user.id,
        generationId,
        prompt,
        size: displaySize || size,
        model,
        quality,
        images: await Promise.all(
          sourceFiles.map((file, index) =>
            toImageInput(file, { publicUrl: moderationImages?.[index]?.url })
          )
        ),
        mask:
          maskFile instanceof File ? await toImageInput(maskFile) : undefined,
      });

      return NextResponse.json(result);
    } finally {
      await deleteModerationImages(moderationImages);
    }
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to edit image."
    );
  }
});
