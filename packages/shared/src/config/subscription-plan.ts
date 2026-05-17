/**
 * 订阅计划权限配置
 *
 * 定义各计划的特权限制和功能访问权限
 */

import { PRICE_IDS } from "./payment";

// ============================================
// 计划类型定义
// ============================================

/**
 * 订阅计划类型
 */
export type SubscriptionPlan = "free" | "starter" | "pro" | "ultra";

/**
 * 对话模式旗舰模型
 */
export const GPT54_CHAT_MODEL = "gpt-5.4";
export const GPT54_MINI_CHAT_MODEL = "gpt-5.4-mini";
export const GPT55_CHAT_MODEL = "gpt-5.5";

export const RESPONSES_IMAGE_MODELS = [
  GPT54_CHAT_MODEL,
  GPT54_MINI_CHAT_MODEL,
  GPT55_CHAT_MODEL,
] as const;

export type ResponsesImageModel = (typeof RESPONSES_IMAGE_MODELS)[number];

/**
 * 队列优先级
 */
export type QueuePriority = "normal" | "priority" | "highest";

/**
 * 计划特权配置
 */
export interface PlanPrivileges {
  /** 计划名称 */
  name: string;
  /** 单文件大小上限 (bytes) */
  maxFileSizeBytes: number;
  /** 队列优先级 */
  queuePriority: QueuePriority;
  /** 月度积分配额 (免费版为一次性) */
  monthlyCredits: number;
}

// ============================================
// 计划特权配置
// ============================================

/**
 * 各计划的特权配置
 */
export const PLAN_PRIVILEGES: Record<SubscriptionPlan, PlanPrivileges> = {
  free: {
    name: "Free",
    maxFileSizeBytes: 5 * 1024 * 1024, // 5MB
    queuePriority: "normal",
    monthlyCredits: 100, // 一次性
  },
  starter: {
    name: "Starter",
    maxFileSizeBytes: 20 * 1024 * 1024, // 20MB
    queuePriority: "normal",
    monthlyCredits: 5_000,
  },
  pro: {
    name: "Pro",
    maxFileSizeBytes: 50 * 1024 * 1024, // 50MB
    queuePriority: "priority",
    monthlyCredits: 20_000,
  },
  ultra: {
    name: "Ultra",
    maxFileSizeBytes: 100 * 1024 * 1024, // 100MB
    queuePriority: "highest",
    monthlyCredits: 80_000,
  },
};

/**
 * 计划等级，用于功能门槛判断
 */
export const PLAN_RANK: Record<SubscriptionPlan, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  ultra: 3,
};

// ============================================
// Price ID 到计划的映射
// ============================================

/**
 * 根据 Price ID 获取计划类型
 *
 * @param priceId - 价格/产品 ID
 * @returns 计划类型，如果未找到则返回 null
 */
export function getPlanFromPriceId(priceId: string): SubscriptionPlan | null {
  // Starter
  if (
    priceId === PRICE_IDS.STARTER_MONTHLY ||
    priceId === PRICE_IDS.STARTER_YEARLY
  ) {
    return "starter";
  }

  // Pro
  if (priceId === PRICE_IDS.PRO_MONTHLY || priceId === PRICE_IDS.PRO_YEARLY) {
    return "pro";
  }

  // Ultra
  if (
    priceId === PRICE_IDS.ULTRA_MONTHLY ||
    priceId === PRICE_IDS.ULTRA_YEARLY
  ) {
    return "ultra";
  }

  return null;
}

// ============================================
// 特权检查工具函数
// ============================================

/**
 * 获取计划的特权配置
 *
 * @param plan - 订阅计划
 * @returns 计划特权配置
 */
export function getPlanPrivileges(plan: SubscriptionPlan): PlanPrivileges {
  return PLAN_PRIVILEGES[plan];
}

/**
 * 检查当前计划是否达到目标计划等级
 *
 * @param plan - 当前计划
 * @param requiredPlan - 需要达到的最低计划
 * @returns 是否满足等级要求
 */
export function isPlanAtLeast(
  plan: SubscriptionPlan,
  requiredPlan: SubscriptionPlan
): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[requiredPlan];
}

/**
 * 是否允许创建和使用外接 API Key
 */
export function canUseExternalApi(plan: SubscriptionPlan): boolean {
  return isPlanAtLeast(plan, "starter");
}

/**
 * 是否允许配置自己的 OpenAI 兼容 API
 */
export function canUseCustomApi(plan: SubscriptionPlan): boolean {
  return isPlanAtLeast(plan, "starter");
}

/**
 * 是否允许使用对话生图
 */
export function canUseChat(plan: SubscriptionPlan): boolean {
  return isPlanAtLeast(plan, "starter");
}

/**
 * 是否允许自定义提示词优化开关
 */
export function canUsePromptOptimization(plan: SubscriptionPlan): boolean {
  return isPlanAtLeast(plan, "pro");
}

/**
 * 是否允许对话生图使用 GPT-5.5
 */
export function canUseGpt55Chat(plan: SubscriptionPlan): boolean {
  return isPlanAtLeast(plan, "ultra");
}

/**
 * 检查文件大小是否在限制内
 *
 * @param plan - 订阅计划
 * @param fileSizeBytes - 文件大小（字节）
 * @returns 是否在限制内
 */
export function isWithinFileSizeLimit(
  plan: SubscriptionPlan,
  fileSizeBytes: number
): boolean {
  return fileSizeBytes <= PLAN_PRIVILEGES[plan].maxFileSizeBytes;
}

/**
 * 格式化文件大小限制（用于错误消息）
 *
 * @param plan - 订阅计划
 * @returns 格式化的文件大小字符串（如 "5MB"）
 */
export function formatFileSizeLimit(plan: SubscriptionPlan): string {
  const bytes = PLAN_PRIVILEGES[plan].maxFileSizeBytes;
  return `${bytes / (1024 * 1024)}MB`;
}

/**
 * 获取升级建议（当特权不足时）
 *
 * @param currentPlan - 当前计划
 * @param requiredFeature - 需要的功能描述
 * @returns 升级建议消息
 */
export function getUpgradeMessage(
  currentPlan: SubscriptionPlan,
  requiredFeature: string
): string {
  const upgradeTo =
    currentPlan === "free"
      ? "Starter"
      : currentPlan === "starter"
        ? "Pro"
        : "Ultra";

  return `${requiredFeature} requires ${upgradeTo} plan or higher. Please upgrade to continue.`;
}
