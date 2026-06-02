import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import type { ImageInputFile } from "./types";

function toAbsoluteUrl(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("data:image/")) return url;
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "";
  if (!baseUrl) return null;
  return new URL(url, baseUrl).toString();
}

function getSignedStorageUrl(image: ImageInputFile) {
  try {
    return buildSignedStorageImageUrl(image.storageKey, image.storageBucket);
  } catch {
    return null;
  }
}

export function getInputImageUrl(image: ImageInputFile) {
  const signedStorageUrl = getSignedStorageUrl(image);
  const absoluteSignedStorageUrl = signedStorageUrl
    ? toAbsoluteUrl(signedStorageUrl)
    : null;
  if (absoluteSignedStorageUrl) return absoluteSignedStorageUrl;

  const existingUrl = image.url?.trim();
  const absoluteExistingUrl = existingUrl ? toAbsoluteUrl(existingUrl) : null;
  if (absoluteExistingUrl) return absoluteExistingUrl;

  return `data:${image.type || "image/png"};base64,${image.data.toString(
    "base64"
  )}`;
}
