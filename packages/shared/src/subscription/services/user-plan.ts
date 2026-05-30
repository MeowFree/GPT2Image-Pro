/**
 * 用户订阅计划服务
 *
 * 提供获取用户当前计划和检查特权的功能
 */

import { desc, eq } from "drizzle-orm";
import {
  getPlanFromPriceId,
  getPlanPrivileges,
  getUpgradeMessage,
  type SubscriptionPlan,
} from "../../config/subscription-plan";
import { db } from "@repo/database";
import { subscription, user } from "@repo/database/schema";
import { isSelfUseModeEnabled } from "../../auth/self-use-mode";
import { logWarn } from "../../logger";
import { getPlanUploadLimits } from "./upload-limits";

// ============================================
// 类型定义
// ============================================

/**
 * 用户计划信息
 */
export interface UserPlanInfo {
  /** 当前计划 */
  plan: SubscriptionPlan;
  /** 计划名称 */
  planName: string;
  /** 是否有活跃订阅 */
  hasActiveSubscription: boolean;
  /** 订阅状态 */
  subscriptionStatus: string | null;
  /** 当前周期结束时间（续期日期） */
  currentPeriodEnd: Date | null;
  /** 价格 ID（用于查找价格信息） */
  priceId: string | null;
  /** 是否在周期结束时取消 */
  cancelAtPeriodEnd: boolean;
}

/**
 * 特权检查结果
 */
export interface PrivilegeCheckResult {
  /** 是否允许 */
  allowed: boolean;
  /** 错误消息（如果不允许） */
  errorMessage?: string;
  /** 升级建议（如果不允许） */
  upgradeMessage?: string;
}

// ============================================
// 核心服务函数
// ============================================

/**
 * 获取用户当前订阅计划
 *
 * 从 subscription 表查询 priceId 并映射到计划类型
 * 如果没有活跃订阅，返回 "free"
 *
 * @param userId - 用户 ID
 * @returns 用户计划信息
 */
export async function getUserPlan(userId: string): Promise<UserPlanInfo> {
  if (await isSelfUseSuperAdmin(userId)) {
    return getSelfUseSuperAdminPlan();
  }

  // 查询用户的活跃订阅。
  // subscription.userId 无唯一约束，并发 webhook 或跨渠道重订阅可能写入多行；
  // 不带 orderBy 的 limit(1) 返回顺序未定义，会让降级/退订用户被解析成更高套餐
  // （多发积分/越权能力）。这里按 updatedAt 倒序固定取最近更新的一行，
  // 使权限判定在多行场景下也是确定性的（单行场景行为不变）。
  const [userSubscription] = await db
    .select({
      priceId: subscription.priceId,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    })
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .orderBy(desc(subscription.updatedAt))
    .limit(1);

  const isActive =
    userSubscription && isSubscriptionCurrentlyActive(userSubscription);

  if (!isActive || !userSubscription) {
    return {
      plan: "free",
      planName: "Free",
      hasActiveSubscription: false,
      subscriptionStatus: userSubscription?.status ?? null,
      currentPeriodEnd: null,
      priceId: null,
      cancelAtPeriodEnd: false,
    };
  }

  const effectiveCancelAtPeriodEnd =
    isCanceledSubscriptionWithinPeriod(userSubscription) ||
    userSubscription.cancelAtPeriodEnd;

  // 从 priceId 映射到计划
  const plan = getPlanFromPriceId(userSubscription.priceId);

  if (!plan) {
    // 未知 priceId 时降级为 free 仍标记 hasActiveSubscription:true。
    // 付费用户被降级属业务异常，用结构化 Pino 日志记录便于告警与排查。
    logWarn("Unknown subscription priceId; defaulting to free", {
      userId,
      priceId: userSubscription.priceId,
    });
    return {
      plan: "free",
      planName: "Free",
      hasActiveSubscription: true,
      subscriptionStatus: userSubscription.status,
      currentPeriodEnd: userSubscription.currentPeriodEnd,
      priceId: userSubscription.priceId,
      cancelAtPeriodEnd: effectiveCancelAtPeriodEnd,
    };
  }

  const privileges = getPlanPrivileges(plan);

  return {
    plan,
    planName: privileges.name,
    hasActiveSubscription: true,
    subscriptionStatus: userSubscription.status,
    currentPeriodEnd: userSubscription.currentPeriodEnd,
    priceId: userSubscription.priceId,
    cancelAtPeriodEnd: effectiveCancelAtPeriodEnd,
  };
}

async function isSelfUseSuperAdmin(userId: string) {
  if (!(await isSelfUseModeEnabled())) return false;

  const [record] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return record?.role === "super_admin";
}

function getSelfUseSuperAdminPlan(): UserPlanInfo {
  const privileges = getPlanPrivileges("enterprise");
  return {
    plan: "enterprise",
    planName: privileges.name,
    hasActiveSubscription: true,
    subscriptionStatus: "self_use",
    currentPeriodEnd: null,
    priceId: null,
    cancelAtPeriodEnd: false,
  };
}

function isSubscriptionCurrentlyActive(sub: {
  currentPeriodEnd: Date | null;
  status: string;
}) {
  if (sub.status === "lifetime") {
    return true;
  }

  return (
    (["active", "trialing"].includes(sub.status) &&
      isSubscriptionWithinPeriod(sub)) ||
    isCanceledSubscriptionWithinPeriod(sub)
  );
}

function isSubscriptionWithinPeriod(sub: { currentPeriodEnd: Date | null }) {
  return !sub.currentPeriodEnd || sub.currentPeriodEnd > new Date();
}

function isCanceledSubscriptionWithinPeriod(sub: {
  currentPeriodEnd: Date | null;
  status: string;
}) {
  return (
    sub.status === "canceled" &&
    Boolean(sub.currentPeriodEnd) &&
    isSubscriptionWithinPeriod(sub)
  );
}

/**
 * 获取用户计划类型（简化版，仅返回计划类型）
 *
 * @param userId - 用户 ID
 * @returns 计划类型
 */
export async function getUserPlanType(
  userId: string
): Promise<SubscriptionPlan> {
  const { plan } = await getUserPlan(userId);
  return plan;
}

// ============================================
// 特权检查函数
// ============================================

/**
 * 检查文件大小是否在用户计划限制内
 *
 * @param userId - 用户 ID
 * @param fileSizeBytes - 文件大小（字节）
 * @returns 检查结果
 */
export async function checkFileSizePrivilege(
  userId: string,
  fileSizeBytes: number
): Promise<PrivilegeCheckResult> {
  const { plan } = await getUserPlan(userId);

  const limits = await getPlanUploadLimits(plan);
  if (fileSizeBytes <= limits.maxFileSizeBytes) {
    return { allowed: true };
  }

  const limit = `${limits.maxFileSizeBytes / (1024 * 1024)}MB`;
  const actualSize = `${(fileSizeBytes / (1024 * 1024)).toFixed(1)}MB`;

  return {
    allowed: false,
    errorMessage: `File size (${actualSize}) exceeds ${limit} limit for your plan.`,
    upgradeMessage: getUpgradeMessage(plan, `Files over ${limit}`),
  };
}
