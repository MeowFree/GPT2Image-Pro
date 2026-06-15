import { and, eq, gte, gt, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@repo/database";
import { creditsBatch } from "@repo/database/schema";
import {
  findRuntimePlanByPriceId,
  getSubscriptionMonthlyCredits,
  type PaidPlanId,
} from "@repo/shared/config/payment-runtime";
import {
  getPlanFromPriceId,
  PLAN_RANK,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_UPGRADE_PAYMENT_CENTS = 1;

export type ProratedSubscription = {
  userId: string;
  priceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
};

export type SubscriptionCheckoutQuote = {
  isUpgrade: boolean;
  amountDue: number;
  originalAmount: number;
  prorationCredit: number;
  dayProrationCredit: number;
  creditUsageProrationCredit: number;
  remainingSubscriptionCredits: number;
  subscriptionCredits: number;
  remainingDays: number;
  periodDays: number;
  targetPlan: SubscriptionPlan;
  upgradeFromPriceId?: string;
};

function toCents(amount: number) {
  return Math.round(amount * 100);
}

function fromCents(cents: number) {
  return cents / 100;
}

function toValidDate(value: Date | null) {
  if (!value) return null;
  return Number.isNaN(value.getTime()) ? null : value;
}

function fallbackPeriodDays(interval?: string) {
  return interval === "yearly" ? 365 : 30;
}

function isPaidPlan(plan: SubscriptionPlan | null): plan is PaidPlanId {
  return (
    plan === "starter" ||
    plan === "pro" ||
    plan === "ultra" ||
    plan === "enterprise"
  );
}

function getCycleSubscriptionCredits(
  monthlyCredits: number,
  interval?: string
) {
  return interval === "yearly" ? monthlyCredits * 12 : monthlyCredits;
}

function getPeriodDayCounts(
  current: ProratedSubscription,
  fallbackDays: number,
  now: Date
) {
  const start = toValidDate(current.currentPeriodStart);
  const end = toValidDate(current.currentPeriodEnd);
  const periodDays =
    start && end && end > start
      ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS))
      : fallbackDays;
  const remainingDays =
    end && end > now
      ? Math.min(
          periodDays,
          Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS))
        )
      : 0;

  return { periodDays, remainingDays };
}

async function getRemainingSubscriptionCredits(
  current: ProratedSubscription,
  now: Date
) {
  const start = toValidDate(current.currentPeriodStart);
  const end = toValidDate(current.currentPeriodEnd);
  const filters = [
    eq(creditsBatch.userId, current.userId),
    eq(creditsBatch.sourceType, "subscription"),
    eq(creditsBatch.status, "active"),
    gt(creditsBatch.remaining, 0),
    or(isNull(creditsBatch.expiresAt), gt(creditsBatch.expiresAt, now)),
    start ? gte(creditsBatch.issuedAt, start) : sql`true`,
    end ? lt(creditsBatch.issuedAt, end) : sql`true`,
  ];

  const [result] = await db
    .select({
      remaining: sql<number>`coalesce(sum(${creditsBatch.remaining}), 0)`.mapWith(
        Number
      ),
    })
    .from(creditsBatch)
    .where(and(...filters));

  return Math.max(0, result?.remaining ?? 0);
}

export async function createSubscriptionCheckoutQuote(
  current: ProratedSubscription,
  targetPriceId: string,
  now = new Date()
): Promise<SubscriptionCheckoutQuote> {
  const targetPlan = getPlanFromPriceId(targetPriceId);
  const { price: targetPrice } = await findRuntimePlanByPriceId(targetPriceId);
  if (!isPaidPlan(targetPlan) || !targetPrice) {
    throw new Error("无效的目标套餐");
  }

  if (!current.priceId) {
    throw new Error("找不到当前订阅套餐");
  }

  const currentPlan = getPlanFromPriceId(current.priceId);
  const { price: currentPrice } = await findRuntimePlanByPriceId(
    current.priceId
  );
  if (!isPaidPlan(currentPlan) || !currentPrice) {
    throw new Error("找不到当前订阅套餐");
  }

  if (PLAN_RANK[targetPlan] <= PLAN_RANK[currentPlan]) {
    throw new Error("只能升级到更高级套餐");
  }

  if (currentPrice.interval !== targetPrice.interval) {
    throw new Error("升级套餐需要选择与当前订阅相同的计费周期");
  }

  const { periodDays, remainingDays } = getPeriodDayCounts(
    current,
    fallbackPeriodDays(currentPrice.interval),
    now
  );
  const currentAmountCents = toCents(currentPrice.amount);
  const targetAmountCents = toCents(targetPrice.amount);
  const dayProrationCreditCents = Math.min(
    currentAmountCents,
    Math.floor((currentAmountCents * remainingDays) / periodDays)
  );
  const monthlyCreditsByPlan = await getSubscriptionMonthlyCredits();
  const subscriptionCredits = getCycleSubscriptionCredits(
    monthlyCreditsByPlan[currentPlan],
    currentPrice.interval
  );
  const remainingSubscriptionCredits = await getRemainingSubscriptionCredits(
    current,
    now
  );
  const cappedRemainingSubscriptionCredits = Math.min(
    remainingSubscriptionCredits,
    subscriptionCredits
  );
  const creditUsageProrationCreditCents =
    subscriptionCredits > 0
      ? Math.min(
          currentAmountCents,
          Math.floor(
            (currentAmountCents * cappedRemainingSubscriptionCredits) /
              subscriptionCredits
          )
        )
      : 0;
  const prorationCreditCents = Math.min(
    dayProrationCreditCents,
    creditUsageProrationCreditCents
  );
  const amountDueCents = Math.max(
    MIN_UPGRADE_PAYMENT_CENTS,
    targetAmountCents - prorationCreditCents
  );

  return {
    isUpgrade: true,
    amountDue: fromCents(amountDueCents),
    originalAmount: fromCents(targetAmountCents),
    prorationCredit: fromCents(prorationCreditCents),
    dayProrationCredit: fromCents(dayProrationCreditCents),
    creditUsageProrationCredit: fromCents(creditUsageProrationCreditCents),
    remainingSubscriptionCredits,
    subscriptionCredits,
    remainingDays,
    periodDays,
    targetPlan,
    upgradeFromPriceId: current.priceId,
  };
}
