import { describe, expect, it } from "vitest";
import {
  FIREFLY_VIDEO_FAMILIES,
  fireflyVideoMaxInputImages,
  fireflyVideoSize,
  isFireflyVideoModelId,
  resolveFireflyVideoModel,
} from "./video-catalog";

describe("firefly video catalog", () => {
  it("注册 7 个视频族", () => {
    expect(FIREFLY_VIDEO_FAMILIES.map((f) => f.family)).toEqual([
      "sora2",
      "sora2-pro",
      "veo31",
      "veo31-ref",
      "veo31-fast",
      "kling-o3",
      "kling3",
    ]);
  });

  it("sora2 不拼分辨率,固定 720p,带 sora 上游", () => {
    const conf = resolveFireflyVideoModel("firefly-sora2-8s-16x9");
    expect(conf).toMatchObject({
      family: "sora2",
      upstreamModel: "openai:firefly:colligo:sora2",
      upstreamModelId: "sora",
      upstreamModelVersion: "sora-2",
      duration: 8,
      aspectRatio: "16:9",
      outputResolution: "720p",
      generateAudio: false,
    });
  });

  it("veo31 拼分辨率,veo31-fast 走 fast 版本", () => {
    expect(resolveFireflyVideoModel("firefly-veo31-6s-16x9-1080p")).toMatchObject(
      {
        family: "veo31",
        upstreamModelVersion: "3.1-generate",
        engine: "veo31-standard",
        duration: 6,
        outputResolution: "1080p",
      }
    );
    expect(
      resolveFireflyVideoModel("firefly-veo31-fast-4s-9x16-720p")
    ).toMatchObject({
      family: "veo31-fast",
      upstreamModelVersion: "3.1-fast-generate",
      engine: "veo31-fast",
    });
  });

  it("veo31-ref 带 referenceMode=image", () => {
    expect(
      resolveFireflyVideoModel("firefly-veo31-ref-8s-16x9-1080p")?.referenceMode
    ).toBe("image");
  });

  it("kling3 默认生成音频,kling-o3 固定 1080p", () => {
    expect(resolveFireflyVideoModel("firefly-kling3-10s-16x9")?.generateAudio).toBe(
      true
    );
    expect(
      resolveFireflyVideoModel("firefly-kling-o3-15s-9x16")?.outputResolution
    ).toBe("1080p");
  });

  it("非法/未知 model id 返回 null", () => {
    expect(resolveFireflyVideoModel("firefly-sora2-3s-16x9")).toBeNull();
    expect(resolveFireflyVideoModel("firefly-gpt-image-2-2k-1x1")).toBeNull();
    expect(isFireflyVideoModelId("firefly-veo31-6s-16x9-1080p")).toBe(true);
    expect(isFireflyVideoModelId("nope")).toBe(false);
  });

  it("size 映射", () => {
    expect(fireflyVideoSize("720p", "16:9")).toEqual({ width: 1280, height: 720 });
    expect(fireflyVideoSize("1080p", "9:16")).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(fireflyVideoSize("720p", "1:1")).toBeNull();
  });

  it("按模型限制输入图数量", () => {
    const sora = resolveFireflyVideoModel("firefly-sora2-8s-16x9");
    const veo = resolveFireflyVideoModel("firefly-veo31-6s-16x9-1080p");
    const veoRef = resolveFireflyVideoModel("firefly-veo31-ref-6s-16x9-1080p");
    const kling = resolveFireflyVideoModel("firefly-kling3-10s-16x9");
    expect(sora && fireflyVideoMaxInputImages(sora)).toBe(1);
    expect(veo && fireflyVideoMaxInputImages(veo)).toBe(2);
    expect(veoRef && fireflyVideoMaxInputImages(veoRef)).toBe(3);
    expect(kling && fireflyVideoMaxInputImages(kling)).toBe(2);
  });
});
