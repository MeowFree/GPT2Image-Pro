import { generateSignedImageUrl } from "@repo/shared/storage/signed-url";
import type { ImageInputFile } from "./types";

export type GenerationReferenceImage = {
  id: string;
  imageUrl: string;
  storageBucket: string | null;
  storageKey: string | null;
  name: string | null;
  type: string | null;
  sizeBytes: number | null;
  source: string;
  role: string;
  index: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 从存储桶和键名构造带签名的图像访问 URL。
 *
 * generations 桶的 URL 自动附加 HMAC 签名参数（sig + exp），
 * 防止未授权直接访问。avatars 等公开桶不带签名。
 */
export function toStoredImageUrl(
  bucket: string | null | undefined,
  storageKey: string | null | undefined
) {
  if (!storageKey) return null;
  const resolvedBucket = bucket || "generations";
  return generateSignedImageUrl(resolvedBucket, storageKey);
}

export function buildInputImagesMetadata(inputImages: ImageInputFile[]) {
  const images = inputImages.flatMap((image, index) => {
    const storageKey = stringValue(image.storageKey);
    const storageBucket = stringValue(image.storageBucket);
    const storedUrl = toStoredImageUrl(storageBucket, storageKey);
    const imageUrl = storedUrl || stringValue(image.url);
    if (!imageUrl) return [];

    return [
      {
        id: `input-${index + 1}`,
        imageUrl,
        storageBucket,
        storageKey,
        name: image.name || null,
        type: image.type || null,
        sizeBytes: image.data.length,
        source: "upload",
        role: "reference",
        index,
      },
    ];
  });

  return {
    inputImages: {
      images,
      count: inputImages.length,
    },
  };
}

export function extractGenerationReferenceImages(
  metadata: Record<string, unknown> | null | undefined
): GenerationReferenceImage[] {
  const inputImages = isRecord(metadata?.inputImages)
    ? metadata.inputImages
    : null;
  const images = Array.isArray(inputImages?.images) ? inputImages.images : [];

  return images.flatMap((item, fallbackIndex) => {
    if (!isRecord(item)) return [];
    const storageBucket = stringValue(item.storageBucket);
    const storageKey = stringValue(item.storageKey);
    const imageUrl =
      toStoredImageUrl(storageBucket, storageKey) || stringValue(item.imageUrl);
    if (!imageUrl) return [];

    const index = numberValue(item.index) ?? fallbackIndex;
    return [
      {
        id: stringValue(item.id) || `input-${index + 1}`,
        imageUrl,
        storageBucket,
        storageKey,
        name: stringValue(item.name),
        type: stringValue(item.type),
        sizeBytes: numberValue(item.sizeBytes),
        source: stringValue(item.source) || "upload",
        role: stringValue(item.role) || "reference",
        index,
      },
    ];
  });
}

export function extractPromptRepairNotice(
  metadata: Record<string, unknown> | null | undefined
) {
  const repair = isRecord(metadata?.moderationPromptRepair)
    ? metadata.moderationPromptRepair
    : null;
  if (repair?.succeeded !== true) return null;
  return (
    stringValue(repair.notice) ||
    "The original prompt was rejected by safety checks, so this request was generated after additional prompt adjustments."
  );
}
