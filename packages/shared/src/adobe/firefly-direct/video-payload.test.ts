import { describe, expect, it } from "vitest";
import { buildFireflyVideoPayload } from "./payloads";

const base = {
  prompt: "a cat surfing",
  upstreamModel: "openai:firefly:colligo:sora2",
  upstreamModelId: "sora",
  upstreamModelVersion: "sora-2",
  engine: "sora2",
  duration: 8,
  size: { width: 1280, height: 720 },
  generateAudio: false,
};

describe("buildFireflyVideoPayload", () => {
  it("文生视频:无参考帧,module=text2video", () => {
    const p = buildFireflyVideoPayload(base);
    expect(p).toMatchObject({
      modelId: "sora",
      model: "openai:firefly:colligo:sora2",
      modelVersion: "sora-2",
      engine: "sora2",
      duration: 8,
      fps: 24,
      size: { width: 1280, height: 720 },
      generateAudio: false,
      generationMetadata: { module: "text2video" },
    });
    expect(p.referenceBlobs).toBeUndefined();
    expect(p.referenceFrames).toBeUndefined();
  });

  it("sora2 图生视频:首+尾帧 → referenceFrames 两槽,module=image2video", () => {
    const p = buildFireflyVideoPayload({
      ...base,
      sourceImageIds: ["img-a", "img-b"],
    });
    expect(p.generationMetadata).toEqual({ module: "image2video" });
    expect(p.referenceBlobs).toEqual([
      { id: "img-a", usage: "general", promptReference: 1 },
    ]);
    expect(p.referenceFrames).toEqual([
      { localBlobRef: "img-a" },
      { localBlobRef: "img-b" },
    ]);
  });

  it("sora2 单首帧:尾槽为 null", () => {
    const p = buildFireflyVideoPayload({ ...base, sourceImageIds: ["only"] });
    expect(p.referenceFrames).toEqual([{ localBlobRef: "only" }, null]);
  });

  it("kling 图生视频:referenceBlobs usage=frame + order", () => {
    const p = buildFireflyVideoPayload({
      ...base,
      upstreamModelId: "kling",
      sourceImageIds: ["k1", "k2"],
    });
    expect(p.referenceBlobs).toEqual([
      { id: "k1", usage: "frame", order: 0 },
      { id: "k2", usage: "frame", order: 1 },
    ]);
    expect(p.referenceFrames).toBeUndefined();
  });

  it("veo31-ref:reference_mode=image 透传", () => {
    const p = buildFireflyVideoPayload({ ...base, referenceMode: "image" });
    expect(p.reference_mode).toBe("image");
  });
});
