/**
 * 营销首页统一数据缓存:7 项非会话数据聚合为 60s 进程内缓存
 * (单飞去重,失败用陈旧值兜底)。WHY:首页几乎全是匿名新用户,
 * 每请求逐项查库会造成无谓压力;定时统一刷新把 DB 命中降到
 * 每进程每分钟约一次。会话/角色仍在 page.tsx 按请求读取
 * (匿名访客无 cookie 不触库;失败按匿名处理,营销页不可 500)。
 */
import "server-only";

import { getRuntimePaymentConfig } from "@repo/shared/config/payment-runtime";
import { CREDIT_CONFIG_DEFAULTS } from "@repo/shared/credits/config";
import { getRuntimeCreditPackages } from "@repo/shared/credits/packages";
import { getPlanCapabilityMatrix } from "@repo/shared/subscription/services/plan-capabilities";
import {
  getRuntimeSettingBoolean,
  getRuntimeSettingNumber,
} from "@repo/shared/system-settings";
import { getRuntimeImageBaseCreditPricing } from "@/features/image-generation/pricing-settings";
import { getRecentGenerationSlaStats } from "@/features/image-generation/sla";

import { createSingleFlightCache } from "./home-data-cache";

/** 60s:营销数据允许分钟级滞后,换来每进程每分钟约一次 DB 命中 */
const CACHE_TTL_MS = 60_000;

export interface MarketingHomeData {
  runtimePaymentConfig: Awaited<ReturnType<typeof getRuntimePaymentConfig>>;
  capabilityMatrix: Awaited<ReturnType<typeof getPlanCapabilityMatrix>>;
  creditPackages: Awaited<ReturnType<typeof getRuntimeCreditPackages>>;
  creditPackageExpiryDays: number;
  imageBasePricing: Awaited<
    ReturnType<typeof getRuntimeImageBaseCreditPricing>
  >;
  slaEnabled: boolean;
  /** SLA 统计查询失败时为 null,页面据此隐藏 SLA 区块 */
  slaStats: Awaited<ReturnType<typeof getRecentGenerationSlaStats>> | null;
}

async function load(): Promise<MarketingHomeData> {
  const [
    runtimePaymentConfig,
    capabilityMatrix,
    creditPackages,
    creditPackageExpiryDays,
    imageBasePricing,
    slaEnabled,
    slaStats,
  ] = await Promise.all([
    getRuntimePaymentConfig(),
    getPlanCapabilityMatrix(),
    getRuntimeCreditPackages(),
    getRuntimeSettingNumber(
      "CREDITS_EXPIRY_DAYS",
      CREDIT_CONFIG_DEFAULTS.creditsExpiryDays,
      { nonNegative: true }
    ),
    getRuntimeImageBaseCreditPricing(),
    getRuntimeSettingBoolean("MARKETING_SLA_STATUS_ENABLED", true),
    // WHY: SLA 样本要扫 generation 表(千行级),是 7 项里最重也最易
    // 抖动的查询;单独 catch 返 null(页面隐藏 SLA 区块),不拖垮整页。
    getRecentGenerationSlaStats(1000).catch((err: unknown) => {
      console.error("[home-data] SLA 统计查询失败,SLA 区块按隐藏处理", err);
      return null;
    }),
  ]);
  return {
    runtimePaymentConfig,
    capabilityMatrix,
    creditPackages,
    creditPackageExpiryDays,
    imageBasePricing,
    slaEnabled,
    slaStats,
  };
}

const cache = createSingleFlightCache<MarketingHomeData>(load, CACHE_TTL_MS);

export async function getMarketingHomeData(): Promise<MarketingHomeData> {
  return cache.get();
}
