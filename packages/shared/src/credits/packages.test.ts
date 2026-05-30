import { describe, expect, it } from "vitest";

import type { RuntimeCreditPackage } from "./packages";

// packages.ts 经 system-settings 间接 import @repo/database，
// 后者模块加载时要求 DATABASE_URL；先注入占位再动态 import（不会真正连库）。
async function loadPackages() {
  process.env.DATABASE_URL ||=
    "postgres://test:test@127.0.0.1:5432/gpt2image_test";
  return await import("./packages");
}

function makePackage(
  overrides: Partial<RuntimeCreditPackage> = {}
): RuntimeCreditPackage {
  return {
    id: "credits_test",
    name: "Test pack",
    description: "",
    credits: 5000,
    price: 20,
    ...overrides,
  };
}

describe("getCreditPackagePriceForPlan", () => {
  it("falls back to the nearest lower configured plan price when the requested plan is missing", async () => {
    const { getCreditPackagePriceForPlan } = await loadPackages();
    const pkg = makePackage({ price: 99, pricesByPlan: { starter: 20 } });

    // pro 无专属价 → 向下回退命中 starter 的 20。
    expect(getCreditPackagePriceForPlan(pkg, "pro")).toBe(20);
    // free 在 starter 之下 → 全部缺档，回退 pkg.price。
    expect(getCreditPackagePriceForPlan(pkg, "free")).toBe(99);
  });

  it("uses the exact per-plan price when configured", async () => {
    const { getCreditPackagePriceForPlan } = await loadPackages();
    const pkg = makePackage({ pricesByPlan: { pro: 30, starter: 20 } });

    expect(getCreditPackagePriceForPlan(pkg, "pro")).toBe(30);
    expect(getCreditPackagePriceForPlan(pkg, "ultra")).toBe(30); // 回退 pro
  });
});

describe("getCreditPackageCreemProductIdForPlan", () => {
  it("routes to the per-plan creem product id, else credits_<id>", async () => {
    const { getCreditPackageCreemProductIdForPlan } = await loadPackages();
    const pkg = makePackage({
      id: "p1",
      creemProductIdsByPlan: { starter: "prod_starter" },
    });

    expect(getCreditPackageCreemProductIdForPlan(pkg, "pro")).toBe(
      "prod_starter"
    );
    expect(getCreditPackageCreemProductIdForPlan(pkg, "free")).toBe(
      "credits_p1"
    );
  });

  it("prefers an explicit creemProductId over the credits_<id> fallback", async () => {
    const { getCreditPackageCreemProductIdForPlan } = await loadPackages();
    const pkg = makePackage({ id: "p2", creemProductId: "prod_default" });

    expect(getCreditPackageCreemProductIdForPlan(pkg, "free")).toBe(
      "prod_default"
    );
  });
});
