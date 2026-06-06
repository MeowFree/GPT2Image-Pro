/**
 * 分层产物元数据(generation.metadata.outputImage.layered)的解析与判定。
 *
 * 职责:轻量、无重依赖(仅 zod),供两类使用方共用——
 *   - 服务端编排/动作:解析出各层(orchestrator、actions);
 *   - 页面 loader / 列表:仅判断"是否分层产物"以决定是否展示导出入口(hasLayeredMeta)。
 * WHY 单独成文:避免页面 loader 因引用 orchestrator 而牵入 sharp/ag-psd/onnxruntime 等重依赖。
 *
 * 产物角色:0=整图合成(预览),1=背景(不透明),>=2=前景元素(白底,需抠图)。详见
 * image-generation/operations.ts 写入处。
 */
import { z } from "zod";

/** 单层 schema。 */
export const layeredLayerSchema = z.object({
  storageKey: z.string().min(1),
  size: z.string().nullish(),
  role: z.enum(["composite", "background", "element"]),
  order: z.number(),
});

/** 分层产物 schema。 */
export const layeredMetaSchema = z.object({
  version: z.number().optional(),
  layers: z.array(layeredLayerSchema).min(1),
});

export type LayeredMeta = z.infer<typeof layeredMetaSchema>;

/**
 * 从 generation.metadata 解析分层产物;非分层生成返回 null。
 * metadata 属外部数据(DB JSON),按 schema 校验。
 */
export function readLayeredMeta(metadata: unknown): LayeredMeta | null {
  if (!metadata || typeof metadata !== "object") return null;
  const outputImage = (metadata as Record<string, unknown>).outputImage;
  if (!outputImage || typeof outputImage !== "object") return null;
  const layered = (outputImage as Record<string, unknown>).layered;
  const parsed = layeredMetaSchema.safeParse(layered);
  return parsed.success ? parsed.data : null;
}

/** 是否为可导出分层 PSD 的产物。供列表/loader 决定是否展示导出入口。 */
export function hasLayeredMeta(metadata: unknown): boolean {
  return readLayeredMeta(metadata) !== null;
}
