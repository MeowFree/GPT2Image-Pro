/**
 * PSD 导出服务端编排(策略 A:整图 + 按需补层)。
 *
 * 职责:基于一张已生成的底图,按图层计划逐层产出位图——底图作背景层、(可选)用图像编辑
 * 把主体抠成透明层、每个附加元素透明单独生成一层——再用 assembleLayeredPsd 组装为真·分层
 * PSD,存入与底图同一存储桶,返回签名下载链接。
 *
 * 使用方:apps/web 的 server action / UOL image.exportPsd 接线(Phase 2)。
 *
 * 计费:每个"新增图层"(抠主体的 edit、每个元素的 generate)都走 runImageGenerationForUser
 * 的内置幂等扣费;底图复用不收费,PSD 组装本身不收费。故本函数不额外调用 consumeCredits,
 * 仅汇总各次生成实际扣费返回。
 *
 * 已知限制(v1):
 * - 主体抠层是"重绘"而非像素级抠图,与底图未必逐像素对齐(后续可换真·抠图模型);
 * - 非幂等:重复调用会重新生成并再次扣费,依赖传输层/UI 防重复提交;
 * - 中途某层生成失败会抛错,已完成的层已扣费(v1 不做整单回滚)。
 */
import { nanoid } from "nanoid";
import sharp from "sharp";
import { buildSignedStorageImageUrl } from "@repo/shared/storage";
import { getStorageProvider } from "@repo/shared/storage/providers";
import {
  type ImageGenerationOperationResult,
  runImageGenerationForUser,
} from "@/features/image-generation/operations";
import { getGenerationById } from "@/features/image-generation/queries";
import { type PsdLayerInput, assembleLayeredPsd } from "./assembler";
import { type PsdElementSpec, planPsdLayers } from "./plan";

/** 抠主体的固定提示词:保持主体外观、其余透明。 */
const ISOLATE_SUBJECT_PROMPT =
  "Isolate the main subject onto a fully transparent background. " +
  "Keep the subject's exact appearance and position; remove everything else.";

/** PSD 签名下载链接有效期(秒)。 */
const PSD_SIGNED_URL_TTL_SECONDS = 7200;

export type ExportLayeredPsdInput = {
  userId: string;
  /** 底图所属 generation。 */
  generationId: string;
  isolateSubject?: boolean;
  elements?: PsdElementSpec[];
};

export type ExportLayeredPsdResult = {
  psdStorageKey: string;
  psdSignedUrl: string;
  layerCount: number;
  creditsConsumed: number;
};

/** 把一次生成的产出读为 PNG 字节:优先内联 base64,否则回源该 generation 的存储对象。 */
async function loadGenerationImageBytes(
  result: ImageGenerationOperationResult,
  storage: Awaited<ReturnType<typeof getStorageProvider>>
): Promise<Buffer> {
  if (result.imageBase64) {
    return Buffer.from(result.imageBase64, "base64");
  }
  if (!result.generationId) {
    throw new Error("图层生成结果缺少 generationId,无法回源图片");
  }
  const row = await getGenerationById(result.generationId);
  if (!row?.storageKey) {
    throw new Error("图层生成结果缺少存储对象,无法读取图片");
  }
  return storage.getObject(row.storageKey, row.storageBucket || "generations");
}

/**
 * 执行 PSD 导出编排。
 *
 * @throws 底图不存在/无权/未完成、图层生成失败、或画布尺寸不可解析时抛错。
 */
export async function exportLayeredPsdForUser(
  input: ExportLayeredPsdInput
): Promise<ExportLayeredPsdResult> {
  // 1. 载入底图并校验归属与可用性。
  const base = await getGenerationById(input.generationId);
  if (!base || base.userId !== input.userId) {
    throw new Error("底图不存在或无权访问");
  }
  if (base.status !== "completed" || !base.storageKey) {
    throw new Error("底图尚未完成,无法导出 PSD");
  }
  const bucket = base.storageBucket || "generations";
  const storage = await getStorageProvider();
  const baseBytes = await storage.getObject(base.storageKey, bucket);

  // 画布尺寸取底图实际像素,所有图层统一对齐到此尺寸。
  const meta = await sharp(baseBytes).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("无法解析底图尺寸");
  }
  const width = meta.width;
  const height = meta.height;
  const sizeParam = base.size || `${width}x${height}`;

  // 2. 解析图层计划(底层在前)。
  const jobs = planPsdLayers({
    ...(input.isolateSubject !== undefined
      ? { isolateSubject: input.isolateSubject }
      : {}),
    ...(input.elements ? { elements: input.elements } : {}),
  });

  // 3. 逐层产出位图;非底图层统一缩放到画布尺寸(透明留边),保证组装对齐、避免合成越界。
  const layers: PsdLayerInput[] = [];
  let creditsConsumed = 0;

  for (const job of jobs) {
    if (job.role === "background") {
      layers.push({ name: job.name, image: baseBytes });
      continue;
    }

    const result =
      job.role === "subject"
        ? await runImageGenerationForUser({
            mode: "edit",
            userId: input.userId,
            prompt: ISOLATE_SUBJECT_PROMPT,
            images: [
              {
                data: baseBytes,
                name: "base.png",
                type: "image/png",
                storageKey: base.storageKey,
                storageBucket: bucket,
              },
            ],
            background: "transparent",
            outputFormat: "png",
            size: sizeParam,
            n: 1,
          })
        : await runImageGenerationForUser({
            mode: "generate",
            userId: input.userId,
            prompt: job.prompt,
            background: "transparent",
            outputFormat: "png",
            size: sizeParam,
            n: 1,
          });

    if (result.error || !result.generationId) {
      throw new Error(result.error || "图层生成失败");
    }
    creditsConsumed += result.creditsConsumed ?? 0;

    const rawLayer = await loadGenerationImageBytes(result, storage);
    const normalized = await sharp(rawLayer)
      .ensureAlpha()
      .resize(width, height, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    layers.push({ name: job.name, image: normalized });
  }

  // 4. 组装分层 PSD。
  const psdBuffer = await assembleLayeredPsd(layers, { width, height });

  // 5. 存入与底图同桶,返回签名下载链接。
  const psdStorageKey = `${input.userId}/${nanoid(32)}.psd`;
  await storage.putObject(
    psdStorageKey,
    bucket,
    psdBuffer,
    "image/vnd.adobe.photoshop"
  );
  const psdSignedUrl =
    buildSignedStorageImageUrl(psdStorageKey, bucket, PSD_SIGNED_URL_TTL_SECONDS) ||
    "";

  return {
    psdStorageKey,
    psdSignedUrl,
    layerCount: layers.length,
    creditsConsumed,
  };
}
