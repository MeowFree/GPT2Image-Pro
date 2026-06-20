/**
 * Adobe Firefly 直连 payload 构造（移植自 adobe2api core/models/payloads.py）。
 *
 * 把 prompt + 宽高比 + 分辨率 + 上游模型，构造成 firefly-3p `generate-async` 的请求
 * 体候选列表（candidates）。Firefly 对不同子模块/图生图形态接受的 payload 形状不同，
 * 上游用"多候选依次尝试，命中 200 即停"的策略——这里如实保留。
 * 纯函数，DB-free，可单测。
 */

export type FireflySize = { width: number; height: number };

function ratioMap1K(): Record<string, FireflySize> {
  return {
    "1:1": { width: 1024, height: 1024 },
    "1:8": { width: 384, height: 3072 },
    "1:4": { width: 512, height: 2048 },
    "16:9": { width: 1360, height: 768 },
    "9:16": { width: 768, height: 1360 },
    "4:1": { width: 2048, height: 512 },
    "4:3": { width: 1152, height: 864 },
    "3:4": { width: 864, height: 1152 },
    "8:1": { width: 3072, height: 384 },
  };
}

function ratioMap4K(): Record<string, FireflySize> {
  return {
    "1:1": { width: 4096, height: 4096 },
    "1:8": { width: 1536, height: 12288 },
    "1:4": { width: 2048, height: 8192 },
    "16:9": { width: 5504, height: 3072 },
    "9:16": { width: 3072, height: 5504 },
    "4:1": { width: 8192, height: 2048 },
    "4:3": { width: 4096, height: 3072 },
    "3:4": { width: 3072, height: 4096 },
    "8:1": { width: 12288, height: 1536 },
  };
}

function ratioMap2K(): Record<string, FireflySize> {
  return {
    "1:1": { width: 2048, height: 2048 },
    "1:8": { width: 768, height: 6144 },
    "1:4": { width: 1024, height: 4096 },
    "16:9": { width: 2752, height: 1536 },
    "9:16": { width: 1536, height: 2752 },
    "4:1": { width: 4096, height: 1024 },
    "4:3": { width: 2048, height: 1536 },
    "3:4": { width: 1536, height: 2048 },
    "8:1": { width: 6144, height: 768 },
  };
}

/** 移植 payloads.size_from_ratio：非 gpt-image 家族的像素尺寸。 */
export function sizeFromRatio(
  ratio: string,
  outputResolution = "2K"
): FireflySize {
  const level = (outputResolution || "2K").toUpperCase();
  const map =
    level === "1K"
      ? ratioMap1K()
      : level === "4K"
        ? ratioMap4K()
        : ratioMap2K();
  return map[ratio] ?? map["16:9"] ?? { width: 2752, height: 1536 };
}

function gptRatioMap1K(): Record<string, FireflySize> {
  return {
    "1:1": { width: 1024, height: 1024 },
    "5:4": { width: 1120, height: 896 },
    "9:16": { width: 720, height: 1280 },
    "21:9": { width: 1456, height: 624 },
    "16:9": { width: 1280, height: 720 },
    "4:3": { width: 1152, height: 864 },
    "3:2": { width: 1248, height: 832 },
    "4:5": { width: 896, height: 1120 },
    "3:4": { width: 864, height: 1152 },
    "2:3": { width: 832, height: 1248 },
  };
}

function gptRatioMap4K(): Record<string, FireflySize> {
  return {
    "1:1": { width: 2880, height: 2880 },
    "5:4": { width: 3200, height: 2560 },
    "9:16": { width: 2160, height: 3840 },
    "21:9": { width: 3696, height: 1584 },
    "16:9": { width: 3840, height: 2160 },
    "4:3": { width: 3264, height: 2448 },
    "3:2": { width: 3504, height: 2336 },
    "4:5": { width: 2560, height: 3200 },
    "3:4": { width: 2448, height: 3264 },
    "2:3": { width: 2336, height: 3504 },
  };
}

function gptRatioMap2K(): Record<string, FireflySize> {
  return {
    "1:1": { width: 2048, height: 2048 },
    "5:4": { width: 2240, height: 1792 },
    "9:16": { width: 1440, height: 2560 },
    "21:9": { width: 3024, height: 1296 },
    "16:9": { width: 2560, height: 1440 },
    "4:3": { width: 2304, height: 1728 },
    "3:2": { width: 2496, height: 1664 },
    "4:5": { width: 1792, height: 2240 },
    "3:4": { width: 1728, height: 2304 },
    "2:3": { width: 1664, height: 2496 },
  };
}

/** 移植 payloads.gpt_image_pixels_from_ratio：gpt-image 家族像素尺寸；不支持的比例返回 null。 */
export function gptImagePixelsFromRatio(
  ratio: string,
  outputResolution = "2K"
): FireflySize | null {
  const level = (outputResolution || "2K").toUpperCase();
  const map =
    level === "1K"
      ? gptRatioMap1K()
      : level === "4K"
        ? gptRatioMap4K()
        : gptRatioMap2K();
  return map[ratio] ?? null;
}

function gptImageSizeString(size: FireflySize | null): string {
  if (!size) throw new Error("gpt-image size is required");
  const width = Number(size.width) || 0;
  const height = Number(size.height) || 0;
  if (width <= 0 || height <= 0)
    throw new Error("gpt-image size must be positive");
  return `${width}x${height}`;
}

/** 移植 payloads.gpt_image_detail_level_from_quality。 */
export function gptImageDetailLevelFromQuality(
  qualityLevel?: string | null
): number {
  const quality = String(qualityLevel || "low")
    .trim()
    .toLowerCase();
  if (quality === "high") return 5;
  if (quality === "medium") return 3;
  return 1;
}

function seedNow(): number {
  return Math.floor(Date.now() / 1000) % 999999;
}

export type FireflyImagePayload = Record<string, unknown>;

/**
 * 移植 payloads.build_image_payload_candidates。
 * 返回按尝试顺序排列的 payload 列表；调用方逐个 POST 直到 200。
 */
export function buildFireflyImagePayloadCandidates(params: {
  prompt: string;
  aspectRatio: string;
  outputResolution: string;
  upstreamModelId: string;
  upstreamModelVersion: string;
  qualityLevel?: string | null | undefined;
  detailLevel?: number | null | undefined;
  sourceImageIds?: string[] | null | undefined;
}): FireflyImagePayload[] {
  const normalizedRatio = String(params.aspectRatio || "")
    .trim()
    .toLowerCase();
  const effectiveRatio = normalizedRatio || "1:1";
  const sourceImageIds = params.sourceImageIds ?? null;

  if (
    String(params.upstreamModelId || "")
      .trim()
      .toLowerCase() === "gpt-image"
  ) {
    let effectiveDetailLevel = params.detailLevel;
    if (effectiveDetailLevel === null || effectiveDetailLevel === undefined) {
      effectiveDetailLevel = gptImageDetailLevelFromQuality(
        params.qualityLevel
      );
    }
    const pixelSize = gptImagePixelsFromRatio(
      effectiveRatio,
      params.outputResolution
    );
    if (!pixelSize) {
      throw new Error(`unsupported gpt-image ratio: ${effectiveRatio}`);
    }
    const basePayload: FireflyImagePayload = {
      modelId: params.upstreamModelId,
      modelVersion: params.upstreamModelVersion,
      n: 1,
      prompt: params.prompt,
      seeds: [seedNow()],
      output: { storeInputs: true },
      referenceBlobs: [],
      generationMetadata: {
        module: "text2image",
        submodule: "ff-image-generate",
      },
      modelSpecificPayload: {
        size: gptImageSizeString(pixelSize),
      },
      outputResolution: String(params.outputResolution || "2K").toUpperCase(),
      generationSettings: {
        detailLevel: Math.trunc(effectiveDetailLevel),
      },
      size: pixelSize,
    };
    if (!sourceImageIds || sourceImageIds.length === 0) {
      return [basePayload];
    }

    const subjectReference: FireflyImagePayload = {
      ...basePayload,
      referenceBlobs: sourceImageIds.map((imgId) => ({
        id: imgId,
        usage: "subject",
      })),
      modelSpecificPayload: {},
    };

    const referenceImage: FireflyImagePayload = {
      ...basePayload,
      generationMetadata: {
        module: "image2image",
        submodule: "ff-image-generate",
      },
      referenceBlobs: [],
      referenceImages: sourceImageIds.map((imgId) => ({ id: imgId })),
    };

    const localBlobReference: FireflyImagePayload = {
      ...referenceImage,
      referenceImages: sourceImageIds.map((imgId) => ({ localBlobRef: imgId })),
    };

    return [subjectReference, referenceImage, localBlobReference];
  }

  const basePayload: FireflyImagePayload = {
    modelId: params.upstreamModelId,
    modelVersion: params.upstreamModelVersion,
    n: 1,
    prompt: params.prompt,
    size: sizeFromRatio(effectiveRatio, params.outputResolution),
    seeds: [seedNow()],
    groundSearch: false,
    skipCai: false,
    output: { storeInputs: true },
    generationMetadata: {
      module: "text2image",
      submodule: "ff-image-generate",
    },
    modelSpecificPayload: {
      parameters: { addWatermark: false },
    },
  };
  if (normalizedRatio && normalizedRatio !== "auto") {
    (basePayload.modelSpecificPayload as Record<string, unknown>).aspectRatio =
      normalizedRatio;
  }

  if (!sourceImageIds || sourceImageIds.length === 0) {
    basePayload.referenceBlobs = [];
    return [basePayload];
  }

  const edited: FireflyImagePayload = {
    ...basePayload,
    generationMetadata: {
      module: "image2image",
      submodule: "ff-image-generate",
    },
    referenceBlobs: sourceImageIds.map((imgId) => ({
      id: imgId,
      usage: "general",
    })),
  };
  return [edited];
}

export type FireflyVideoPayload = Record<string, unknown>;

/**
 * 构造 Firefly 视频提交体（/v2/3p-videos/generate-async），依据视频协议规格
 * （docs/plan/2026-06-20-adobe-firefly-video-spec.md）。
 *
 * 文生视频只传 prompt；图生视频先在调用方上传输入图拿 id，再按引擎挂参考：
 * - kling：referenceBlobs[{id, usage:"frame", order}]；
 * - sora2/veo31：referenceBlobs[{id, usage:"general", promptReference:1}] +
 *   referenceFrames[首帧, 尾帧|null]。
 * engine / reference_mode 的精确位置属规格待核点（见 spec §5），先按 best-effort 放顶层。
 */
export function buildFireflyVideoPayload(params: {
  prompt: string;
  upstreamModel: string;
  upstreamModelId: string;
  upstreamModelVersion: string;
  engine: string;
  duration: number;
  size: FireflySize;
  generateAudio: boolean;
  referenceMode?: "image";
  negativePrompt?: string | null;
  sourceImageIds?: string[] | null;
}): FireflyVideoPayload {
  const seed = seedNow();
  const ids = (params.sourceImageIds ?? []).filter(Boolean);
  const hasFrames = ids.length > 0;

  const payload: FireflyVideoPayload = {
    n: 1,
    seeds: [seed],
    seed: String(seed),
    modelId: params.upstreamModelId,
    model: params.upstreamModel,
    modelVersion: params.upstreamModelVersion,
    engine: params.engine,
    size: { width: params.size.width, height: params.size.height },
    duration: params.duration,
    fps: 24,
    prompt: params.prompt,
    negativePrompt: params.negativePrompt || "",
    generateAudio: params.generateAudio,
    jobMode: "standard",
    generationMetadata: {
      module: hasFrames ? "image2video" : "text2video",
    },
    ...(params.referenceMode ? { reference_mode: params.referenceMode } : {}),
  };

  if (hasFrames) {
    if (params.upstreamModelId === "kling") {
      payload.referenceBlobs = ids.map((id, index) => ({
        id,
        usage: "frame",
        order: index,
      }));
    } else {
      const first = ids[0];
      const last = ids[1];
      payload.referenceBlobs = [
        { id: first, usage: "general", promptReference: 1 },
      ];
      payload.referenceFrames = [
        { localBlobRef: first },
        last ? { localBlobRef: last } : null,
      ];
    }
  }

  return payload;
}
