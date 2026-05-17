/**
 * 支付配置
 *
 * 定义支付系统的全局配置和计划信息
 */

import {
  type PaymentConfig,
  PaymentType,
  type Plan,
  PlanInterval,
  type PriceConfig,
  type PricingConfig,
} from "../payment/types";

const paymentProvider =
  process.env.PAYMENT_PROVIDER?.trim().toLowerCase() === "epay" ||
  process.env.NEXT_PUBLIC_PAYMENT_PROVIDER?.trim().toLowerCase() === "epay"
    ? "epay"
    : "creem";

// ============================================
// 环境变量中的价格 ID
// ============================================

/**
 * 产品/价格 ID（从环境变量读取）
 *
 * Creem 模式下使用 NEXT_PUBLIC_CREEM_PRICE_*。
 * 易支付模式不依赖第三方后台产品 ID，使用稳定的本地 priceId。
 */
export const PRICE_IDS = {
  STARTER_MONTHLY:
    process.env.NEXT_PUBLIC_CREEM_PRICE_STARTER_MONTHLY ??
    (paymentProvider === "epay" ? "starter_monthly" : ""),
  STARTER_YEARLY:
    process.env.NEXT_PUBLIC_CREEM_PRICE_STARTER_YEARLY ??
    (paymentProvider === "epay" ? "starter_yearly" : ""),
  PRO_MONTHLY:
    process.env.NEXT_PUBLIC_CREEM_PRICE_PRO_MONTHLY ??
    (paymentProvider === "epay" ? "pro_monthly" : ""),
  PRO_YEARLY:
    process.env.NEXT_PUBLIC_CREEM_PRICE_PRO_YEARLY ??
    (paymentProvider === "epay" ? "pro_yearly" : ""),
  ULTRA_MONTHLY:
    process.env.NEXT_PUBLIC_CREEM_PRICE_ULTRA_MONTHLY ??
    (paymentProvider === "epay" ? "ultra_monthly" : ""),
  ULTRA_YEARLY:
    process.env.NEXT_PUBLIC_CREEM_PRICE_ULTRA_YEARLY ??
    (paymentProvider === "epay" ? "ultra_yearly" : ""),
} as const;

// ============================================
// 订阅积分配额（每月）
// ============================================

export const SUBSCRIPTION_MONTHLY_CREDITS = {
  starter: 5000,
  pro: 20000,
  ultra: 80000,
} as const;

// ============================================
// 支付系统配置
// ============================================

/**
 * 支付系统全局配置
 */
export const paymentConfig: PaymentConfig = {
  /** 支付提供商 */
  provider: paymentProvider,

  /** 货币 */
  currency: "CNY",

  /** 年付折扣百分比（约等于送 5 个月） */
  yearlyDiscount: 40,

  /** 支付完成后重定向 */
  redirectAfterCheckout: "/dashboard",

  /** 取消支付后重定向 */
  redirectAfterCancel: "/pricing",

  /** 计划配置 */
  plans: {
    free: {
      id: "free",
      isFree: true,
    },

    starter: {
      id: "starter",
      prices: [
        {
          type: PaymentType.SUBSCRIPTION,
          priceId: PRICE_IDS.STARTER_MONTHLY,
          amount: 20,
          interval: PlanInterval.MONTH,
        },
        {
          type: PaymentType.SUBSCRIPTION,
          priceId: PRICE_IDS.STARTER_YEARLY,
          amount: 144,
          interval: PlanInterval.YEAR,
        },
      ],
    },

    pro: {
      id: "pro",
      popular: true,
      prices: [
        {
          type: PaymentType.SUBSCRIPTION,
          priceId: PRICE_IDS.PRO_MONTHLY,
          amount: 60,
          interval: PlanInterval.MONTH,
        },
        {
          type: PaymentType.SUBSCRIPTION,
          priceId: PRICE_IDS.PRO_YEARLY,
          amount: 432,
          interval: PlanInterval.YEAR,
        },
      ],
    },

    ultra: {
      id: "ultra",
      prices: [
        {
          type: PaymentType.SUBSCRIPTION,
          priceId: PRICE_IDS.ULTRA_MONTHLY,
          amount: 200,
          interval: PlanInterval.MONTH,
        },
        {
          type: PaymentType.SUBSCRIPTION,
          priceId: PRICE_IDS.ULTRA_YEARLY,
          amount: 1440,
          interval: PlanInterval.YEAR,
        },
      ],
    },
  },
};

// ============================================
// 计划显示信息
// ============================================

/**
 * 获取计划显示信息
 *
 * 返回用于定价页面展示的完整计划信息
 */
export function getPricingPlans(_t?: (key: string) => string): Plan[] {
  return getPricingPlansFromConfig(paymentConfig);
}

export function getPricingPlansFromConfig(config: PaymentConfig): Plan[] {
  const plans: Plan[] = [];
  // 免费计划
  if (config.plans.free) {
    plans.push({
      ...config.plans.free,
      name: "Free",
      description: "Try basic image generation",
      features: [
        "100 credits (one-time)",
        "Text-to-image and image editing",
        "Standard image resolution",
        "Up to 10 images per batch",
        "Download & share",
        "Gallery history saved forever",
      ],
      cta: "Get Started",
    });
  }

  // Starter 计划
  if (config.plans.starter) {
    plans.push({
      ...config.plans.starter,
      name: "Starter",
      description: "External API keys and custom API access",
      features: [
        "5,000 credits / month",
        "Text-to-image and image editing",
        "Standard image resolution",
        "Up to 10 images per batch",
        "External API key calls",
        "Custom OpenAI-compatible API",
        "Download & share",
        "Gallery history saved forever",
        "Email support",
      ],
      cta: "Subscribe",
    });
  }

  // Pro 计划
  if (config.plans.pro) {
    plans.push({
      ...config.plans.pro,
      name: "Pro",
      description: "Adds chat-to-image and Responses image API",
      features: [
        "20,000 credits / month",
        "Text-to-image and image editing",
        "High resolution output",
        "Up to 10 images per batch",
        "Chat-to-image mode",
        "Priority generation queue",
        "Download & share",
        "Gallery history saved forever",
        "External API key calls",
        "Custom OpenAI-compatible API",
        "Priority support",
      ],
      cta: "Subscribe",
    });
  }

  // Ultra 计划
  if (config.plans.ultra) {
    plans.push({
      ...config.plans.ultra,
      name: "Ultra",
      description: "Chat-to-image with GPT-5.5",
      features: [
        "80,000 credits / month",
        "Text-to-image and image editing",
        "Maximum resolution output",
        "Up to 10 images per batch",
        "Chat-to-image supports GPT-5.5",
        "Highest priority queue",
        "Download & share",
        "Gallery history saved forever",
        "External API key calls",
        "Custom OpenAI-compatible API",
        "Dedicated support",
      ],
      cta: "Subscribe",
    });
  }

  return plans;
}

/**
 * 获取定价页面完整配置
 */
export function getPricingConfig(): PricingConfig {
  return {
    title: "Simple, transparent pricing",
    subtitle: "Start free, upgrade when you need more credits.",
    frequencies: ["Monthly", "Yearly"],
    yearlyDiscount: paymentConfig.yearlyDiscount,
    plans: getPricingPlans(),
  };
}

/**
 * 根据价格 ID 查找计划和价格信息
 */
export function findPlanByPriceId(priceId: string): {
  plan: Plan | null;
  price: PriceConfig | null;
} {
  const plans = getPricingPlans();

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

/**
 * 获取计划的价格（根据周期）
 */
export function getPlanPrice(
  plan: Plan,
  interval: PlanInterval
): PriceConfig | null {
  if (!plan.prices) return null;
  return plan.prices.find((p) => p.interval === interval) ?? null;
}

/**
 * 获取应用的基础 URL
 */
export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}
