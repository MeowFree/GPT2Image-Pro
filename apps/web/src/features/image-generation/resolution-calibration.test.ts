import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("./super-resolution", () => ({
  superResolve: vi.fn(async (image: Buffer) => {
    const metadata = await sharp(image).metadata();
    return sharp(image)
      .resize((metadata.width ?? 1) * 4, (metadata.height ?? 1) * 4)
      .png()
      .toBuffer();
  }),
}));

import {
  calibrateImageResolution,
  getResolutionCalibrationMode,
  shouldSuperResolve,
} from "./resolution-calibration";

describe("shouldSuperResolve（超分触发阈值：实际较长边 < 目标 2/3）", () => {
  it("实际明显偏小（1024 目标，512 实际）→ 触发", () => {
    expect(
      shouldSuperResolve(
        { width: 512, height: 512 },
        { width: 1024, height: 1024 }
      )
    ).toBe(true);
  });

  it("恰好等于 2/3 → 不触发（严格小于）", () => {
    // 2/3 × 1536 = 1024
    expect(
      shouldSuperResolve(
        { width: 1024, height: 1024 },
        { width: 1536, height: 1536 }
      )
    ).toBe(false);
  });

  it("略低于 2/3 → 触发", () => {
    expect(
      shouldSuperResolve(
        { width: 1000, height: 1000 },
        { width: 1536, height: 1536 }
      )
    ).toBe(true);
  });

  it("尺寸达标（实际≥目标）→ 不触发", () => {
    expect(
      shouldSuperResolve(
        { width: 1024, height: 1024 },
        { width: 1024, height: 1024 }
      )
    ).toBe(false);
  });

  it("按较长边判定：1024 目标、长边 768 的非方图 → 不触发（768 > 683）", () => {
    expect(
      shouldSuperResolve(
        { width: 768, height: 512 },
        { width: 1024, height: 1024 }
      )
    ).toBe(false);
  });

  it("4K 目标、2000 实际（< 2731）→ 触发", () => {
    expect(
      shouldSuperResolve(
        { width: 2000, height: 2000 },
        { width: 4096, height: 4096 }
      )
    ).toBe(true);
  });

  it("缺失实际或目标 → 不触发", () => {
    expect(shouldSuperResolve(null, { width: 1024, height: 1024 })).toBe(false);
    expect(shouldSuperResolve({ width: 512, height: 512 }, null)).toBe(false);
  });

  it("零或负尺寸 → 不触发", () => {
    expect(
      shouldSuperResolve({ width: 0, height: 0 }, { width: 1024, height: 1024 })
    ).toBe(false);
  });
});

describe("getResolutionCalibrationMode", () => {
  it("uses super-resolution for a substantial shortfall", () => {
    expect(
      getResolutionCalibrationMode(
        { width: 1024, height: 1024 },
        { width: 2048, height: 2048 }
      )
    ).toBe("super-resolution");
  });

  it("uses a lightweight resize for a smaller shortfall", () => {
    expect(
      getResolutionCalibrationMode(
        { width: 1672, height: 941 },
        { width: 2048, height: 1152 }
      )
    ).toBe("resize");
  });

  it("does nothing when the requested resolution is already met", () => {
    expect(
      getResolutionCalibrationMode(
        { width: 2048, height: 1152 },
        { width: 2048, height: 1152 }
      )
    ).toBe("none");
  });
});

describe("calibrateImageResolution", () => {
  it("resizes a near-target image to the requested bounds", async () => {
    const input = await sharp({
      create: {
        width: 167,
        height: 94,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toBuffer();

    const result = await calibrateImageResolution(input, "204x115");
    const metadata = await sharp(result.buffer).metadata();

    expect(result.applied).toBe(true);
    expect(metadata.width).toBe(204);
    expect(metadata.height).toBe(115);
  });

  it("reaches the target even when the 4x super-resolution result is still smaller", async () => {
    const input = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toBuffer();

    const result = await calibrateImageResolution(input, "512x512");
    const metadata = await sharp(result.buffer).metadata();

    expect(result.applied).toBe(true);
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
  });
});
