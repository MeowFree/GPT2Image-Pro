import { findPlanByPriceId } from "@repo/shared/config/payment";
import {
  getPlanFromPriceId,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_UPGRADE_PAYMENT_CENTS = 1;

const PLAN_RANK: Record<SubscriptionPlan, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  ultra: 3,
};

export type ProratedSubscription = {
  priceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
};

export type SubscriptionCheckoutQuote = {
  isUpgrade: boolean;
  amountDue: number;
  originalAmount: number;
  prorationCredit: number;
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

export function createSubscriptionCheckoutQuote(
  current: ProratedSubscription,
  targetPriceId: string,
  now = new Date()
): SubscriptionCheckoutQuote {
  const targetPlan = getPlanFromPriceId(targetPriceId);
  const { price: targetPrice } = findPlanByPriceId(targetPriceId);
  if (!targetPlan || targetPlan === "free" || !targetPrice) {
    throw new Error("无效的目标套餐");
  }

  if (!current.priceId) {
    throw new Error("找不到当前订阅套餐");
  }

  const currentPlan = getPlanFromPriceId(current.priceId);
  const { price: currentPrice } = findPlanByPriceId(current.priceId);
  if (!currentPlan || currentPlan === "free" || !currentPrice) {
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
  const prorationCreditCents = Math.min(
    currentAmountCents,
    Math.floor((currentAmountCents * remainingDays) / periodDays)
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
    remainingDays,
    periodDays,
    targetPlan,
    upgradeFromPriceId: current.priceId,
  };
}
