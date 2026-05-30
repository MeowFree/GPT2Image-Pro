import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selfUseEnabled: true,
  userRows: [] as Array<{ role: string }>,
  subscriptionRows: [] as Array<{
    priceId: string;
    status: string;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  }>,
}));

const schemaMock = vi.hoisted(() => ({
  user: {
    id: "user.id",
    role: "user.role",
  },
  subscription: {
    userId: "subscription.user_id",
    priceId: "subscription.price_id",
    status: "subscription.status",
    currentPeriodEnd: "subscription.current_period_end",
    cancelAtPeriodEnd: "subscription.cancel_at_period_end",
    updatedAt: "subscription.updated_at",
  },
}));

// 订阅查询链多了 orderBy（确定性排序，见 user-plan.ts），用户查询链没有；
// 两者都以 limit(count) 收尾，按表返回对应的预置行。
const dbMock = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      const limit = vi.fn(async (count: number) => {
        const rows =
          table === schemaMock.user ? state.userRows : state.subscriptionRows;
        return rows.slice(0, count);
      });
      const orderBy = vi.fn(() => ({ limit }));
      return {
        where: vi.fn(() => ({ orderBy, limit })),
      };
    }),
  })),
}));

vi.mock("@repo/database", () => ({
  db: dbMock,
}));

vi.mock("@repo/database/schema", () => schemaMock);

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
}));

vi.mock("../../auth/self-use-mode", () => ({
  isSelfUseModeEnabled: vi.fn(async () => state.selfUseEnabled),
}));

// checkFileSizePrivilege 经 getPlanUploadLimits → getPlanCapabilityMatrix 读取
// 运行时设置；未配置矩阵（json 返回 undefined）且数值键回落 fallback 时，
// 套餐限额取默认矩阵值，从而无需 DB 即可断言上传特权闸门。
vi.mock("../../system-settings", () => ({
  getRuntimeSettingJson: vi.fn(async () => undefined),
  getRuntimeSettingNumber: vi.fn(async (_key: string, fallback: number) => fallback),
}));

/**
 * 在指定支付提供商下导入并执行 getUserPlan。
 *
 * getPlanFromPriceId 的 PRICE_IDS 随 PAYMENT_PROVIDER 变化，因此 priceId 映射
 * 用例须先设好环境变量再 vi.resetModules() 重新加载模块，最后恢复原值。
 */
async function getUserPlanWithProvider(
  userId: string,
  provider: "epay" | "creem"
) {
  const previousProvider = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = provider;
  try {
    vi.resetModules();
    const { getUserPlan } = await import("./user-plan");
    return await getUserPlan(userId);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.PAYMENT_PROVIDER;
    } else {
      process.env.PAYMENT_PROVIDER = previousProvider;
    }
    vi.resetModules();
  }
}

describe("getUserPlan", () => {
  beforeEach(() => {
    vi.resetModules();
    state.selfUseEnabled = true;
    state.userRows = [];
    state.subscriptionRows = [];
    dbMock.select.mockClear();
  });

  it("treats self-use super admins as Enterprise without a subscription", async () => {
    state.userRows = [{ role: "super_admin" }];

    const { getUserPlan } = await import("./user-plan");
    const plan = await getUserPlan("admin-1");

    expect(plan).toMatchObject({
      plan: "enterprise",
      planName: "Enterprise",
      hasActiveSubscription: true,
      subscriptionStatus: "self_use",
      priceId: null,
    });
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it("keeps normal users on the normal subscription path", async () => {
    state.userRows = [{ role: "user" }];
    state.subscriptionRows = [
      {
        priceId: "pro_monthly",
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 60_000),
        cancelAtPeriodEnd: false,
      },
    ];

    const plan = await getUserPlanWithProvider("user-1", "epay");

    expect(plan.plan).toBe("pro");
    expect(plan.subscriptionStatus).toBe("active");
  });

  it("does not apply the super-admin override when self-use mode is disabled", async () => {
    state.selfUseEnabled = false;
    state.userRows = [{ role: "super_admin" }];

    const { getUserPlan } = await import("./user-plan");
    const plan = await getUserPlan("admin-1");

    expect(plan).toMatchObject({
      plan: "free",
      hasActiveSubscription: false,
    });
  });

  it("does not grant enterprise to a non-super-admin even when self-use mode is on", async () => {
    state.selfUseEnabled = true;
    state.userRows = [{ role: "admin" }];

    const { getUserPlan } = await import("./user-plan");
    const plan = await getUserPlan("admin-2");

    expect(plan).toMatchObject({
      plan: "free",
      hasActiveSubscription: false,
    });
  });

  it("does not grant enterprise when the user row is missing", async () => {
    state.selfUseEnabled = true;
    state.userRows = [];

    const { getUserPlan } = await import("./user-plan");
    const plan = await getUserPlan("ghost-1");

    expect(plan).toMatchObject({
      plan: "free",
      hasActiveSubscription: false,
    });
  });

  describe("subscription status machine", () => {
    beforeEach(() => {
      state.selfUseEnabled = false;
      state.userRows = [{ role: "user" }];
    });

    it("keeps lifetime active regardless of currentPeriodEnd", async () => {
      state.subscriptionRows = [
        {
          priceId: "pro_monthly",
          status: "lifetime",
          currentPeriodEnd: new Date(Date.now() - 60_000),
          cancelAtPeriodEnd: false,
        },
      ];

      const plan = await getUserPlanWithProvider("user-1", "epay");

      expect(plan).toMatchObject({
        plan: "pro",
        hasActiveSubscription: true,
        subscriptionStatus: "lifetime",
        cancelAtPeriodEnd: false,
      });
    });

    it("downgrades an active subscription whose period has expired to free", async () => {
      state.subscriptionRows = [
        {
          priceId: "pro_monthly",
          status: "active",
          currentPeriodEnd: new Date(Date.now() - 60_000),
          cancelAtPeriodEnd: false,
        },
      ];

      const plan = await getUserPlanWithProvider("user-1", "epay");

      expect(plan).toMatchObject({
        plan: "free",
        planName: "Free",
        hasActiveSubscription: false,
        subscriptionStatus: "active",
        currentPeriodEnd: null,
        priceId: null,
      });
    });

    it("keeps a canceled subscription within its period as paid and flags cancelAtPeriodEnd", async () => {
      const periodEnd = new Date(Date.now() + 60_000);
      state.subscriptionRows = [
        {
          priceId: "pro_monthly",
          status: "canceled",
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
        },
      ];

      const plan = await getUserPlanWithProvider("user-1", "epay");

      expect(plan).toMatchObject({
        plan: "pro",
        hasActiveSubscription: true,
        subscriptionStatus: "canceled",
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
      });
    });

    it("downgrades a canceled subscription past its period to free", async () => {
      state.subscriptionRows = [
        {
          priceId: "pro_monthly",
          status: "canceled",
          currentPeriodEnd: new Date(Date.now() - 60_000),
          cancelAtPeriodEnd: false,
        },
      ];

      const plan = await getUserPlanWithProvider("user-1", "epay");

      expect(plan).toMatchObject({
        plan: "free",
        hasActiveSubscription: false,
      });
    });

    it("treats null currentPeriodEnd as never-expiring", async () => {
      state.subscriptionRows = [
        {
          priceId: "pro_monthly",
          status: "active",
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        },
      ];

      const plan = await getUserPlanWithProvider("user-1", "epay");

      expect(plan).toMatchObject({
        plan: "pro",
        hasActiveSubscription: true,
        subscriptionStatus: "active",
      });
    });

    it("returns the free plan but keeps hasActiveSubscription true for an unknown priceId", async () => {
      state.subscriptionRows = [
        {
          priceId: "totally_unknown_price",
          status: "active",
          currentPeriodEnd: new Date(Date.now() + 60_000),
          cancelAtPeriodEnd: false,
        },
      ];

      const plan = await getUserPlanWithProvider("user-1", "epay");

      expect(plan).toMatchObject({
        plan: "free",
        planName: "Free",
        hasActiveSubscription: true,
        subscriptionStatus: "active",
        priceId: "totally_unknown_price",
      });
    });
  });

  describe("paid priceId mapping", () => {
    beforeEach(() => {
      state.selfUseEnabled = false;
      state.userRows = [{ role: "user" }];
    });

    // 在 epay 提供商下，PRICE_IDS 为稳定的本地 priceId，可逐档断言映射正确，
    // 防止 getPlanFromPriceId 回归把付费用户解析成错误套餐。
    it.each([
      ["starter_monthly", "starter", "Starter"],
      ["pro_monthly", "pro", "Pro"],
      ["ultra_monthly", "ultra", "Ultra"],
      ["enterprise_monthly", "enterprise", "Enterprise"],
    ] as const)(
      "maps %s to the %s plan under the epay provider",
      async (priceId, expectedPlan, expectedName) => {
        state.subscriptionRows = [
          {
            priceId,
            status: "active",
            currentPeriodEnd: new Date(Date.now() + 60_000),
            cancelAtPeriodEnd: false,
          },
        ];

        const plan = await getUserPlanWithProvider("user-1", "epay");

        expect(plan.plan).toBe(expectedPlan);
        expect(plan.planName).toBe(expectedName);
        expect(plan.hasActiveSubscription).toBe(true);
      }
    );
  });
});

describe("checkFileSizePrivilege", () => {
  // 无订阅时落到 free 套餐，默认单文件上限 5MB。
  const FREE_MAX_BYTES = 5 * 1024 * 1024;

  beforeEach(() => {
    vi.resetModules();
    state.selfUseEnabled = false;
    state.userRows = [{ role: "user" }];
    state.subscriptionRows = [];
    dbMock.select.mockClear();
  });

  it("allows a file exactly at the plan limit", async () => {
    const { checkFileSizePrivilege } = await import("./user-plan");
    const result = await checkFileSizePrivilege("user-1", FREE_MAX_BYTES);

    expect(result).toEqual({ allowed: true });
  });

  it("rejects a file one byte over the plan limit with a formatted message and upgrade hint", async () => {
    const { checkFileSizePrivilege } = await import("./user-plan");
    const result = await checkFileSizePrivilege("user-1", FREE_MAX_BYTES + 1);

    expect(result.allowed).toBe(false);
    expect(result.errorMessage).toContain("5MB");
    expect(result.upgradeMessage).toBeTruthy();
    expect(result.upgradeMessage).toContain("Starter");
  });
});
