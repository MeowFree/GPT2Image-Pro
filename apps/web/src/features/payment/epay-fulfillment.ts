import { and, eq } from "drizzle-orm";

import { db } from "@repo/database";
import { creditsBatch, subscription } from "@repo/database/schema";
import {
  findRuntimePlanByPriceId,
  getSubscriptionMonthlyCredits,
  type PaidPlanId,
} from "@repo/shared/config/payment-runtime";
import { getPlanFromPriceId } from "@repo/shared/config/subscription-plan";
import { CREDIT_CONFIG_DEFAULTS } from "@repo/shared/credits/config";
import {
  grantCredits,
  voidActiveSubscriptionCreditsForUpgrade,
} from "@repo/shared/credits/core";
import { getRuntimeCreditPackageById } from "@repo/shared/credits/packages";
import { getRuntimeSettingNumber } from "@repo/shared/system-settings";
import {
  decodeEpayMetadata,
  type EpayMetadata,
  type EpayVerifyResult,
  moneyToCents,
} from "@repo/shared/payment/epay";
import { logger, logEvent } from "@repo/shared/logger";

interface FulfillEpayPaymentResult {
  metadata: EpayMetadata;
}

const inFlightFulfillments = new Map<
  string,
  Promise<FulfillEpayPaymentResult>
>();

async function getCreditPackExpiresAt() {
  const expiryDays = await getRuntimeSettingNumber(
    "CREDITS_EXPIRY_DAYS",
    CREDIT_CONFIG_DEFAULTS.creditsExpiryDays,
    { positive: true }
  );
  return expiryDays
    ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
    : null;
}

export async function fulfillSuccessfulEpayPayment(
  verifyInfo: EpayVerifyResult,
  source: "epay-webhook" | "epay-return"
): Promise<FulfillEpayPaymentResult> {
  const runningFulfillment = inFlightFulfillments.get(verifyInfo.outTradeNo);
  if (runningFulfillment) {
    return runningFulfillment;
  }

  const fulfillment = fulfillSuccessfulEpayPaymentInner(verifyInfo, source);
  inFlightFulfillments.set(verifyInfo.outTradeNo, fulfillment);

  try {
    return await fulfillment;
  } finally {
    if (inFlightFulfillments.get(verifyInfo.outTradeNo) === fulfillment) {
      inFlightFulfillments.delete(verifyInfo.outTradeNo);
    }
  }
}

async function fulfillSuccessfulEpayPaymentInner(
  verifyInfo: EpayVerifyResult,
  source: "epay-webhook" | "epay-return"
): Promise<FulfillEpayPaymentResult> {
  const metadata = decodeEpayMetadata(verifyInfo.param);
  if (!metadata || metadata.outTradeNo !== verifyInfo.outTradeNo) {
    throw new Error("Invalid or mismatched Epay metadata");
  }

  if (metadata.type === "credit_purchase") {
    await handleCreditPurchase(
      metadata.userId,
      metadata.packageId,
      verifyInfo,
      source
    );
  } else {
    await handleSubscription(
      metadata.userId,
      metadata.priceId,
      metadata,
      verifyInfo,
      source
    );
  }

  return { metadata };
}

async function handleCreditPurchase(
  userId: string,
  packageId: string | undefined,
  verifyInfo: EpayVerifyResult,
  source: "epay-webhook" | "epay-return"
) {
  if (!packageId) {
    throw new Error("Missing credit package ID");
  }

  const pkg = await getRuntimeCreditPackageById(packageId, {
    includeHidden: true,
  });
  if (!pkg) {
    throw new Error(`Unknown credit package: ${packageId}`);
  }

  if (moneyToCents(verifyInfo.money) !== moneyToCents(pkg.price)) {
    throw new Error("Epay amount does not match credit package price");
  }

  const sourceRef = `epay:${verifyInfo.outTradeNo}`;
  const [existingBatch] = await db
    .select({ id: creditsBatch.id })
    .from(creditsBatch)
    .where(
      and(
        eq(creditsBatch.sourceRef, sourceRef),
        eq(creditsBatch.sourceType, "purchase")
      )
    )
    .limit(1);

  if (existingBatch) {
    logger.info({ source, sourceRef }, "Credit purchase already fulfilled");
    return;
  }

  const expiresAt = await getCreditPackExpiresAt();

  const result = await grantCredits({
    userId,
    amount: pkg.credits,
    sourceType: "purchase",
    debitAccount: `PAYMENT:${verifyInfo.outTradeNo}`,
    transactionType: "purchase",
    expiresAt,
    sourceRef,
    description: `Epay credit pack purchase: ${pkg.credits} credits (${pkg.id})`,
    metadata: {
      provider: "epay",
      outTradeNo: verifyInfo.outTradeNo,
      tradeNo: verifyInfo.tradeNo,
      paymentMethod: verifyInfo.type,
      packageId: pkg.id,
      paidMoney: verifyInfo.money,
    },
  });

  logEvent("credits.purchased", {
    userId,
    amount: pkg.credits,
    paymentId: verifyInfo.outTradeNo,
    source: "epay",
  });
  logger.info(
    { source, batchId: result.batchId, userId },
    "Epay credit purchase fulfilled"
  );
}

async function handleSubscription(
  userId: string,
  priceId: string | undefined,
  metadata: EpayMetadata,
  verifyInfo: EpayVerifyResult,
  source: "epay-webhook" | "epay-return"
) {
  if (!priceId) {
    throw new Error("Missing subscription price ID");
  }

  const { plan, price } = await findRuntimePlanByPriceId(priceId);
  const planType = getPlanFromPriceId(priceId);
  if (!plan || !price || !planType || planType === "free") {
    throw new Error(`Unknown subscription price ID: ${priceId}`);
  }

  const expectedAmount = metadata.expectedAmount ?? price.amount;
  if (moneyToCents(verifyInfo.money) !== moneyToCents(expectedAmount)) {
    throw new Error("Epay amount does not match subscription price");
  }

  const now = new Date();
  const periodEnd = new Date(now);
  const isYearly = price.interval === "yearly";
  if (isYearly) {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  const subscriptionId = `epay_${verifyInfo.outTradeNo}`;
  const [existingBySubscriptionId] = await db
    .select({ id: subscription.id })
    .from(subscription)
    .where(eq(subscription.subscriptionId, subscriptionId))
    .limit(1);

  if (!existingBySubscriptionId) {
    const [existingByUser] = await db
      .select({ id: subscription.id })
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .limit(1);

    const values = {
      subscriptionId,
      priceId,
      status: "canceled",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: true,
      updatedAt: new Date(),
    };

    if (existingByUser) {
      await db
        .update(subscription)
        .set(values)
        .where(eq(subscription.userId, userId));
    } else {
      await db.insert(subscription).values({
        id: crypto.randomUUID(),
        userId,
        ...values,
      });
    }
  }

  await grantSubscriptionCredits({
    userId,
    subscriptionId,
    priceId,
    planType,
    isYearly,
    periodStart: now,
    periodEnd,
    outTradeNo: verifyInfo.outTradeNo,
    paymentMethod: verifyInfo.type,
    paidMoney: verifyInfo.money,
    checkoutMode: metadata.checkoutMode ?? "new_subscription",
    originalAmount: metadata.originalAmount ?? price.amount,
    prorationCredit: metadata.prorationCredit ?? 0,
    remainingDays: metadata.remainingDays ?? 0,
    periodDays: metadata.periodDays ?? 0,
    upgradeFromPriceId: metadata.upgradeFromPriceId,
    source,
  });

  logEvent("payment.checkout.completed", {
    userId,
    provider: "epay",
    priceId,
    planId: plan.id,
    subscriptionId,
    checkoutType: "subscription",
    checkoutMode: metadata.checkoutMode ?? "new_subscription",
    paidMoney: verifyInfo.money,
    prorationCredit: metadata.prorationCredit,
  });
}

async function grantSubscriptionCredits(params: {
  userId: string;
  subscriptionId: string;
  priceId: string;
  planType: PaidPlanId;
  isYearly: boolean;
  periodStart: Date;
  periodEnd: Date;
  outTradeNo: string;
  paymentMethod: string;
  paidMoney: string;
  checkoutMode: "new_subscription" | "upgrade";
  originalAmount: number;
  prorationCredit: number;
  remainingDays: number;
  periodDays: number;
  upgradeFromPriceId?: string;
  source: "epay-webhook" | "epay-return";
}) {
  const sourceRef = `epay_subscription:${params.outTradeNo}`;

  const [existingBatch] = await db
    .select({
      id: creditsBatch.id,
      issuedAt: creditsBatch.issuedAt,
    })
    .from(creditsBatch)
    .where(
      and(
        eq(creditsBatch.sourceRef, sourceRef),
        eq(creditsBatch.sourceType, "subscription")
      )
    )
    .limit(1);

  if (existingBatch) {
    if (params.checkoutMode === "upgrade") {
      const voidResult = await voidActiveSubscriptionCreditsForUpgrade({
        userId: params.userId,
        newBatchSourceRef: sourceRef,
        subscriptionId: params.subscriptionId,
        upgradeFromPriceId: params.upgradeFromPriceId,
        upgradeToPriceId: params.priceId,
        issuedBefore: existingBatch.issuedAt,
        description: `${params.planType} Epay upgrade voided previous subscription credits`,
        metadata: {
          provider: "epay",
          outTradeNo: params.outTradeNo,
          checkoutMode: params.checkoutMode,
        },
      });
      logger.info(
        {
          source: params.source,
          sourceRef,
          userId: params.userId,
          voidedAmount: voidResult.voidedAmount,
        },
        "Previous subscription credits voided for existing upgrade fulfillment"
      );
    }

    logger.info(
      { source: params.source, sourceRef },
      "Subscription credits already fulfilled"
    );
    return;
  }

  const monthlyCreditsByPlan = await getSubscriptionMonthlyCredits();
  const monthlyCredits = monthlyCreditsByPlan[params.planType];
  const creditsToGrant = params.isYearly ? monthlyCredits * 12 : monthlyCredits;
  const fallbackExpiresAt = await getCreditPackExpiresAt();
  const expiresAt = Number.isNaN(params.periodEnd.getTime())
    ? fallbackExpiresAt
    : params.periodEnd;
  const upgradeCutoff = new Date();

  const result = await grantCredits({
    userId: params.userId,
    amount: creditsToGrant,
    sourceType: "subscription",
    debitAccount: `SUBSCRIPTION:${params.subscriptionId}`,
    transactionType: "monthly_grant",
    expiresAt,
    sourceRef,
    description: params.isYearly
      ? `${params.planType} Epay yearly subscription credits (${monthlyCredits} x 12)`
      : `${params.planType} Epay monthly subscription credits`,
    metadata: {
      provider: "epay",
      subscriptionId: params.subscriptionId,
      priceId: params.priceId,
      planType: params.planType,
      interval: params.isYearly ? "year" : "month",
      periodStart: params.periodStart.toISOString(),
      periodEnd: params.periodEnd.toISOString(),
      outTradeNo: params.outTradeNo,
      paymentMethod: params.paymentMethod,
      paidMoney: params.paidMoney,
      checkoutMode: params.checkoutMode,
      originalAmount: params.originalAmount,
      prorationCredit: params.prorationCredit,
      remainingDays: params.remainingDays,
      periodDays: params.periodDays,
      ...(params.upgradeFromPriceId && {
        upgradeFromPriceId: params.upgradeFromPriceId,
      }),
    },
  });

  if (params.checkoutMode === "upgrade") {
    const voidResult = await voidActiveSubscriptionCreditsForUpgrade({
      userId: params.userId,
      newBatchSourceRef: sourceRef,
      subscriptionId: params.subscriptionId,
      upgradeFromPriceId: params.upgradeFromPriceId,
      upgradeToPriceId: params.priceId,
      issuedBefore: upgradeCutoff,
      description: `${params.planType} Epay upgrade voided previous subscription credits`,
      metadata: {
        provider: "epay",
        outTradeNo: params.outTradeNo,
        checkoutMode: params.checkoutMode,
        newBatchId: result.batchId,
      },
    });

    logger.info(
      {
        source: params.source,
        sourceRef,
        userId: params.userId,
        batchId: result.batchId,
        voidedAmount: voidResult.voidedAmount,
      },
      "Previous subscription credits voided for upgrade"
    );
  }
}
