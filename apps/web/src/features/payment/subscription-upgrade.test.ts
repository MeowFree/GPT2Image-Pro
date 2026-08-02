/**
 * 订阅升级补差报价（createSubscriptionCheckoutQuote）回归测试。
 *
 * 该函数以分为单位计算用户升级实付金额：按"剩余天数比例"与"剩余订阅积分
 * 比例"分别折算抵扣后取较小者，再以 max(MIN_UPGRADE_PAYMENT_CENTS, 目标价 -
 * 抵扣) 作应付。算错即多收/少收，属硬约束的金额逻辑。
 *
 * 测试策略：注入固定 now 使天数比例确定化；mock @repo/database 控制
 * "剩余订阅积分"求和；mock 运行时套餐解析与月度积分使价格/积分稳定；
 * getPlanFromPriceId 以测试 priceId 映射到套餐，PLAN_RANK 保留真实实现。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const remainingCreditsRef = vi.hoisted(() => ({ value: 0 }));

const dbMock = vi.hoisted(() => {
  const selectBuilder = {
    from: vi.fn(() => selectBuilder),
    where: vi.fn(async () => [{ remaining: remainingCreditsRef.value }]),
  };
  return { select: vi.fn(() => selectBuilder) };
});

vi.mock("@repo/database", () => ({ db: dbMock }));
vi.mock("@repo/database/schema", () => ({
  creditsBatch: {
    userId: "user_id",
    sourceType: "source_type",
    status: "status",
    remaining: "remaining",
    expiresAt: "expires_at",
    issuedAt: "issued_at",
  },
}));

const planByPriceId: Record<
  string,
  "starter" | "pro" | "ultra" | "enterprise"
> = {
  starter_monthly: "starter",
  pro_monthly: "pro",
  ultra_monthly: "ultra",
  enterprise_monthly: "enterprise",
  starter_yearly: "starter",
  pro_yearly: "pro",
  // 仅用于触发最小支付下限：高等级但价格极低（模拟价格配置异常）。
  cheap_pro_monthly: "pro",
};

const priceByPriceId: Record<
  string,
  { amount: number; interval: "monthly" | "yearly" }
> = {
  starter_monthly: { amount: 20, interval: "monthly" },
  pro_monthly: { amount: 50, interval: "monthly" },
  ultra_monthly: { amount: 100, interval: "monthly" },
  enterprise_monthly: { amount: 200, interval: "monthly" },
  starter_yearly: { amount: 200, interval: "yearly" },
  pro_yearly: { amount: 500, interval: "yearly" },
  cheap_pro_monthly: { amount: 0.1, interval: "monthly" },
};

vi.mock("@repo/shared/config/payment-runtime", () => ({
  findRuntimePlanByPriceId: vi.fn(async (priceId: string) => {
    const price = priceByPriceId[priceId];
    return { plan: null, price: price ? { ...price } : null };
  }),
  getSubscriptionMonthlyCredits: vi.fn(async () => ({
    starter: 5000,
    pro: 20000,
    ultra: 80000,
    enterprise: 320000,
  })),
}));

vi.mock("@repo/shared/config/subscription-plan", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@repo/shared/config/subscription-plan")
    >();
  return {
    ...actual,
    getPlanFromPriceId: vi.fn(
      (priceId: string) => planByPriceId[priceId] ?? null
    ),
  };
});

import {
  createSubscriptionCheckoutQuote,
  isEpayCurrentPlanRenewal,
  type ProratedSubscription,
} from "./subscription-upgrade";

const NOW = new Date("2026-01-15T00:00:00.000Z");

function makeCurrent(
  overrides: Partial<ProratedSubscription> = {}
): ProratedSubscription {
  return {
    userId: "user-1",
    priceId: "starter_monthly",
    // 30 天周期，恰好过半（剩余 15 天）。
    currentPeriodStart: new Date("2025-12-31T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-01-30T00:00:00.000Z"),
    ...overrides,
  };
}

describe("isEpayCurrentPlanRenewal", () => {
  it("allows the current price only through Epay", () => {
    expect(
      isEpayCurrentPlanRenewal("pro_monthly", "pro_monthly", true)
    ).toBe(true);
    expect(
      isEpayCurrentPlanRenewal("pro_monthly", "pro_monthly", false)
    ).toBe(false);
  });

  it("does not classify a different or missing current price as renewal", () => {
    expect(
      isEpayCurrentPlanRenewal("starter_monthly", "pro_monthly", true)
    ).toBe(false);
    expect(isEpayCurrentPlanRenewal(null, "pro_monthly", true)).toBe(false);
  });
});

describe("createSubscriptionCheckoutQuote", () => {
  beforeEach(() => {
    remainingCreditsRef.value = 0;
  });

  it("prorates by remaining days when full subscription credits remain", async () => {
    // 周期过半 + 全部订阅积分仍在（5000/5000）：积分比例抵扣为满额 current 价
    // （20 元），天数比例抵扣为半价（10 元），取较小的 10 元。
    remainingCreditsRef.value = 5000;
    const quote = await createSubscriptionCheckoutQuote(
      makeCurrent(),
      "pro_monthly",
      NOW
    );
    expect(quote.isUpgrade).toBe(true);
    expect(quote.dayProrationCredit).toBeCloseTo(10, 5);
    expect(quote.creditUsageProrationCredit).toBeCloseTo(20, 5);
    expect(quote.prorationCredit).toBeCloseTo(10, 5);
    // 目标价 50 - 抵扣 10 = 40。
    expect(quote.amountDue).toBeCloseTo(40, 5);
    expect(quote.originalAmount).toBeCloseTo(50, 5);
    expect(quote.upgradeFromPriceId).toBe("starter_monthly");
    expect(quote.targetPlan).toBe("pro");
    expect(quote.remainingDays).toBe(15);
    expect(quote.periodDays).toBe(30);
  });

  it("caps proration by unused subscription credits (takes the smaller side)", async () => {
    // 仍剩半个周期，但积分几乎用尽（500/5000）：积分比例抵扣（current 20 元的
    // 1/10 = 2 元）远小于天数比例抵扣（半价 10 元），最终取较小的 2 元。
    remainingCreditsRef.value = 500;
    const quote = await createSubscriptionCheckoutQuote(
      makeCurrent(),
      "pro_monthly",
      NOW
    );
    expect(quote.dayProrationCredit).toBeCloseTo(10, 5);
    expect(quote.creditUsageProrationCredit).toBeCloseTo(2, 5);
    expect(quote.prorationCredit).toBeCloseTo(2, 5);
    expect(quote.amountDue).toBeCloseTo(48, 5);
  });

  it("enforces the MIN_UPGRADE_PAYMENT_CENTS floor when proration covers the target", async () => {
    // 目标价被配置成极低（0.1 元）但等级更高，抵扣（pro? 否，当前 starter 20 元的
    // 半价 = 10 元）远超目标价，应用最小支付下限 1 分（0.01 元）兜底，不返回 0/负数。
    remainingCreditsRef.value = 5000;
    const quote = await createSubscriptionCheckoutQuote(
      makeCurrent(),
      "cheap_pro_monthly",
      NOW
    );
    expect(quote.amountDue).toBeCloseTo(0.01, 5);
  });

  it("uses fallback period days and zero remaining when period dates are missing", async () => {
    // 缺失周期起止：周期天数回退月付 30、剩余天数按无 end 记 0，故无天数抵扣。
    remainingCreditsRef.value = 0;
    const quote = await createSubscriptionCheckoutQuote(
      makeCurrent({ currentPeriodStart: null, currentPeriodEnd: null }),
      "pro_monthly",
      NOW
    );
    expect(quote.periodDays).toBe(30);
    expect(quote.remainingDays).toBe(0);
    expect(quote.prorationCredit).toBe(0);
    expect(quote.amountDue).toBeCloseTo(50, 5);
  });

  it("throws on same-or-lower target plan", async () => {
    await expect(
      createSubscriptionCheckoutQuote(
        makeCurrent({ priceId: "pro_monthly" }),
        "starter_monthly",
        NOW
      )
    ).rejects.toThrow("只能升级到更高级套餐");
  });

  it("throws on billing interval mismatch", async () => {
    await expect(
      createSubscriptionCheckoutQuote(
        makeCurrent({ priceId: "starter_monthly" }),
        "pro_yearly",
        NOW
      )
    ).rejects.toThrow("升级套餐需要选择与当前订阅相同的计费周期");
  });

  it("throws when current priceId is null", async () => {
    await expect(
      createSubscriptionCheckoutQuote(
        makeCurrent({ priceId: null }),
        "pro_monthly",
        NOW
      )
    ).rejects.toThrow("找不到当前订阅套餐");
  });

  it("throws on an invalid target priceId", async () => {
    await expect(
      createSubscriptionCheckoutQuote(makeCurrent(), "unknown_price", NOW)
    ).rejects.toThrow("无效的目标套餐");
  });
});
