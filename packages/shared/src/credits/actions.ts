"use server";

/**
 * 积分系统 Server Actions
 *
 * 提供积分系统的前端调用接口
 */

import { z } from "zod";

import { and, eq } from "drizzle-orm";

import { db } from "@repo/database";
import { creditsTransaction, subscription } from "@repo/database/schema";
import { getBaseUrl } from "../config/payment";
import {
  getPlanFromPriceId,
  isPlanAtLeast,
  PLAN_PRIVILEGES,
  type SubscriptionPlan,
} from "../config/subscription-plan";
import { creem } from "../payment/creem";
import {
  createRuntimeEpayPurchase,
  encodeEpayMetadata,
  isRuntimeEpayPaymentProvider,
} from "../payment/epay";
import { logEvent } from "../logger/index";
import { actionClient, protectedAction } from "../safe-action";
import { getUserPlanType } from "../subscription/services/user-plan";
import { getRuntimeSettingNumber } from "../system-settings";

import {
  CREDIT_CONFIG_DEFAULTS,
  ENTERPRISE_RESOURCE_PACKAGE_ID,
  isCreditPackageVisible,
} from "./config";
import {
  getRuntimeCreditPackageById,
  getRuntimeCreditPackages,
} from "./packages";
import {
  AccountFrozenError,
  consumeCredits,
  ensureRegistrationBonus,
  ensureRegistrationBonusExpiry,
  getCreditsBalance,
  getUserActiveBatches,
  getUserTransactions,
  getUserTransactionsCount,
  grantCredits,
  InsufficientCreditsError,
} from "./core";

const withPublicCreditsAction = (name: string) =>
  actionClient.metadata({ action: `credits.${name}` });
const withProtectedCreditsAction = (name: string) =>
  protectedAction.metadata({ action: `credits.${name}` });

const CREDIT_PACKAGE_MAX_QUANTITY = 999;

async function getRuntimeRegistrationBonusCredits() {
  return getRuntimeSettingNumber(
    "REGISTRATION_BONUS_CREDITS",
    CREDIT_CONFIG_DEFAULTS.registrationBonusCredits,
    { positive: true }
  );
}

async function getRuntimeCreditsExpiryDays() {
  return getRuntimeSettingNumber(
    "CREDITS_EXPIRY_DAYS",
    CREDIT_CONFIG_DEFAULTS.creditsExpiryDays,
    { positive: true }
  );
}

async function getRuntimeFreeCreditsExpiryDays() {
  return getRuntimeSettingNumber(
    "FREE_CREDITS_EXPIRY_DAYS",
    CREDIT_CONFIG_DEFAULTS.freeCreditsExpiryDays,
    { positive: true }
  );
}

function getExpiryDate(expiryDays: number) {
  return expiryDays
    ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
    : null;
}

async function getUserPlanForCreditsAction(
  userId: string
): Promise<SubscriptionPlan> {
  return getUserPlanType(userId);
}

// ============================================
// 受保护 Actions（需要登录）
// ============================================

/**
 * 注册奖励积分
 *
 * 需要登录，且每个用户只能领取一次
 */
export const grantRegistrationBonus = withProtectedCreditsAction(
  "grantRegistrationBonus"
)
  .schema(z.object({}))
  .action(async ({ ctx }) => {
    const { userId } = ctx;

    // 幂等性检查：查询是否已发放过注册奖励
    const existing = await db
      .select({ id: creditsTransaction.id })
      .from(creditsTransaction)
      .where(
        and(
          eq(creditsTransaction.userId, userId),
          eq(creditsTransaction.type, "registration_bonus")
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await ensureRegistrationBonusExpiry(userId);
      return { success: true, alreadyGranted: true };
    }

    const bonusCredits = await getRuntimeRegistrationBonusCredits();
    const freeExpiryDays = await getRuntimeFreeCreditsExpiryDays();

    const result = await grantCredits({
      userId,
      amount: bonusCredits,
      sourceType: "bonus",
      debitAccount: "SYSTEM:registration_bonus",
      transactionType: "registration_bonus",
      expiresAt: getExpiryDate(freeExpiryDays),
      sourceRef: `registration_bonus:${userId}`,
      description: "新用户注册奖励",
      metadata: {
        bonusType: "registration",
      },
    });

    return {
      success: true,
      ...result,
    };
  });

/**
 * 获取当前用户积分余额
 *
 * 包含懒加载注册奖励机制:
 * 首次调用时，如果用户没有领过注册奖励，会自动发放注册奖励
 */
export const getMyCreditsBalance = withProtectedCreditsAction(
  "getMyCreditsBalance"
).action(async ({ ctx }) => {
  const { userId } = ctx;

  // 懒加载: 确保新用户获得注册奖励
  await ensureRegistrationBonus(
    userId,
    await getRuntimeRegistrationBonusCredits()
  );

  // 获取余额
  const balance = await getCreditsBalance(userId);

  return {
    balance: balance.balance,
    totalEarned: balance.totalEarned,
    totalSpent: balance.totalSpent,
    status: balance.status,
  };
});

/**
 * 获取当前用户活跃批次
 */
export const getMyActiveBatches = withProtectedCreditsAction(
  "getMyActiveBatches"
).action(async ({ ctx }) => {
  const { userId } = ctx;
  const batches = await getUserActiveBatches(userId);

  return batches.map((batch) => ({
    id: batch.id,
    amount: batch.amount,
    remaining: batch.remaining,
    issuedAt: batch.issuedAt,
    expiresAt: batch.expiresAt,
    sourceType: batch.sourceType,
  }));
});

/**
 * 获取当前用户交易历史
 */
export const getMyTransactions = withProtectedCreditsAction("getMyTransactions")
  .schema(
    z
      .object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
      })
      .optional()
  )
  .action(async ({ parsedInput, ctx }) => {
    const { userId } = ctx;
    const limit = parsedInput?.limit;
    const offset = parsedInput?.offset;

    const [transactions, totalCount] = await Promise.all([
      getUserTransactions(userId, {
        ...(limit !== undefined && { limit }),
        ...(offset !== undefined && { offset }),
      }),
      getUserTransactionsCount(userId),
    ]);

    return {
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        debitAccount: tx.debitAccount,
        creditAccount: tx.creditAccount,
        description: tx.description,
        metadata: tx.metadata as Record<string, unknown> | null,
        createdAt: tx.createdAt,
      })),
      totalCount,
    };
  });

/**
 * 消费积分
 *
 * 用于 AI 服务等需要消费积分的场景
 */
export const useCredits = withProtectedCreditsAction("useCredits")
  .schema(
    z.object({
      amount: z.number().positive(),
      serviceName: z.string().min(1),
      description: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const { userId } = ctx;
    const { amount, serviceName, description, metadata } = parsedInput;

    try {
      const result = await consumeCredits({
        userId,
        amount,
        serviceName,
        ...(description !== undefined && { description }),
        ...(metadata !== undefined && { metadata }),
      });

      logEvent("credits.consumed", {
        userId,
        amount,
        serviceName,
      });

      return {
        success: true,
        consumedAmount: result.consumedAmount,
        remainingBalance: result.remainingBalance,
        transactionId: result.transactionId,
      };
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        return {
          success: false,
          error: "insufficient_credits",
          message: error.message,
          required: error.required,
          available: error.available,
        };
      }
      if (error instanceof AccountFrozenError) {
        return {
          success: false,
          error: "account_frozen",
          message: error.message,
        };
      }
      throw error;
    }
  });

/**
 * 检查用户是否有足够积分
 */
export const checkCreditsAvailable = withProtectedCreditsAction(
  "checkCreditsAvailable"
)
  .schema(
    z.object({
      amount: z.number().positive(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const { userId } = ctx;
    const { amount } = parsedInput;

    const balance = await getCreditsBalance(userId);

    // balance 由 ensureCreditsBalance 保证不为 undefined
    return {
      available: balance.balance >= amount && balance.status === "active",
      currentBalance: balance.balance,
      required: amount,
      status: balance.status,
    };
  });

// ============================================
// 订阅相关积分 Actions
// ============================================

/**
 * 发放月度订阅积分
 *
 * 在订阅续费时调用
 */
export const grantMonthlySubscriptionCredits = withPublicCreditsAction(
  "grantMonthlySubscriptionCredits"
)
  .schema(
    z.object({
      userId: z.string().min(1),
      subscriptionId: z.string().min(1),
    })
  )
  .action(async ({ parsedInput }) => {
    const { userId, subscriptionId } = parsedInput;

    // 查询用户订阅以获取 priceId，根据套餐档位确定积分数量
    const [sub] = await db
      .select({ priceId: subscription.priceId })
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .limit(1);

    // 使用 subscription-plan.ts 作为单一事实来源
    let plan: SubscriptionPlan = "starter";
    if (sub?.priceId) {
      const resolved = getPlanFromPriceId(sub.priceId);
      if (resolved) {
        plan = resolved;
      }
    }
    const creditsAmount = PLAN_PRIVILEGES[plan].monthlyCredits;

    // 月度积分，下个月过期
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1);

    const result = await grantCredits({
      userId,
      amount: creditsAmount,
      sourceType: "subscription",
      debitAccount: `SUBSCRIPTION:${subscriptionId}`,
      transactionType: "monthly_grant",
      expiresAt,
      sourceRef: subscriptionId,
      description: "月度订阅积分",
      metadata: {
        subscriptionId,
        grantType: "monthly",
        planId: sub?.priceId ?? "unknown",
        creditsAmount,
      },
    });

    return {
      success: true,
      ...result,
    };
  });

/**
 * 购买积分 (内部函数)
 *
 * 由 Creem Webhook 调用，在支付成功后发放积分
 * 注意: 这个函数不应该直接被前端调用
 */
export const purchaseCredits = withProtectedCreditsAction("purchaseCredits")
  .schema(
    z.object({
      amount: z.number().positive(),
      paymentId: z.string().min(1),
      expiresInDays: z.number().optional(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const { userId } = ctx;
    const { amount, paymentId, expiresInDays } = parsedInput;

    const expiryDays = expiresInDays ?? (await getRuntimeCreditsExpiryDays());
    const expiresAt = getExpiryDate(expiryDays);

    const result = await grantCredits({
      userId,
      amount,
      sourceType: "purchase",
      debitAccount: `PAYMENT:${paymentId}`,
      transactionType: "purchase",
      expiresAt,
      sourceRef: paymentId,
      description: `购买 ${amount} 积分`,
      metadata: {
        paymentId,
        purchaseType: "direct",
      },
    });

    logEvent("credits.purchased", {
      userId,
      amount,
      paymentId,
      source: "creem",
    });

    return {
      success: true,
      ...result,
    };
  });

// ============================================
// 积分购买 Checkout
// ============================================

/**
 * 创建积分购买 Checkout Session
 *
 * 创建 Creem Checkout Session 用于购买积分套餐
 * metadata 中包含 type: 'credit_purchase' 和 credits 数量
 * Webhook 会根据这些信息发放积分
 */
export const createCreditsPurchaseCheckout = withProtectedCreditsAction(
  "createCreditsPurchaseCheckout"
)
  .schema(
    z.object({
      packageId: z.string().min(1),
      quantity: z
        .number()
        .int()
        .min(1)
        .max(CREDIT_PACKAGE_MAX_QUANTITY)
        .optional(),
      successUrl: z.string().optional(),
      cancelUrl: z.string().optional(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const { packageId, successUrl } = parsedInput;
    const { userId } = ctx;
    const requestedQuantity = parsedInput.quantity ?? 1;

    // 查找套餐配置
    const pkg = await getRuntimeCreditPackageById(packageId, {
      includeHidden: true,
    });
    if (!pkg) {
      throw new Error("无效的积分套餐");
    }
    const userPlan = await getUserPlanForCreditsAction(userId);
    const isEnterprisePack = pkg.id === ENTERPRISE_RESOURCE_PACKAGE_ID;
    if (!isEnterprisePack && !isCreditPackageVisible(pkg)) {
      throw new Error("无效的积分套餐");
    }
    if (isEnterprisePack && !isPlanAtLeast(userPlan, "enterprise")) {
      throw new Error("企业资源包仅企业版套餐可购买");
    }
    if (!isEnterprisePack && requestedQuantity !== 1) {
      throw new Error("该积分包不支持数量购买");
    }

    const quantity = isEnterprisePack ? requestedQuantity : 1;
    const creditsAmount = pkg.credits * quantity;
    const totalPrice = pkg.price * quantity;

    const baseUrl = getBaseUrl();

    const useEpay = await isRuntimeEpayPaymentProvider();
    if (!useEpay && quantity > 1) {
      throw new Error("当前支付通道暂不支持数量购买，请分次购买");
    }

    logEvent("payment.checkout.started", {
      userId,
      packageId: pkg.id,
      credits: creditsAmount,
      quantity,
      provider: useEpay ? "epay" : "creem",
      checkoutType: "credits",
    });

    if (useEpay) {
      const outTradeNo = `CR${Date.now()}${crypto.randomUUID().slice(0, 8)}`;
      const checkout = await createRuntimeEpayPurchase({
        outTradeNo,
        name:
          quantity > 1
            ? `GPT2IMAGE Credits ${pkg.credits} x ${quantity}`
            : `GPT2IMAGE Credits ${pkg.credits}`,
        money: totalPrice,
        param: encodeEpayMetadata({
          type: "credit_purchase",
          userId,
          outTradeNo,
          packageId: pkg.id,
          quantity,
        }),
      });

      return { url: checkout.url };
    }

    // 创建 Creem Checkout Session（一次性支付）
    // 注意：Creem 需要预先在后台创建产品，这里使用 packageId 作为 product_id
    // 实际使用时需要在 Creem 后台创建对应的积分产品
    const checkout = await creem.createCheckout({
      product_id: `credits_${packageId}`, // 需要在 Creem 后台创建对应产品
      success_url:
        successUrl ??
        `${baseUrl}/dashboard/settings?tab=usage&success=true&credits=${creditsAmount}`,
      request_id: `credit_purchase_${userId}_${Date.now()}`,
      metadata: {
        userId,
        type: "credit_purchase", // 关键: Webhook 用此判断类型
        credits: String(creditsAmount),
        packageId: pkg.id,
        quantity: String(quantity),
      },
    });

    return { url: checkout.checkout_url };
  });

/**
 * 获取积分套餐列表
 */
export const getCreditPackages = withProtectedCreditsAction(
  "getCreditPackages"
).action(async ({ ctx }) => {
  const userPlan = await getUserPlanForCreditsAction(ctx.userId);
  const packages = await getRuntimeCreditPackages({
    includeHidden: isPlanAtLeast(userPlan, "enterprise"),
  });
  return packages
    .filter((pkg) => {
      if (pkg.id === ENTERPRISE_RESOURCE_PACKAGE_ID) {
        return isPlanAtLeast(userPlan, "enterprise");
      }
      return isCreditPackageVisible(pkg);
    })
    .map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      credits: pkg.credits,
      price: pkg.price,
      description: pkg.description,
      popular: "popular" in pkg ? pkg.popular : false,
    }));
});
