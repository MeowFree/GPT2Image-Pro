import type { ImageOutputFormat } from "./types";

export const VALID_OUTPUT_FORMATS = new Set<ImageOutputFormat>([
  "png",
  "jpeg",
  "webp",
]);

export function normalizeOutputFormat(
  value?: string | null
): ImageOutputFormat | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "jpg") return "jpeg";
  return VALID_OUTPUT_FORMATS.has(normalized as ImageOutputFormat)
    ? (normalized as ImageOutputFormat)
    : undefined;
}

export function normalizeOutputCompression(
  value?: number | string | null
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

export function getOutputFormatContentType(format: ImageOutputFormat) {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

export function getOutputFormatExtension(format: ImageOutputFormat) {
  return format === "jpeg" ? "jpg" : format;
}

export function detectImageOutputFormatFromBuffer(
  buffer: Buffer
): ImageOutputFormat | undefined {
  if (
    buffer.length >= 8 &&
    buffer.readUInt32BE(0) === 0x89504e47 &&
    buffer.readUInt32BE(4) === 0x0d0a1a0a
  ) {
    return "png";
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return "jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return undefined;
}

export function detectImageOutputFormatFromContentType(
  contentType?: string | null
): ImageOutputFormat | undefined {
  const normalized = (contentType || "").toLowerCase();
  if (normalized.includes("image/png")) return "png";
  if (normalized.includes("image/jpeg") || normalized.includes("image/jpg")) {
    return "jpeg";
  }
  if (normalized.includes("image/webp")) return "webp";
  return undefined;
}
