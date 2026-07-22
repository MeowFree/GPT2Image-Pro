import sharp from "sharp";

/** 按 Adobe 视频目标尺寸等比放大并居中裁剪，统一输出无 alpha 的 PNG。 */
export async function prepareAdobeVideoSourceImage(
  imageBytes: Buffer,
  size: { width: number; height: number }
): Promise<{ data: Buffer; type: "image/png" }> {
  if (!imageBytes.length) throw new Error("video source image is empty");
  if (size.width <= 0 || size.height <= 0) {
    throw new Error("invalid Adobe video target size");
  }

  try {
    const data = await sharp(imageBytes)
      .removeAlpha()
      .resize(size.width, size.height, {
        fit: "cover",
        position: "centre",
        kernel: sharp.kernel.lanczos3,
      })
      .png()
      .toBuffer();
    return { data, type: "image/png" };
  } catch (error) {
    throw new Error(
      `invalid image for Adobe video: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
