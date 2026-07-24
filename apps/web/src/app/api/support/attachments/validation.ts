import { MAX_TICKET_ATTACHMENT_BYTES } from "@repo/shared/support/schemas";
import sharp, { type Metadata } from "sharp";

export const MAX_TICKET_IMAGE_BYTES = MAX_TICKET_ATTACHMENT_BYTES;
export const MAX_TICKET_IMAGE_PIXELS = 40_000_000;

const IMAGE_FORMATS = {
  jpeg: { contentType: "image/jpeg", extension: "jpg" },
  png: { contentType: "image/png", extension: "png" },
  webp: { contentType: "image/webp", extension: "webp" },
} as const;

export class TicketImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketImageValidationError";
  }
}

function sanitizeFileName(name: string) {
  const sanitized = Array.from(name)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
  return (sanitized || "image").slice(0, 255);
}

export function canReadTicketAttachment(params: {
  sessionUserId: string;
  uploaderId: string;
  messageId: string | null;
  ticketUserId: string | null;
  isAdmin: boolean;
}) {
  if (params.isAdmin) return true;
  if (params.messageId) return params.ticketUserId === params.sessionUserId;
  return params.uploaderId === params.sessionUserId;
}

export async function validateTicketImageUpload(file: File) {
  if (file.size <= 0) {
    throw new TicketImageValidationError("图片不能为空");
  }
  if (file.size > MAX_TICKET_IMAGE_BYTES) {
    throw new TicketImageValidationError("单张图片不能超过 5MB");
  }

  const data = Buffer.from(await file.arrayBuffer());
  let metadata: Metadata;
  try {
    metadata = await sharp(data, {
      limitInputPixels: MAX_TICKET_IMAGE_PIXELS,
    }).metadata();
  } catch {
    throw new TicketImageValidationError("图片文件无效或尺寸过大");
  }

  const format = metadata.format as keyof typeof IMAGE_FORMATS | undefined;
  const imageType = format ? IMAGE_FORMATS[format] : undefined;
  if (!imageType || !metadata.width || !metadata.height) {
    throw new TicketImageValidationError("仅支持 PNG、JPEG 和 WebP 图片");
  }
  if (metadata.width * metadata.height > MAX_TICKET_IMAGE_PIXELS) {
    throw new TicketImageValidationError("图片像素尺寸过大");
  }

  return {
    data,
    extension: imageType.extension,
    contentType: imageType.contentType,
    fileName: sanitizeFileName(file.name),
    size: file.size,
  };
}
