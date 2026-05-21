import path from "node:path";
import { getStorageProvider } from "@repo/shared/storage/providers";
import type { ChatHistoryMessage, ImageInputFile } from "./types";

export type WebHistoryImageReference = {
  imageUrl: string;
  fileName: string;
  sourceId: string;
};

type StorageImageReference = {
  bucket: string;
  key: string;
  extension: string;
};

type DownloadWebHistoryImageReferenceOptions = {
  signal?: AbortSignal;
  readStorageImage?: (reference: StorageImageReference) => Promise<Buffer>;
};

function isUsableHistoryImageUrl(url: string) {
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("/api/storage/") ||
    url.includes("/api/storage/")
  );
}

function parseStorageImageUrl(imageUrl: string) {
  try {
    const parsed = new URL(imageUrl, "http://localhost");
    if (!parsed.pathname.includes("/api/storage/")) return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const storageIndex = segments.indexOf("storage");
    if (storageIndex < 0) return null;

    const bucket = segments[storageIndex + 1];
    const keySegments = segments.slice(storageIndex + 2);
    if (!bucket || keySegments.length === 0) return null;

    return {
      bucket,
      key: keySegments.map((segment) => decodeURIComponent(segment)).join("/"),
      extension: path.extname(parsed.pathname).toLowerCase(),
    };
  } catch {
    return null;
  }
}

function mimeTypeFromExtension(extension: string) {
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/png";
  }
}

function getActiveHistoryVariantImageUrl(message: ChatHistoryMessage) {
  const variants = message.variants || [];
  const variant = variants[message.activeVariant || 0] || variants[0];
  return variant?.imageUrl;
}

export function getLatestWebHistoryImageReference(
  history: ChatHistoryMessage[] | undefined
): WebHistoryImageReference | null {
  for (let index = (history || []).length - 1; index >= 0; index--) {
    const message = history?.[index];
    if (!message || message.role !== "assistant" || message.error) continue;

    const imageUrl = getActiveHistoryVariantImageUrl(message);
    if (!imageUrl || !isUsableHistoryImageUrl(imageUrl)) continue;

    return {
      imageUrl,
      fileName: `web-history-assistant-${index + 1}`,
      sourceId: imageUrl,
    };
  }

  return null;
}

export async function downloadWebHistoryImageReference(
  reference: WebHistoryImageReference,
  options?: DownloadWebHistoryImageReferenceOptions
): Promise<ImageInputFile> {
  const storageReference = parseStorageImageUrl(reference.imageUrl);
  if (storageReference) {
    const data = options?.readStorageImage
      ? await options.readStorageImage(storageReference)
      : await (async () => {
          const storage = await getStorageProvider();
          return storage.getObject(storageReference.key, storageReference.bucket);
        })();
    const type = mimeTypeFromExtension(storageReference.extension);
    const extension = type === "image/jpeg" ? "jpg" : type.slice(6);
    return {
      data,
      name: reference.fileName.endsWith(`.${extension}`)
        ? reference.fileName
        : `${reference.fileName}.${extension}`,
      type,
      url: reference.imageUrl,
    };
  }

  const response = await fetch(reference.imageUrl, { signal: options?.signal });
  if (!response.ok) {
    throw new Error(
      `ChatGPT Web history image download failed: HTTP ${response.status}`
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const mimeType = contentType.split(";")[0]?.trim() || "";
  const type = mimeType.startsWith("image/") ? mimeType : "image/png";
  const extension =
    type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";

  return {
    data: Buffer.from(await response.arrayBuffer()),
    name: reference.fileName.endsWith(`.${extension}`)
      ? reference.fileName
      : `${reference.fileName}.${extension}`,
    type,
    url: reference.imageUrl,
  };
}
