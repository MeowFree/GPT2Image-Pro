import { auth } from "@repo/shared/auth";
import { withApiLogging } from "@repo/shared/api-logger";
import { type NextRequest, NextResponse } from "next/server";

import { runImageGenerationForUser } from "@/features/image-generation/operations";
import { DEFAULT_IMAGE_SIZE, validateImageSize } from "@/features/image-generation/resolution";
import type {
  ImageInputFile,
  ImageQuality,
} from "@/features/image-generation/types";

const MAX_EDIT_IMAGES = 16;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
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

async function toImageInput(file: File): Promise<ImageInputFile> {
  return {
    data: Buffer.from(await file.arrayBuffer()),
    name: file.name || "image.png",
    type: file.type || "image/png",
  };
}

export const POST = withApiLogging(async (request: NextRequest) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return errorResponse("Unauthorized", 401);
  }

  const formData = await request.formData();
  const prompt = getText(formData, "prompt");
  if (!prompt) {
    return errorResponse("Prompt is required.");
  }

  if (prompt.length > 4000) {
    return errorResponse("Prompt exceeds the 4000 character limit.");
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

  const model = getText(formData, "model") || undefined;
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

    const result = await runImageGenerationForUser({
      mode: "edit",
      userId: session.user.id,
      prompt,
      size,
      model,
      quality,
      images: await Promise.all(sourceFiles.map(toImageInput)),
      mask: maskFile instanceof File ? await toImageInput(maskFile) : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to edit image."
    );
  }
});
