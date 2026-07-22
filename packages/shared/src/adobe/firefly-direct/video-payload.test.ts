import { describe, expect, it } from "vitest";
import { buildFireflyVideoPayload } from "./payloads";

const base = {
  prompt: "a cat surfing",
  upstreamModel: "openai:firefly:colligo:sora2",
  upstreamModelId: "sora",
  upstreamModelVersion: "sora-2",
  engine: "sora2",
  duration: 8,
  aspectRatio: "16:9",
  size: { width: 1280, height: 720 },
  generateAudio: false,
};

describe("buildFireflyVideoPayload", () => {
  it("构造上游 Sora 文生视频完整字段和 JSON prompt", () => {
    const payload = buildFireflyVideoPayload({
      ...base,
      negativePrompt: "blurry",
    });

    expect(payload).toMatchObject({
      modelId: "sora",
      model: "openai:firefly:colligo:sora2",
      modelVersion: "sora-2",
      duration: 8,
      fps: 24,
      size: { width: 1280, height: 720 },
      generateAudio: false,
      generationMetadata: { module: "text2video" },
      negativePrompt: "blurry",
      output: { storeInputs: true },
      referenceBlobs: [],
      referenceFrames: [],
    });
    expect(JSON.parse(String(payload.prompt))).toEqual({
      id: 1,
      duration_sec: 8,
      prompt_text: "a cat surfing",
      negative_prompt: "blurry",
    });
    expect(payload.engine).toBeUndefined();
  });

  it("Sora 图生视频只使用首帧并保留 text2video module", () => {
    const payload = buildFireflyVideoPayload({
      ...base,
      sourceImageIds: ["img-a", "img-b"],
    });

    expect(payload.generationMetadata).toEqual({ module: "text2video" });
    expect(payload.referenceBlobs).toEqual([
      { id: "img-a", usage: "general", promptReference: 1 },
    ]);
    expect(payload.referenceFrames).toEqual([{ localBlobRef: "img-a" }, null]);
  });

  it("Veo Standard 使用 modelSpecificPayload 和 general 参考图", () => {
    const payload = buildFireflyVideoPayload({
      ...base,
      engine: "veo31-standard",
      upstreamModelId: "veo",
      upstreamModelVersion: "3.1-generate",
      duration: 6,
      sourceImageIds: ["v1", "v2", "ignored"],
    });

    expect(payload).toMatchObject({
      modelId: "veo",
      modelVersion: "3.1-generate",
      output: { storeInputs: true },
      generationMetadata: { module: "text2video" },
      modelSpecificPayload: {
        parameters: {
          durationSeconds: 6,
          aspectRatio: "16:9",
          addWaterMark: false,
        },
      },
    });
    expect(payload.referenceBlobs).toEqual([
      { id: "v1", usage: "general", promptReference: 1 },
      { id: "v2", usage: "general", promptReference: 2 },
    ]);
    expect(payload.duration).toBeUndefined();
  });

  it("Veo Reference 最多使用三张 asset 参考图", () => {
    const payload = buildFireflyVideoPayload({
      ...base,
      engine: "veo31-standard",
      upstreamModelId: "veo",
      upstreamModelVersion: "3.1-generate",
      referenceMode: "image",
      sourceImageIds: ["v1", "v2", "v3", "ignored"],
    });

    expect(payload.referenceBlobs).toEqual([
      { id: "v1", usage: "asset" },
      { id: "v2", usage: "asset" },
      { id: "v3", usage: "asset" },
    ]);
    expect(payload.reference_mode).toBeUndefined();
  });

  it("Veo Fast 使用 fast modelVersion 和 general 参考图", () => {
    const payload = buildFireflyVideoPayload({
      ...base,
      engine: "veo31-fast",
      upstreamModelId: "veo",
      upstreamModelVersion: "3.1-fast-generate",
      sourceImageIds: ["first", "last"],
    });

    expect(payload.modelVersion).toBe("3.1-fast-generate");
    expect(payload.referenceBlobs).toEqual([
      { id: "first", usage: "general", promptReference: 1 },
      { id: "last", usage: "general", promptReference: 2 },
    ]);
  });

  it.each([
    ["kling-o3", "kling_o3_pro_reference_to_video"],
    ["kling3", "kling_v3_standard_i2v"],
  ])("%s 帧序号从 1 开始", (engine, modelVersion) => {
    const payload = buildFireflyVideoPayload({
      ...base,
      engine,
      upstreamModelId: "kling",
      upstreamModelVersion: modelVersion,
      aspectRatio: "9:16",
      size: { width: 720, height: 1280 },
      sourceImageIds: ["k1", "k2", "ignored"],
    });

    expect(payload).toMatchObject({
      modelId: "kling",
      modelVersion,
      generationMetadata: { module: "image2video" },
      generationSettings: { aspectRatio: "9:16" },
      output: { storeInputs: true },
    });
    expect(payload.referenceBlobs).toEqual([
      { id: "k1", usage: "frame", order: 1 },
      { id: "k2", usage: "frame", order: 2 },
    ]);
  });
});
