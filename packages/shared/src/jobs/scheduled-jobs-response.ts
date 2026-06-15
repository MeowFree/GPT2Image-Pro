/**
 * 定时任务响应聚合纯函数
 *
 * 职责：把底层维护函数（processExpiredBatches / expireStalePendingGenerations）
 * 返回的结果数组，纯映射/聚合成各 cron 端点对外的响应负载。
 * 使用方：`scheduled-jobs.ts` 的 runCreditsExpireJob / runImageMaintenanceJob。
 * 关键依赖：无。本模块刻意不 import @repo/database，以便 DB-free 单测覆盖
 * 这些财务/维护 cron 的对外契约（积分过期金额、退款汇总、过期计数）。
 *
 * 为何抽出：底层函数的财务计算已各自有测试，但"结果数组 → 响应对象"的
 * 投影/求和此前零覆盖，回归（如漏字段、求和算错）会让对账与监控失真。
 */

/**
 * 单条已过期积分批次结果（来自 processExpiredBatches）。
 * 仅声明响应所需字段，避免耦合底层返回的完整结构。
 */
export interface ExpiredCreditsBatchResult {
  batchId: string;
  userId: string;
  expiredAmount: number;
}

/** 积分过期 cron 的对外响应负载。 */
export interface CreditsExpireResponse {
  success: true;
  processed: number;
  details: Array<{
    batchId: string;
    userId: string;
    expiredAmount: number;
  }>;
}

/**
 * 把积分过期结果数组映射为对外响应。
 *
 * @param results 已过期批次结果（每项含 batchId/userId/expiredAmount）
 * @returns processed=结果条数，details 仅保留三字段，success 恒 true
 * @remarks 纯投影，无副作用；timestamp 由调用方注入以保持本函数确定性可测。
 */
export function buildCreditsExpireResponse(
  results: readonly ExpiredCreditsBatchResult[]
): CreditsExpireResponse {
  return {
    success: true,
    processed: results.length,
    details: results.map((result) => ({
      batchId: result.batchId,
      userId: result.userId,
      expiredAmount: result.expiredAmount,
    })),
  };
}

/**
 * 单条超时 pending 生成的过期结果（来自 expireStalePendingGenerations）。
 * 仅声明聚合所需字段。
 */
export interface ExpiredPendingGenerationResult {
  creditsRefunded: number;
}

/** 超时 pending 生成的聚合结果。 */
export interface ExpiredPendingGenerationsSummary {
  expired: number;
  creditsRefunded: number;
}

/**
 * 汇总超时 pending 生成结果：统计过期条数与累计退款积分。
 *
 * @param results 过期结果数组（每项含 creditsRefunded）
 * @returns expired=条数，creditsRefunded=各条退款积分之和
 * @remarks 纯聚合，无副作用；creditsRefunded 求和回归会让退款对账失真，故单独可测。
 */
export function summarizeExpiredPendingGenerations(
  results: readonly ExpiredPendingGenerationResult[]
): ExpiredPendingGenerationsSummary {
  return {
    expired: results.length,
    creditsRefunded: results.reduce(
      (total, item) => total + item.creditsRefunded,
      0
    ),
  };
}
