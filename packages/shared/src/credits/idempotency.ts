/**
 * 积分幂等相关纯工具（不依赖数据库，便于单测）。
 */

/**
 * 从已存在交易的 metadata 中安全解析 consumedBatches。
 * 幂等命中时用于回放首次扣费的批次明细。
 */
export function readConsumedBatchesFromMetadata(
  metadata: unknown
): Array<{ batchId: string; consumedFromBatch: number }> {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as { consumedBatches?: unknown }).consumedBatches;
  if (!Array.isArray(raw)) return [];
  const result: Array<{ batchId: string; consumedFromBatch: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const batchId = (item as { batchId?: unknown }).batchId;
    const consumedFromBatch = (item as { consumedFromBatch?: unknown })
      .consumedFromBatch;
    if (typeof batchId === "string" && typeof consumedFromBatch === "number") {
      result.push({ batchId, consumedFromBatch });
    }
  }
  return result;
}

/** Postgres unique_violation (SQLSTATE 23505) 判定（pg / postgres.js 通用）。 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505"
  );
}
