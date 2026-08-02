import type { SubscriptionPlan } from "../config/subscription-plan";

/**
 * 积分系统配置
 *
 * 定义积分系统的常量和套餐配置
 */

// ============================================
// 积分配置常量
// ============================================

/**
 * 注册奖励积分数量
 */
export const REGISTRATION_BONUS_CREDITS = 100;

/**
 * 非订阅付费积分默认过期天数（从发放日起）。
 * 0 表示永不过期。
 * 免费积分默认 7 天过期。
 * 订阅积分应由调用方按套餐周期传入 expiresAt。
 */
export const CREDITS_EXPIRY_DAYS = 0;
export const FREE_CREDITS_EXPIRY_DAYS = 7;

export const CREDIT_CONFIG_DEFAULTS = {
  registrationBonusCredits: REGISTRATION_BONUS_CREDITS,
  creditsExpiryDays: CREDITS_EXPIRY_DAYS,
  freeCreditsExpiryDays: FREE_CREDITS_EXPIRY_DAYS,
} as const;

export const PAY_AS_YOU_GO_PACKAGE_ID = "payg_starter";
export const ENTERPRISE_RESOURCE_PACKAGE_ID = "enterprise_resource";
export const ENTERPRISE_RESOURCE_PACKAGE_DEFAULT_CREDITS = 5000;
export const ENTERPRISE_RESOURCE_PACKAGE_DEFAULT_PRICE = 15;

export type CreditPackagePlanMap<T> = Partial<Record<SubscriptionPlan, T>>;

/**
 * 积分包配置（一次性购买）。
 *
 * price 是兜底价格；pricesByPlan 可按用户当前套餐覆盖价格。
 * Creem 一次性产品价格在 Creem 后台预建，按套餐定价时需要配置对应
 * creemProductIdsByPlan；Epay 会直接使用站内计算出的价格。
 */
export type CreditPackageConfig = {
  id: string;
  name: string;
  nameZh?: string;
  credits: number;
  price: number;
  description: string;
  descriptionZh?: string;
  popular?: boolean;
  visible?: boolean;
  requiresPlan?: SubscriptionPlan;
  allowQuantity?: boolean;
  maxQuantity?: number;
  pricesByPlan?: CreditPackagePlanMap<number>;
  creemProductId?: string;
  creemProductIdsByPlan?: CreditPackagePlanMap<string>;
};

export function getLocalizedCreditPackageName(
  pkg: Pick<CreditPackageConfig, "name" | "nameZh">,
  locale: string
) {
  return locale.toLowerCase().startsWith("zh")
    ? pkg.nameZh?.trim() || pkg.name
    : pkg.name;
}

export function getLocalizedCreditPackageDescription(
  pkg: Pick<CreditPackageConfig, "description" | "descriptionZh">,
  locale: string
) {
  return locale.toLowerCase().startsWith("zh")
    ? pkg.descriptionZh?.trim() || pkg.description
    : pkg.description;
}

/**
 * 默认积分包。旧积分包保留为隐藏项，用于兼容可能已创建但尚未回调的历史订单。
 */
export const CREDIT_PACKAGES = [
  {
    id: PAY_AS_YOU_GO_PACKAGE_ID,
    name: "Pay as you go",
    nameZh: "按量付费",
    credits: 5000,
    price: 20,
    popular: true,
    description: "One-time credits priced like Starter",
    descriptionZh: "与入门版同价同积分的一次性积分包",
  },
  {
    id: ENTERPRISE_RESOURCE_PACKAGE_ID,
    name: "Enterprise Resource Pack",
    nameZh: "企业资源包",
    credits: ENTERPRISE_RESOURCE_PACKAGE_DEFAULT_CREDITS,
    price: ENTERPRISE_RESOURCE_PACKAGE_DEFAULT_PRICE,
    description: "Enterprise-only 5,000-credit resource pack",
    descriptionZh: "企业版专属资源包，可按数量购买",
    requiresPlan: "enterprise",
    allowQuantity: true,
    maxQuantity: 999,
    visible: false,
  },
  {
    id: "lite",
    name: "Lite",
    nameZh: "轻量包",
    credits: 100,
    price: 5,
    description: "Quick top-up for a few images",
    descriptionZh: "少量补充，适合临时生成几张图片",
    visible: false,
  },
  {
    id: "standard",
    name: "Standard",
    nameZh: "标准包",
    credits: 500,
    price: 20,
    description: "Best value for regular use",
    descriptionZh: "适合日常使用的高性价比选择",
    visible: false,
  },
  {
    id: "pro",
    name: "Pro",
    nameZh: "专业包",
    credits: 1000,
    price: 35,
    description: "Maximum credits, maximum savings",
    descriptionZh: "更多积分，更适合高频创作",
    visible: false,
  },
] as const satisfies readonly CreditPackageConfig[];

/**
 * 积分套餐类型
 */
export type CreditPackage = CreditPackageConfig;

/**
 * 套餐 ID 类型
 */
export type CreditPackageId = string;

export function isCreditPackageVisible(pkg: { id: string; visible?: boolean }) {
  return !("visible" in pkg) || pkg.visible !== false;
}
