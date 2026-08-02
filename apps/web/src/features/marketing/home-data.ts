/**
 * 营销首页非会话数据分层缓存:配置数据使用 1h 进程内缓存,SLA
 * 使用 120s 进程内缓存(均单飞去重;配置失败用陈旧值,SLA 失败
 * 隐藏并负缓存)。WHY:首页几乎全是匿名新用户,定价等稳定配置
 * 无需逐请求查库;SLA 则需要准实时反映结果。会话/角色仍按请求读取
 * (匿名访客无 cookie 不触库;失败按匿名处理,营销页不可 500)。
 * 管理端写设置后经 setSettingsCacheInvalidator 级联 reset(),
 * 配置改动立即生效,不必等 TTL。
 */
import "server-only";

import { getRuntimePaymentConfig } from "@repo/shared/config/payment-runtime";
import { CREDIT_CONFIG_DEFAULTS } from "@repo/shared/credits/config";
import { getRuntimeCreditPackages } from "@repo/shared/credits/packages";
import { getPlanCapabilityMatrix } from "@repo/shared/subscription/services/plan-capabilities";
import {
  getRuntimeSettingBoolean,
  getRuntimeSettingNumber,
  getRuntimeSettingSelect,
  setSettingsCacheInvalidator,
} from "@repo/shared/system-settings";
import { getRuntimeImageBaseCreditPricing } from "@/features/image-generation/pricing-settings";
import { getRecentGenerationSlaStats } from "@/features/image-generation/sla";

import { createSingleFlightCache } from "./home-data-cache";
import {
  IMAGE_RETENTION_MODES,
  type ImageRetentionPolicy,
} from "./image-retention-policy";

/** 1h:定价/套餐等营销配置允许小时级滞后;管理端写设置会级联失效 */
const MARKETING_DATA_CACHE_TTL_MS = 3_600_000;
/** 120s:SLA 保持准实时,口径仍为最近 1000 条已完结生成 */
const SLA_CACHE_TTL_MS = 120_000;

export interface MarketingHomeData {
  runtimePaymentConfig: Awaited<ReturnType<typeof getRuntimePaymentConfig>>;
  capabilityMatrix: Awaited<ReturnType<typeof getPlanCapabilityMatrix>>;
  creditPackages: Awaited<ReturnType<typeof getRuntimeCreditPackages>>;
  creditPackageExpiryDays: number;
  imageBasePricing: Awaited<
    ReturnType<typeof getRuntimeImageBaseCreditPricing>
  >;
  imageRetentionPolicy: ImageRetentionPolicy;
  slaEnabled: boolean;
  /** SLA 统计查询失败时为 null,页面据此隐藏 SLA 区块 */
  slaStats: Awaited<ReturnType<typeof getRecentGenerationSlaStats>> | null;
}

type CachedMarketingHomeData = Omit<MarketingHomeData, "slaStats">;

async function loadMarketingData(): Promise<CachedMarketingHomeData> {
  const [
    runtimePaymentConfig,
    capabilityMatrix,
    creditPackages,
    creditPackageExpiryDays,
    imageBasePricing,
    retentionMode,
    retentionHours,
    maxImageCount,
    slaEnabled,
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
    getRuntimeSettingSelect(
      "GENERATION_IMAGE_RETENTION_MODE",
      IMAGE_RETENTION_MODES,
      "off"
    ),
    getRuntimeSettingNumber("GENERATION_IMAGE_RETENTION_HOURS", 0, {
      nonNegative: true,
    }),
    getRuntimeSettingNumber("GENERATION_IMAGE_MAX_COUNT", 10_000, {
      positive: true,
    }),
    getRuntimeSettingBoolean("MARKETING_SLA_STATUS_ENABLED", true),
  ]);
  return {
    runtimePaymentConfig,
    capabilityMatrix,
    creditPackages,
    creditPackageExpiryDays,
    imageBasePricing,
    imageRetentionPolicy: {
      mode: retentionMode,
      retentionHours,
      maxCount: maxImageCount,
    },
    slaEnabled,
  };
}

const marketingDataCache = createSingleFlightCache<CachedMarketingHomeData>(
  loadMarketingData,
  MARKETING_DATA_CACHE_TTL_MS
);
const slaCache = createSingleFlightCache(
  () =>
    getRecentGenerationSlaStats(1000).catch((err: unknown) => {
      // 查询失败也负缓存 120s,避免数据库抖动时由首页流量形成重试风暴。
      console.error("[home-data] SLA 统计查询失败,SLA 区块按隐藏处理", err);
      return null;
    }),
  SLA_CACHE_TTL_MS
);

// 级联失效:管理端任何写设置路径(shared setSystemSettings)都会触发
// clearSystemSettingsCache -> 本回调,配置改动立即生效,不必等 TTL
setSettingsCacheInvalidator(() => marketingDataCache.reset());

export async function getMarketingHomeData(): Promise<MarketingHomeData> {
  const [marketingData, slaStats] = await Promise.all([
    marketingDataCache.get(),
    slaCache.get(),
  ]);
  return { ...marketingData, slaStats };
}
