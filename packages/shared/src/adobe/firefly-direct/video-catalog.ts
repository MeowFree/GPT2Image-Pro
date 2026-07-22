/**
 * Adobe Firefly 直连视频模型目录（依据 adobe2api 视频协议规格移植，见
 * docs/plan/2026-06-20-adobe-firefly-video-spec.md）。
 *
 * 把 model id（firefly-<family>-<dur>s-<ratio>[-<res>]）解析成直连 Adobe Firefly
 * /v2/3p-videos 端点所需的上游 model/modelId/modelVersion/engine + 时长 + 宽高比 +
 * 分辨率 + 音频/参考标志。纯数据 + 纯函数，DB-free，可单测。
 */

export type FireflyVideoResolution = "720p" | "1080p";

const RATIO_SUFFIX_MAP: Record<string, string> = {
  "16:9": "16x9",
  "9:16": "9x16",
};

// 720p/1080p × 16:9/9:16 → 像素宽高（移植 _video_size）。
const VIDEO_SIZE_MAP: Record<
  FireflyVideoResolution,
  Record<string, { width: number; height: number }>
> = {
  "720p": {
    "16:9": { width: 1280, height: 720 },
    "9:16": { width: 720, height: 1280 },
  },
  "1080p": {
    "16:9": { width: 1920, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
  },
};

export type FireflyVideoModelConf = {
  /** Firefly 模型族（如 sora2 / veo31 / kling-o3）。 */
  family: string;
  /** 上游 model 串（如 openai:firefly:colligo:sora2）。 */
  upstreamModel: string;
  /** payload.modelId（sora/veo/kling）。 */
  upstreamModelId: string;
  /** payload.modelVersion。 */
  upstreamModelVersion: string;
  /** 引擎标识（veo31-standard / kling-o3 等），部分上游需要。 */
  engine: string;
  /** 时长（秒）。 */
  duration: number;
  aspectRatio: string;
  outputResolution: FireflyVideoResolution;
  /** 是否生成音频（kling3 默认开）。 */
  generateAudio: boolean;
  /** veo31-ref 参考模式：reference_mode="image"。 */
  referenceMode?: "image";
  description: string;
};

export const FIREFLY_VIDEO_MODEL_CATALOG: Record<
  string,
  FireflyVideoModelConf
> = {};

type VideoFamilySpec = {
  family: string;
  /** 用于拼 model id 的前缀（含 firefly-）。 */
  prefix: string;
  upstreamModel: string;
  upstreamModelId: string;
  upstreamModelVersion: string;
  engine: string;
  durations: number[];
  ratios: string[];
  resolutions: FireflyVideoResolution[];
  /** 分辨率是否拼进 model id（veo31 系列拼，sora/kling 固定不拼）。 */
  resolutionInId: boolean;
  generateAudio?: boolean;
  referenceMode?: "image";
  label: string;
};

const VIDEO_FAMILY_SPECS: VideoFamilySpec[] = [
  {
    family: "sora2",
    prefix: "firefly-sora2",
    upstreamModel: "openai:firefly:colligo:sora2",
    upstreamModelId: "sora",
    upstreamModelVersion: "sora-2",
    engine: "sora2",
    durations: [4, 8, 12],
    ratios: ["9:16", "16:9"],
    resolutions: ["720p"],
    resolutionInId: false,
    label: "Sora 2",
  },
  {
    family: "sora2-pro",
    prefix: "firefly-sora2-pro",
    upstreamModel: "openai:firefly:colligo:sora2-pro",
    upstreamModelId: "sora",
    upstreamModelVersion: "sora-2",
    engine: "sora2",
    durations: [4, 8, 12],
    ratios: ["9:16", "16:9"],
    resolutions: ["720p"],
    resolutionInId: false,
    label: "Sora 2 Pro",
  },
  {
    family: "veo31",
    prefix: "firefly-veo31",
    upstreamModel: "google:firefly:colligo:veo31",
    upstreamModelId: "veo",
    upstreamModelVersion: "3.1-generate",
    engine: "veo31-standard",
    durations: [4, 6, 8],
    ratios: ["16:9", "9:16"],
    resolutions: ["1080p", "720p"],
    resolutionInId: true,
    label: "Veo 3.1",
  },
  {
    family: "veo31-ref",
    prefix: "firefly-veo31-ref",
    upstreamModel: "google:firefly:colligo:veo31",
    upstreamModelId: "veo",
    upstreamModelVersion: "3.1-generate",
    engine: "veo31-standard",
    durations: [4, 6, 8],
    ratios: ["16:9", "9:16"],
    resolutions: ["1080p", "720p"],
    resolutionInId: true,
    referenceMode: "image",
    label: "Veo 3.1 Reference",
  },
  {
    family: "veo31-fast",
    prefix: "firefly-veo31-fast",
    upstreamModel: "google:firefly:colligo:veo31-fast",
    upstreamModelId: "veo",
    upstreamModelVersion: "3.1-fast-generate",
    engine: "veo31-fast",
    durations: [4, 6, 8],
    ratios: ["16:9", "9:16"],
    resolutions: ["1080p", "720p"],
    resolutionInId: true,
    label: "Veo 3.1 Fast",
  },
  {
    family: "kling-o3",
    prefix: "firefly-kling-o3",
    upstreamModel: "kling:firefly:colligo:o3",
    upstreamModelId: "kling",
    upstreamModelVersion: "kling_o3_pro_reference_to_video",
    engine: "kling-o3",
    durations: [5, 15],
    ratios: ["16:9", "9:16"],
    resolutions: ["1080p"],
    resolutionInId: false,
    label: "Kling O3",
  },
  {
    family: "kling3",
    prefix: "firefly-kling3",
    upstreamModel: "kling:firefly:colligo:3.0",
    upstreamModelId: "kling",
    upstreamModelVersion: "kling_v3_standard_i2v",
    engine: "kling3",
    durations: [5, 10, 15],
    ratios: ["16:9", "9:16"],
    resolutions: ["720p"],
    resolutionInId: false,
    generateAudio: true,
    label: "Kling 3.0",
  },
];

function registerVideoFamily(spec: VideoFamilySpec): void {
  for (const duration of spec.durations) {
    for (const ratio of spec.ratios) {
      const suffix = RATIO_SUFFIX_MAP[ratio];
      if (!suffix) continue;
      for (const resolution of spec.resolutions) {
        const id = spec.resolutionInId
          ? `${spec.prefix}-${duration}s-${suffix}-${resolution}`
          : `${spec.prefix}-${duration}s-${suffix}`;
        FIREFLY_VIDEO_MODEL_CATALOG[id] = {
          family: spec.family,
          upstreamModel: spec.upstreamModel,
          upstreamModelId: spec.upstreamModelId,
          upstreamModelVersion: spec.upstreamModelVersion,
          engine: spec.engine,
          duration,
          aspectRatio: ratio,
          outputResolution: resolution,
          generateAudio: spec.generateAudio ?? false,
          ...(spec.referenceMode ? { referenceMode: spec.referenceMode } : {}),
          description: `${spec.label} (${duration}s ${ratio} ${resolution})`,
        };
      }
    }
  }
}

for (const spec of VIDEO_FAMILY_SPECS) {
  registerVideoFamily(spec);
}

/** 视频模型族 id 列表（供前端/接口列出可选模型族）。 */
export const FIREFLY_VIDEO_FAMILIES = VIDEO_FAMILY_SPECS.map((spec) => ({
  family: spec.family,
  label: spec.label,
  durations: spec.durations,
  ratios: spec.ratios,
  resolutions: spec.resolutions,
  resolutionInId: spec.resolutionInId,
}));

/** 解析完整 video model id → 配置；解析不到返回 null。 */
export function resolveFireflyVideoModel(
  modelId?: string | null
): FireflyVideoModelConf | null {
  const id = String(modelId || "").trim();
  if (!id) return null;
  return FIREFLY_VIDEO_MODEL_CATALOG[id] ?? null;
}

/** 是否 Firefly 视频 model id（在视频目录中）。 */
export function isFireflyVideoModelId(modelId?: string | null): boolean {
  return resolveFireflyVideoModel(modelId) !== null;
}

/** 与上游入口一致的各视频模型最大输入图数量。 */
export function fireflyVideoMaxInputImages(
  config: FireflyVideoModelConf
): number {
  if (config.engine === "veo31-standard" && config.referenceMode === "image") {
    return 3;
  }
  if (
    config.engine === "veo31-fast" ||
    config.engine === "veo31-standard" ||
    config.engine === "kling-o3" ||
    config.engine === "kling3"
  ) {
    return 2;
  }
  return 1;
}

/** 按分辨率 + 宽高比取像素宽高。 */
export function fireflyVideoSize(
  resolution: FireflyVideoResolution,
  aspectRatio: string
): { width: number; height: number } | null {
  return VIDEO_SIZE_MAP[resolution]?.[aspectRatio] ?? null;
}
