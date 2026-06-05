import {
  getBaseUrl,
  getPricingPlansFromConfig,
  paymentConfig,
} from "./payment";
import {
  type PaymentConfig,
  PaymentType,
  type Plan,
  PlanInterval,
  type PriceConfig,
} from "../payment/types";
import {
  getRuntimeSettingBoolean,
  getRuntimeSettingNumber,
  getRuntimeSettingSelect,
  getRuntimeSettingString,
} from "../system-settings";
import { getPlanMonthlyCredits } from "../subscription/services/plan-capabilities";

export type PaidPlanId = "starter" | "pro" | "ultra" | "enterprise";

export type RuntimePaymentConfig = PaymentConfig & {
  yearlyEnabled: boolean;
};

const PLAN_PRICE_ENV_KEYS = {
  starter: {
    monthly: "NEXT_PUBLIC_CREEM_PRICE_STARTER_MONTHLY",
    yearly: "NEXT_PUBLIC_CREEM_PRICE_STARTER_YEARLY",
    monthlyAmount: "PLAN_STARTER_MONTHLY_AMOUNT",
    yearlyAmount: "PLAN_STARTER_YEARLY_AMOUNT",
  },
  pro: {
    monthly: "NEXT_PUBLIC_CREEM_PRICE_PRO_MONTHLY",
    yearly: "NEXT_PUBLIC_CREEM_PRICE_PRO_YEARLY",
    monthlyAmount: "PLAN_PRO_MONTHLY_AMOUNT",
    yearlyAmount: "PLAN_PRO_YEARLY_AMOUNT",
  },
  ultra: {
    monthly: "NEXT_PUBLIC_CREEM_PRICE_ULTRA_MONTHLY",
    yearly: "NEXT_PUBLIC_CREEM_PRICE_ULTRA_YEARLY",
    monthlyAmount: "PLAN_ULTRA_MONTHLY_AMOUNT",
    yearlyAmount: "PLAN_ULTRA_YEARLY_AMOUNT",
  },
  enterprise: {
    monthly: "NEXT_PUBLIC_CREEM_PRICE_ENTERPRISE_MONTHLY",
    yearly: "NEXT_PUBLIC_CREEM_PRICE_ENTERPRISE_YEARLY",
    monthlyAmount: "PLAN_ENTERPRISE_MONTHLY_AMOUNT",
    yearlyAmount: "PLAN_ENTERPRISE_YEARLY_AMOUNT",
  },
} as const;

const PLAN_DEFAULT_AMOUNTS = {
  starter: { monthly: 20, yearly: 144 },
  pro: { monthly: 60, yearly: 432 },
  ultra: { monthly: 200, yearly: 1440 },
  enterprise: { monthly: 800, yearly: 5760 },
} as const;

type RuntimePaymentProvider = "creem" | "epay";

function getDefaultPaymentProvider(): RuntimePaymentProvider {
  return paymentConfig.provider === "epay" ? "epay" : "creem";
}

export async function getSubscriptionMonthlyCredits() {
  return {
    starter: await getPlanMonthlyCredits("starter"),
    pro: await getPlanMonthlyCredits("pro"),
    ultra: await getPlanMonthlyCredits("ultra"),
    enterprise: await getPlanMonthlyCredits("enterprise"),
  } as const;
}

async function getRuntimePriceId(
  plan: PaidPlanId,
  interval: "monthly" | "yearly",
  // provider 已不影响回退(统一合成 ID),保留参数以兼容调用方签名。
  _provider: RuntimePaymentProvider
) {
  const key = PLAN_PRICE_ENV_KEYS[plan][interval];
  const configured = await getRuntimeSettingString(key);
  if (configured) return configured;
  // 无论 creem/epay,无第三方 Price ID 时都回退到稳定的合成 ID(${plan}_${interval}),
  // 避免新部署(默认 creem、未填 Creem Price ID)套餐 priceId 为空 → 改套餐/下单报
  // "价格 ID 不能为空 / 未定义 priceId"。epay 全程用合成 ID 闭环;creem 若要真走 Creem
  // 收款仍需在后台填真实 Price ID,否则下单会被 Creem 拒(而不是这里就崩)。
  return `${plan}_${interval}`;
}

async function getRuntimePlanPrice(
  plan: PaidPlanId,
  interval: "monthly" | "yearly",
  provider: RuntimePaymentProvider
): Promise<PriceConfig> {
  const keys = PLAN_PRICE_ENV_KEYS[plan];
  const defaultAmount = PLAN_DEFAULT_AMOUNTS[plan][interval];
  return {
    type: PaymentType.SUBSCRIPTION,
    priceId: await getRuntimePriceId(plan, interval, provider),
    amount: await getRuntimeSettingNumber(
      interval === "monthly" ? keys.monthlyAmount : keys.yearlyAmount,
      defaultAmount,
      { positive: true }
    ),
    interval: interval === "monthly" ? PlanInterval.MONTH : PlanInterval.YEAR,
  };
}

export async function getRuntimePaymentConfig(): Promise<RuntimePaymentConfig> {
  const provider = await getRuntimeSettingSelect(
    "PAYMENT_PROVIDER",
    ["creem", "epay"] as const,
    getDefaultPaymentProvider()
  );
  const yearlyEnabled = await getRuntimeSettingBoolean(
    "BILLING_YEARLY_ENABLED",
    true
  );

  const starterPrices = [
    await getRuntimePlanPrice("starter", "monthly", provider),
  ];
  const proPrices = [await getRuntimePlanPrice("pro", "monthly", provider)];
  const ultraPrices = [
    await getRuntimePlanPrice("ultra", "monthly", provider),
  ];
  const enterprisePrices = [
    await getRuntimePlanPrice("enterprise", "monthly", provider),
  ];
  if (yearlyEnabled) {
    starterPrices.push(await getRuntimePlanPrice("starter", "yearly", provider));
    proPrices.push(await getRuntimePlanPrice("pro", "yearly", provider));
    ultraPrices.push(await getRuntimePlanPrice("ultra", "yearly", provider));
    enterprisePrices.push(
      await getRuntimePlanPrice("enterprise", "yearly", provider)
    );
  }

  const plans: RuntimePaymentConfig["plans"] = {
    starter: {
      ...paymentConfig.plans.starter!,
      prices: starterPrices,
    },
    pro: {
      ...paymentConfig.plans.pro!,
      prices: proPrices,
    },
    ultra: {
      ...paymentConfig.plans.ultra!,
      prices: ultraPrices,
    },
    enterprise: {
      ...paymentConfig.plans.enterprise!,
      prices: enterprisePrices,
    },
  };
  if (paymentConfig.plans.free) {
    plans.free = paymentConfig.plans.free;
  }

  return {
    ...paymentConfig,
    provider,
    yearlyEnabled,
    plans,
  };
}

export async function getRuntimePricingPlans(): Promise<Plan[]> {
  const config = await getRuntimePaymentConfig();
  return getPricingPlansFromConfig(config);
}

export async function findRuntimePlanByPriceId(priceId: string): Promise<{
  plan: Plan | null;
  price: PriceConfig | null;
}> {
  const plans = await getRuntimePricingPlans();

  for (const plan of plans) {
    if (plan.prices) {
      const price = plan.prices.find((p) => p.priceId === priceId);
      if (price) {
        return { plan, price };
      }
    }
  }

  return { plan: null, price: null };
}

export { getBaseUrl };
