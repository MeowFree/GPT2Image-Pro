/**
 * PSD 导出服务端编排(策略 A:整图 + 按需补层)。
 *
 * 职责:基于一张已生成的底图,按图层计划逐层产出位图——底图作背景层、(可选)对底图抠图得到
 * 透明主体层、每个附加元素不透明生成后抠图得到透明层——再用 assembleLayeredPsd 组装为真·分层
 * PSD,存入与底图同一存储桶,返回签名下载链接。
 *
 * WHY 抠图而非"透明生成":实际生图后端(gpt-image-2)不支持 background=transparent(400),
 * 故透明由服务端 ISNet 抠图(matte.ts)实现。主体层直接抠底图,像素级精确且不额外生成/扣费。
 *
 * 使用方:apps/web 的 server action / UOL image.exportPsd 接线(Phase 2)。
 *
 * 计费:仅"元素层"走一次普通(不透明)generate、按 runImageGenerationForUser 内置幂等扣费;
 * 底图复用与主体抠图都不收费,PSD 组装、抠图本身也不收费。汇总各次生成实际扣费返回。
 *
 * 已知限制(v1):
 * - 非幂等:重复调用会重新生成元素并再次扣费,依赖传输层/UI 防重复提交;
 * - 中途某元素生成失败会抛错,已完成的元素已扣费(v1 不做整单回滚)。
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
import { removeBackground } from "./matte";
import { type PsdElementSpec, planPsdLayers } from "./plan";

/** PSD 签名下载链接有效期(秒)。 */
const PSD_SIGNED_URL_TTL_SECONDS = 7200;

export type ExportLayeredPsdInput = {
  userId: string;
  /** 底图所属 generation。 */
  generationId: string;
  isolateSubject?: boolean;
  elements?: PsdElementSpec[];
  /** 预先算好的 PSD 存储 key(异步导出:action 先返回签名 URL,后台用同一 key 写入)。 */
  psdStorageKey?: string;
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

  // 非底图层统一缩放到画布尺寸(透明留边),保证组装对齐、避免合成越界。
  const fitToCanvas = (png: Buffer) =>
    sharp(png)
      .ensureAlpha()
      .resize(width, height, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

  // 抠掉背景 + 对齐画布。
  const matteToCanvas = async (png: Buffer) =>
    fitToCanvas(await removeBackground(png));

  // 3. 逐层产出位图。元素层各自一次出图,并发跑——串行会把多元素叠加到几分钟、超 CF 100s;
  //    顺序由 jobs 决定,Promise.all 保序。
  const produced = await Promise.all(
    jobs.map(async (job) => {
      if (job.role === "background") {
        return { layer: { name: job.name, image: baseBytes }, credits: 0 };
      }
      if (job.role === "subject") {
        // 主体层 = 对底图抠图(像素级精确,不生成、不扣费)。
        return {
          layer: { name: job.name, image: await matteToCanvas(baseBytes) },
          credits: 0,
        };
      }
      // 元素层 = 不透明生成(走内置扣费)→ 抠掉背景 → 透明叠层。
      const result = await runImageGenerationForUser({
        mode: "generate",
        userId: input.userId,
        prompt: job.prompt,
        outputFormat: "png",
        size: sizeParam,
        n: 1,
      });
      if (result.error || !result.generationId) {
        throw new Error(result.error || "图层生成失败");
      }
      const rawLayer = await loadGenerationImageBytes(result, storage);
      return {
        layer: { name: job.name, image: await matteToCanvas(rawLayer) },
        credits: result.creditsConsumed ?? 0,
      };
    })
  );
  const layers: PsdLayerInput[] = produced.map((item) => item.layer);
  const creditsConsumed = produced.reduce((sum, item) => sum + item.credits, 0);

  // 4. 组装分层 PSD。
  const psdBuffer = await assembleLayeredPsd(layers, { width, height });

  // 5. 存入与底图同桶,返回签名下载链接。
  const psdStorageKey =
    input.psdStorageKey || `${input.userId}/${nanoid(32)}.psd`;
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
