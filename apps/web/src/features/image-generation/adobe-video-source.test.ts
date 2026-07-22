import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { prepareAdobeVideoSourceImage } from "./adobe-video-source";

describe("prepareAdobeVideoSourceImage", () => {
  it("按目标尺寸 cover 居中裁剪并输出 PNG", async () => {
    const source = await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 4,
        background: { r: 20, g: 80, b: 160, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();

    const result = await prepareAdobeVideoSourceImage(source, {
      width: 1280,
      height: 720,
    });
    const metadata = await sharp(result.data).metadata();

    expect(result.type).toBe("image/png");
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(1280);
    expect(metadata.height).toBe(720);
    expect(metadata.hasAlpha).toBe(false);
  });

  it("拒绝空图片", async () => {
    await expect(
      prepareAdobeVideoSourceImage(Buffer.alloc(0), {
        width: 1280,
        height: 720,
      })
    ).rejects.toThrow("video source image is empty");
  });
});
