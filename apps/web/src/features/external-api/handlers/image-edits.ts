import { withApiLogging } from "@repo/shared/api-logger";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import {
  createExternalImageStreamResponse,
  createJsonKeepAliveResponse,
  getImageBase64,
  getPublicImageUrl,
  openAIImageError,
  toOpenAIImageData,
  toOpenAIErrorPayload,
  wantsImageStreamResponse,
} from "@/features/external-api/images";
import { runImageGenerationForUser } from "@/features/image-generation/operations";
import {
  getImageModel,
  parseImageSize,
  validateImageSize,
} from "@/features/image-generation/resolution";
import type {
  ImageInputFile,
  ImageQuality,
  PartialImageResult,
} from "@/features/image-generation/types";

const MAX_EDIT_IMAGES = 16;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_EDIT_REQUEST_BYTES = 75 * 1024 * 1024;
const MODERATION_UPLOAD_URL_EXPIRES = 600;
const MAX_BATCH_COUNT = 10;
const VALID_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const VALID_QUALITIES = new Set<ImageQuality>([
  "auto",
  "low",
  "medium",
  "high",
]);

function getText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getCount(formData: FormData) {
  const value = getText(formData, "n") || getText(formData, "count");
  if (!value) return 1;
  if (!/^\d+$/.test(value)) {
    throw new Error("n must be an integer.");
  }
  const count = Number(value);
  if (count < 1 || count > MAX_BATCH_COUNT) {
    throw new Error(`n must be between 1 and ${MAX_BATCH_COUNT}.`);
  }
  return count;
}

function getBoolean(formData: FormData, key: string) {
  const value = getText(formData, key).toLowerCase();
  return value === "true" || value === "1";
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
  if (!images?.length) return;

  const storage = await getStorageProvider();
  await Promise.allSettled(
    images.map((image) => storage.deleteObject(image.key, image.bucket))
  );
}

async function toStreamCompletedPayload(
  request: Request,
  result: Awaited<ReturnType<typeof runImageGenerationForUser>>,
  responseFormat: "url" | "b64_json",
  index: number
) {
  const image =
    responseFormat === "b64_json"
      ? { b64_json: await getImageBase64(request, result.imageUrl) }
      : { url: getPublicImageUrl(request, result.imageUrl) };

  return {
    type: "image_edit.completed",
    index,
    generation_id: result.generationId,
    generationId: result.generationId,
    model: result.model,
    size: result.size,
    revised_prompt: result.revisedPrompt,
    credits_consumed: result.creditsConsumed,
    ...image,
    data: [
      {
        ...image,
        revised_prompt: result.revisedPrompt,
      },
    ],
  };
}

function toPartialPayload(image: PartialImageResult, index: number) {
  return {
    type: "image_edit.partial_image",
    index,
    partial_image_index: image.partialImageIndex,
    b64_json: image.imageBase64,
    url: image.imageUrl,
  };
}

function invalidImageModelError() {
  return openAIImageError(
    "Unsupported model for /v1/images/edits. Use a gpt-image-* model."
  );
}

export const postExternalImageEdits = withApiLogging(
  async (request: NextRequest) => {
    const auth = await authenticateExternalApiRequest(request);
    if (!auth) {
      return openAIImageError(
        "Invalid or missing API key",
        401,
        "invalid_api_key"
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return openAIImageError(
        "Upload is too large or incomplete. Use smaller source images and try again.",
        413
      );
    }

    const prompt = getText(formData, "prompt");
    if (!prompt) {
      return openAIImageError("Prompt is required.");
    }
    if (prompt.length > 4000) {
      return openAIImageError("Prompt exceeds the 4000 character limit.");
    }
    const apiPrompt =
      getText(formData, "apiPrompt") ||
      getText(formData, "api_prompt") ||
      undefined;
    if (apiPrompt && apiPrompt.length > 8000) {
      return openAIImageError(
        "Context prompt exceeds the 8000 character limit."
      );
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
        return openAIImageError(sizeCheck.message);
      }
    }

    const displaySize =
      getText(formData, "display_size") || getText(formData, "displaySize");
    if (displaySize && !parseImageSize(displaySize)) {
      return openAIImageError("Invalid display size.");
    }

    const qualityValue = getText(formData, "quality") || "auto";
    if (!VALID_QUALITIES.has(qualityValue as ImageQuality)) {
      return openAIImageError("Invalid quality.");
    }
    const quality = qualityValue as ImageQuality;

    let count = 1;
    try {
      count = getCount(formData);
    } catch (error) {
      return openAIImageError(
        error instanceof Error ? error.message : "Invalid n."
      );
    }

    const responseFormat =
      getText(formData, "response_format") === "b64_json" ? "b64_json" : "url";
    const model = getImageModel(getText(formData, "model") || undefined);
    if (!model) {
      return invalidImageModelError();
    }
    const sourceFiles = getImageFiles(formData);
    if (sourceFiles.length === 0) {
      return openAIImageError("At least one source image is required.");
    }
    if (sourceFiles.length > MAX_EDIT_IMAGES) {
      return openAIImageError(
        `No more than ${MAX_EDIT_IMAGES} images are allowed.`
      );
    }

    try {
      for (const file of sourceFiles) {
        validateImageFile(file);
      }

      const maskFile = formData.get("mask");
      if (maskFile !== null && !(maskFile instanceof File)) {
        return openAIImageError("Mask must be a PNG file.");
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
        return openAIImageError(
          `Total upload size must be no more than ${MAX_EDIT_REQUEST_BYTES / 1024 / 1024}MB.`,
          413
        );
      }

      const batchId = randomUUID();
      const moderationImages = await uploadModerationImages(
        auth.userId,
        batchId,
        sourceFiles
      );

      const buildImages = async () =>
        await Promise.all(
          sourceFiles.map((file, index) =>
            toImageInput(file, { publicUrl: moderationImages?.[index]?.url })
          )
        );

      const buildMask = async () =>
        maskFile instanceof File ? await toImageInput(maskFile) : undefined;

      const runEdit = async (
        generationId: string,
        onPartialImage?: Parameters<typeof runImageGenerationForUser>[1]
      ) =>
        await runImageGenerationForUser(
          {
            mode: "edit",
            userId: auth.userId,
            generationId,
            prompt,
            apiPrompt,
            promptOptimization,
            size: displaySize || size,
            model,
            quality,
            n: 1,
            images: await buildImages(),
            mask: await buildMask(),
          },
          onPartialImage
        );

      const useStreamResponse = wantsImageStreamResponse(
        request,
        getBoolean(formData, "stream")
      );

      if (useStreamResponse) {
        return createExternalImageStreamResponse(async (emit) => {
          try {
            for (let index = 0; index < count; index++) {
              const result = await runEdit(randomUUID(), {
                onPartialImage: async (image) => {
                  await emit({
                    event: "image_edit.partial_image",
                    data: toPartialPayload(image, index),
                  });
                },
              });

              if (result.error) {
                await emit({
                  event: "error",
                  data: {
                    type: "upstream_error",
                    message: result.error,
                    error: toOpenAIErrorPayload(result.error, {
                      generationId: result.generationId,
                      creditsConsumed: result.creditsConsumed,
                    }).error,
                    generation_id: result.generationId,
                    generationId: result.generationId,
                    credits_consumed: result.creditsConsumed,
                  },
                });
                return;
              }

              await emit({
                event: "image_edit.completed",
                data: await toStreamCompletedPayload(
                  request,
                  result,
                  responseFormat,
                  index
                ),
              });
            }
          } finally {
            await deleteModerationImages(moderationImages);
          }
        });
      }

      return createJsonKeepAliveResponse(async () => {
        try {
          const data = [];
          const created = Math.floor(Date.now() / 1000);

          for (let index = 0; index < count; index++) {
            const result = await runEdit(randomUUID());
            if (result.error) {
              return toOpenAIErrorPayload(result.error, {
                generationId: result.generationId,
                creditsConsumed: result.creditsConsumed,
              });
            }
            data.push(await toOpenAIImageData(request, result, responseFormat));
          }

          return {
            created,
            data,
          };
        } finally {
          await deleteModerationImages(moderationImages);
        }
      });
    } catch (error) {
      return openAIImageError(
        error instanceof Error ? error.message : "Failed to edit image."
      );
    }
  }
);
