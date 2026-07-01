/**
 * 出图分辨率校准。
 *
 * 职责：上游（尤其 codex）常返回分辨率明显低于请求的图。当实际边长 < 目标边长的 2/3
 *   时，用超分模型（Real-ESRGAN）放大并增强细节，再按比例缩到目标边长（不裁剪、不改
 *   宽高比，保全画面内容）；其余情况原样返回（不做 sharp 裁剪/补边校准）。
 *
 * 使用方：image-generation/operations.ts 存图函数，落库前。
 * 关键依赖：super-resolution.ts（Real-ESRGAN onnx）、sharp。
 *
 * 设计：决策（是否需超分）是纯函数 shouldSuperResolve，便于 DB-free 单测；实际放大/
 *   缩放有副作用（CPU + IO），由 calibrateImageResolution 编排。失败时回退原图（不阻断出图）。
 */
import sharp, { type Sharp } from "sharp";

import { logWarn } from "@repo/shared/logger";

import { parseImageSize } from "./resolution";
import { superResolve } from "./super-resolution";

// 触发阈值：实际较长边 < 目标较长边的此比例时才超分。2/3 为暂定标准。
export const SUPER_RESOLUTION_TRIGGER_RATIO = 2 / 3;

/**
 * 纯决策：给定实际与目标尺寸，是否需要超分放大。
 *
 * 判据：实际较长边 < 目标较长边 × 比例（默认 2/3）。两者任一不可用时返回 false。
 */
export function shouldSuperResolve(
  actual: { width: number; height: number } | null | undefined,
  target: { width: number; height: number } | null | undefined,
  ratio: number = SUPER_RESOLUTION_TRIGGER_RATIO
): boolean {
  if (!actual || !target) return false;
  const actualEdge = Math.max(actual.width, actual.height);
  const targetEdge = Math.max(target.width, target.height);
  if (actualEdge <= 0 || targetEdge <= 0) return false;
  return actualEdge < targetEdge * ratio;
}

/**
 * 按需超分校准分辨率。
 *
 * @param image 上游返回的图片字节
 * @param requestedSize 请求尺寸字符串（如 "1024x1024"，"auto" 等无法解析时不校准）
 * @returns { buffer, applied }：applied=true 表示做了超分；失败/不需要时返回原图 applied=false
 *
 * 边界：仅在 shouldSuperResolve 为真时超分；超分后按比例（fit:inside，不裁剪）缩到目标
 *   较长边并保留原图格式。任何异常都回退原图，不阻断出图管线。
 */
export async function calibrateImageResolution(
  image: Buffer,
  requestedSize: string
): Promise<{ buffer: Buffer; applied: boolean }> {
  const target = parseImageSize(requestedSize);
  if (!target) return { buffer: image, applied: false };

  try {
    const meta = await sharp(image).metadata();
    if (!meta.width || !meta.height) return { buffer: image, applied: false };
    const actual = { width: meta.width, height: meta.height };
    if (!shouldSuperResolve(actual, target)) {
      return { buffer: image, applied: false };
    }

    const upscaled = await superResolve(image);
    const upMeta = await sharp(upscaled).metadata();
    const targetEdge = Math.max(target.width, target.height);
    const upEdge = Math.max(upMeta.width ?? 0, upMeta.height ?? 0);

    // 仅当超分结果超过目标边长时缩回（保比例、不裁剪）；不足则保留 4 倍结果（不做模糊放大）。
    const format = meta.format;
    let pipeline = sharp(upscaled);
    if (upEdge > targetEdge) {
      pipeline = pipeline.resize(target.width, target.height, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    // 保留原图格式，避免改变后续 resolveStoredImageFormat 的判定。
    const calibrated = await encodeAs(pipeline, format).toBuffer();
    return { buffer: calibrated, applied: true };
  } catch (error) {
    logWarn("分辨率超分校准失败，回退原图", {
      error: error instanceof Error ? error.message : String(error),
      requestedSize,
    });
    return { buffer: image, applied: false };
  }
}

/** 按原图格式编码，未知格式回退 png。 */
function encodeAs(pipeline: Sharp, format: string | undefined): Sharp {
  switch (format) {
    case "jpeg":
    case "jpg":
      return pipeline.jpeg();
    case "webp":
      return pipeline.webp();
    case "avif":
      return pipeline.avif();
    default:
      return pipeline.png();
  }
}
