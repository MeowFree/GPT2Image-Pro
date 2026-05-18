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
 * 免费积分默认 7 天过期。
 * 订阅积分应由调用方按套餐周期传入 expiresAt。
 */
export const CREDITS_EXPIRY_DAYS = 365;
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

/**
 * 积分包配置（一次性购买）
 *
 * payg_starter 的实际价格与积分数会在服务端按 Starter 月付配置解析，
 * 这里保留默认值用于客户端首屏和历史记录兜底。
 *
 * 旧积分包保留为隐藏项，用于兼容可能已创建但尚未回调的历史订单。
 */
export const CREDIT_PACKAGES = [
  {
    id: PAY_AS_YOU_GO_PACKAGE_ID,
    name: "Pay as you go",
    credits: 5000,
    price: 20,
    popular: true,
    description: "One-time credits priced like Starter",
  },
  {
    id: ENTERPRISE_RESOURCE_PACKAGE_ID,
    name: "Enterprise Resource Pack",
    credits: ENTERPRISE_RESOURCE_PACKAGE_DEFAULT_CREDITS,
    price: ENTERPRISE_RESOURCE_PACKAGE_DEFAULT_PRICE,
    description: "Enterprise-only 5,000-credit resource pack",
    requiresPlan: "enterprise",
    visible: false,
  },
  {
    id: "lite",
    name: "Lite",
    credits: 100,
    price: 5,
    description: "Quick top-up for a few images",
    visible: false,
  },
  {
    id: "standard",
    name: "Standard",
    credits: 500,
    price: 20,
    description: "Best value for regular use",
    visible: false,
  },
  {
    id: "pro",
    name: "Pro",
    credits: 1000,
    price: 35,
    description: "Maximum credits, maximum savings",
    visible: false,
  },
] as const;

/**
 * 积分套餐类型
 */
export type CreditPackage = (typeof CREDIT_PACKAGES)[number];

/**
 * 套餐 ID 类型
 */
export type CreditPackageId = CreditPackage["id"];

export function isCreditPackageVisible(pkg: { id: string; visible?: boolean }) {
  return !("visible" in pkg) || pkg.visible !== false;
}
