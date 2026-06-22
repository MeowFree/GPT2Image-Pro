/**
 * Adobe Firefly 直连模型目录（移植自 adobe2api core/models/catalog.py + resolver.py）。
 *
 * 与 ../firefly-request.ts 的区别：那是给"外部 adobe2api 网关"拼 model id 的；这里是
 * 把 model id 解析成**直连 Adobe Firefly 3p 端点**所需的上游 modelId/modelVersion/
 * 上游 model 串 + 宽高比 + 输出分辨率（不依赖外部网关）。
 * 纯数据 + 纯函数，DB-free，可单测。
 */

export type FireflyOutputResolution = "1K" | "2K" | "4K";

// 通用宽高比集合（nano-banana2 另支持 1:8/1:4/4:1/8:1）。
export const FIREFLY_SUPPORTED_RATIOS = new Set<string>([
  "1:1",
  "1:8",
  "1:4",
  "5:4",
  "9:16",
  "21:9",
  "4:1",
  "16:9",
  "4:3",
  "3:2",
  "4:5",
  "3:4",
  "8:1",
  "2:3",
]);

const RATIO_SUFFIX_MAP: Record<string, string> = {
  "1:1": "1x1",
  "16:9": "16x9",
  "9:16": "9x16",
  "4:3": "4x3",
  "3:4": "3x4",
};

const NANO_BANANA2_RATIO_SUFFIX_MAP: Record<string, string> = {
  ...RATIO_SUFFIX_MAP,
  "1:8": "1x8",
  "1:4": "1x4",
  "4:1": "4x1",
  "8:1": "8x1",
};

const GPT_IMAGE_RATIO_SUFFIX_MAP: Record<string, string> = {
  "1:1": "1x1",
  "5:4": "5x4",
  "9:16": "9x16",
  "21:9": "21x9",
  "16:9": "16x9",
  "3:2": "3x2",
  "4:3": "4x3",
  "4:5": "4x5",
  "3:4": "3x4",
  "2:3": "2x3",
};

export type FireflyImageModelConf = {
  /** 上游 model 串（如 openai:firefly:gpt-image）。 */
  upstreamModel: string;
  /** payload.modelId。 */
  upstreamModelId: string;
  /** payload.modelVersion。 */
  upstreamModelVersion: string;
  outputResolution: FireflyOutputResolution;
  aspectRatio: string;
  description: string;
};

export const FIREFLY_IMAGE_MODEL_CATALOG: Record<
  string,
  FireflyImageModelConf
> = {};

const RESOLUTIONS: FireflyOutputResolution[] = ["1K", "2K", "4K"];

function registerNanoBananaFamily(
  prefix: string,
  opts: {
    upstreamModelId: string;
    upstreamModelVersion: string;
    familyLabel: string;
    ratioSuffixMap?: Record<string, string>;
  }
): void {
  const ratioSuffixMap = opts.ratioSuffixMap ?? RATIO_SUFFIX_MAP;
  for (const res of RESOLUTIONS) {
    const resLower = res.toLowerCase();
    for (const ratio of Object.keys(ratioSuffixMap)) {
      const suffix = ratioSuffixMap[ratio];
      const modelId = `${prefix}-${resLower}-${suffix}`;
      FIREFLY_IMAGE_MODEL_CATALOG[modelId] = {
        upstreamModel: "google:firefly:colligo:nano-banana-pro",
        upstreamModelId: opts.upstreamModelId,
        upstreamModelVersion: opts.upstreamModelVersion,
        outputResolution: res,
        aspectRatio: ratio,
        description: `${opts.familyLabel} (${res} ${ratio})`,
      };
    }
  }
}

// gpt-image 两个版本（2 / 1.5）：版本写进 model id 的版本段（紧跟 gpt-image），
// upstreamModelVersion 由名字决定（不再写死 2）。
const GPT_IMAGE_VERSIONS = ["2", "1.5"] as const;

function registerGptImageFamily(): void {
  for (const version of GPT_IMAGE_VERSIONS) {
    for (const res of RESOLUTIONS) {
      const resLower = res.toLowerCase();
      for (const ratio of Object.keys(GPT_IMAGE_RATIO_SUFFIX_MAP)) {
        const suffix = GPT_IMAGE_RATIO_SUFFIX_MAP[ratio];
        const modelId = `firefly-gpt-image-${version}-${resLower}-${suffix}`;
        FIREFLY_IMAGE_MODEL_CATALOG[modelId] = {
          upstreamModel: "openai:firefly:gpt-image",
          upstreamModelId: "gpt-image",
          upstreamModelVersion: version,
          outputResolution: res,
          aspectRatio: ratio,
          description: `Firefly GPT Image ${version} (${res} ${ratio})`,
        };
      }
    }
  }
}

registerNanoBananaFamily("firefly-nano-banana-pro", {
  upstreamModelId: "gemini-flash",
  upstreamModelVersion: "nano-banana-2",
  familyLabel: "Firefly Nano Banana Pro",
});
registerNanoBananaFamily("firefly-nano-banana", {
  upstreamModelId: "gemini-flash",
  upstreamModelVersion: "nano-banana-2",
  familyLabel: "Firefly Nano Banana",
});
registerNanoBananaFamily("firefly-nano-banana2", {
  upstreamModelId: "gemini-flash",
  upstreamModelVersion: "nano-banana-3",
  familyLabel: "Firefly Nano Banana 2",
  ratioSuffixMap: NANO_BANANA2_RATIO_SUFFIX_MAP,
});
registerGptImageFamily();

export const FIREFLY_DEFAULT_IMAGE_MODEL_ID = "firefly-nano-banana-pro-2k-16x9";

// 图像模型族 id（family 级）。API 按 firefly-* 前缀路由到 Adobe,分辨率/宽高比可由
// 请求的 size 参数决定（族级 id + size 即可,无需把 res/ratio 编进 id),故模型列表
// （/v1/models）暴露族级 id 即可,避免把 5×3×5 全组合都列出来。顺序即展示顺序。
export const FIREFLY_IMAGE_FAMILY_MODEL_IDS = [
  "firefly-gpt-image-2",
  "firefly-gpt-image-1.5",
  "firefly-nano-banana-pro",
  "firefly-nano-banana",
  "firefly-nano-banana2",
] as const;

/** model id → 配置；未知 id 返回 null（调用方决定回退/报错）。 */
export function resolveFireflyImageModel(
  modelId?: string | null
): FireflyImageModelConf | null {
  const id = String(modelId || "").trim();
  if (!id) {
    return FIREFLY_IMAGE_MODEL_CATALOG[FIREFLY_DEFAULT_IMAGE_MODEL_ID] ?? null;
  }
  return FIREFLY_IMAGE_MODEL_CATALOG[id] ?? null;
}

/** WxH → 宽高比（移植 resolver.ratio_from_size）。 */
export function ratioFromSize(size?: string | null): string {
  const mapping: Record<string, string> = {
    "1024x1024": "1:1",
    "1536x1536": "1:1",
    "2048x2048": "1:1",
    "1024x1792": "9:16",
    "1536x2752": "9:16",
    "1792x1024": "16:9",
    "2752x1536": "16:9",
    "2048x1536": "4:3",
    "1536x2048": "3:4",
  };
  return mapping[String(size || "").trim()] ?? "1:1";
}
