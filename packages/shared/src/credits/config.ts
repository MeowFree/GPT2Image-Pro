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
 * 非订阅积分默认过期天数（从发放日起）
 * 订阅积分应由调用方按套餐周期传入 expiresAt。
 */
export const CREDITS_EXPIRY_DAYS = 365;

/**
 * 积分包配置（一次性购买）
 *
 * 定价策略：比订阅略贵，鼓励订阅
 * 积分包适合偶尔使用或不想订阅的用户
 */
export const CREDIT_PACKAGES = [
  {
    id: "lite",
    name: "Lite",
    credits: 100,
    price: 5,
    description: "Quick top-up for a few images",
  },
  {
    id: "standard",
    name: "Standard",
    credits: 500,
    price: 20,
    popular: true,
    description: "Best value for regular use",
  },
  {
    id: "pro",
    name: "Pro",
    credits: 1000,
    price: 35,
    description: "Maximum credits, maximum savings",
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
