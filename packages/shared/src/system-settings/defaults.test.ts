import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PLAN_CAPABILITY_MATRIX } from "../subscription/services/plan-capabilities";
import {
  CREDIT_PACKAGE_MATRIX_SETTING_KEY,
  getRuntimeCreditPackages,
} from "../credits/packages";
import {
  clearSystemSettingsCache,
  getRuntimeSettingNumber,
  initializeMissingSystemSettingsDefaults,
} from "./index";

type StoredSetting = {
  key: string;
  value: unknown;
  isSecret?: boolean;
  updatedBy?: string | null;
  updatedAt?: Date | null;
};

const store = vi.hoisted(() => new Map<string, StoredSetting>());

const dbMock = vi.hoisted(() => {
  const selectBuilder = {
    from: vi.fn(async () =>
      [...store.values()].map((row) => ({
        key: row.key,
        value: row.value,
      }))
    ),
  };
  const insertBuilder = {
    values: vi.fn((values: StoredSetting[]) => {
      for (const value of values) {
        if (!store.has(value.key)) {
          store.set(value.key, { ...value });
        }
      }
      return insertBuilder;
    }),
    onConflictDoNothing: vi.fn(async () => undefined),
  };

  return {
    select: vi.fn(() => selectBuilder),
    insert: vi.fn(() => insertBuilder),
    selectBuilder,
    insertBuilder,
  };
});

vi.mock("@repo/database", () => ({
  db: dbMock,
}));

vi.mock("@repo/database/schema", () => ({
  systemSetting: {
    key: "key",
    value: "value",
    isSecret: "is_secret",
    updatedBy: "updated_by",
    updatedAt: "updated_at",
  },
}));

describe("system setting default initialization", () => {
  beforeEach(() => {
    store.clear();
    clearSystemSettingsCache();
    dbMock.select.mockClear();
    dbMock.insert.mockClear();
    dbMock.selectBuilder.from.mockClear();
    dbMock.insertBuilder.values.mockClear();
    dbMock.insertBuilder.onConflictDoNothing.mockClear();
  });

  it("persists missing non-secret defaults for a fresh database", async () => {
    const initializedKeys = await initializeMissingSystemSettingsDefaults({
      updatedBy: "admin-1",
    });

    expect(initializedKeys).toContain("PLAN_CAPABILITY_MATRIX");
    expect(initializedKeys).toContain(CREDIT_PACKAGE_MATRIX_SETTING_KEY);
    expect(initializedKeys).toContain("BILLING_YEARLY_ENABLED");
    expect(initializedKeys).toContain("APP_TIME_ZONE");
    expect(initializedKeys).toContain("IMAGE_BASE_CREDITS_1024");
    expect(initializedKeys).toContain("IMAGE_BASE_CREDITS_4K");
    expect(initializedKeys).not.toContain("BETTER_AUTH_SECRET");
    expect(initializedKeys).not.toContain("CREEM_API_KEY");

    expect(store.get("PLAN_CAPABILITY_MATRIX")?.value).toEqual(
      DEFAULT_PLAN_CAPABILITY_MATRIX
    );
    expect(store.get("BILLING_YEARLY_ENABLED")?.value).toBe(true);
    expect(store.get("APP_TIME_ZONE")?.value).toBe("UTC");
    expect(store.get("CREDITS_EXPIRY_DAYS")?.value).toBe(0);
    expect(store.get("IMAGE_BASE_CREDITS_1024")?.value).toBe(1.27);
    expect(store.get("IMAGE_BASE_CREDITS_4K")?.value).toBe(10);
    expect(store.get("PLAN_STARTER_MONTHLY_AMOUNT")?.value).toBe(20);
    expect(store.get("BETTER_AUTH_SECRET")).toBeUndefined();
    expect(store.get("CREEM_API_KEY")).toBeUndefined();
  });

  it("does not overwrite existing stored settings", async () => {
    store.set("PLAN_STARTER_MONTHLY_AMOUNT", {
      key: "PLAN_STARTER_MONTHLY_AMOUNT",
      value: 99,
    });
    store.set("PLAN_CAPABILITY_MATRIX", {
      key: "PLAN_CAPABILITY_MATRIX",
      value: {
        version: 1,
        features: {
          ...DEFAULT_PLAN_CAPABILITY_MATRIX.features,
          "imageGeneration.chat": "starter",
        },
        limits: DEFAULT_PLAN_CAPABILITY_MATRIX.limits,
        moderation: DEFAULT_PLAN_CAPABILITY_MATRIX.moderation,
        billing: DEFAULT_PLAN_CAPABILITY_MATRIX.billing,
      },
    });

    const initializedKeys = await initializeMissingSystemSettingsDefaults();

    expect(initializedKeys).not.toContain("PLAN_STARTER_MONTHLY_AMOUNT");
    expect(initializedKeys).not.toContain("PLAN_CAPABILITY_MATRIX");
    expect(store.get("PLAN_STARTER_MONTHLY_AMOUNT")?.value).toBe(99);
    expect(
      (
        store.get("PLAN_CAPABILITY_MATRIX")?.value as typeof DEFAULT_PLAN_CAPABILITY_MATRIX
      ).features["imageGeneration.chat"]
    ).toBe("starter");
  });

  it("stores the credit package matrix without changing runtime fallback behavior", async () => {
    await initializeMissingSystemSettingsDefaults();
    clearSystemSettingsCache();

    const packages = await getRuntimeCreditPackages({ includeHidden: true });
    const payg = packages.find((pkg) => pkg.id === "payg_starter");
    const enterprise = packages.find((pkg) => pkg.id === "enterprise_resource");

    expect(payg).toMatchObject({
      credits: 5000,
      price: 20,
      visible: true,
      pricesByPlan: {
        free: 20,
        starter: 20,
        pro: 20,
        ultra: 20,
        enterprise: 20,
      },
    });
    expect(payg?.creemProductIdsByPlan).toBeUndefined();
    expect(enterprise).toMatchObject({
      credits: 5000,
      price: 15,
      visible: false,
      requiresPlan: "enterprise",
      pricesByPlan: {
        enterprise: 15,
      },
    });
    expect(enterprise?.creemProductId).toBeUndefined();
  });

  it("allows zero for non-negative runtime number settings", async () => {
    const previousEnvValue = process.env.CREDITS_EXPIRY_DAYS;
    delete process.env.CREDITS_EXPIRY_DAYS;
    store.set("CREDITS_EXPIRY_DAYS", {
      key: "CREDITS_EXPIRY_DAYS",
      value: 0,
    });

    try {
      await expect(
        getRuntimeSettingNumber("CREDITS_EXPIRY_DAYS", 365, {
          nonNegative: true,
        })
      ).resolves.toBe(0);

      await expect(
        getRuntimeSettingNumber("CREDITS_EXPIRY_DAYS", 365, {
          positive: true,
        })
      ).resolves.toBe(365);
    } finally {
      if (previousEnvValue === undefined) {
        delete process.env.CREDITS_EXPIRY_DAYS;
      } else {
        process.env.CREDITS_EXPIRY_DAYS = previousEnvValue;
      }
    }
  });
});
