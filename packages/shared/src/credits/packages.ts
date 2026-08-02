import {
  getRuntimeSettingJson,
  getRuntimeSettingNumber,
} from "../system-settings";
import { getPlanMonthlyCredits } from "../subscription/services/plan-capabilities";
import {
  PLAN_RANK,
  SUBSCRIPTION_PLANS,
  isPlanAtLeast,
  isSubscriptionPlan,
  type SubscriptionPlan,
} from "../config/subscription-plan";
import {
  CREDIT_PACKAGES,
  ENTERPRISE_RESOURCE_PACKAGE_DEFAULT_CREDITS,
  ENTERPRISE_RESOURCE_PACKAGE_DEFAULT_PRICE,
  ENTERPRISE_RESOURCE_PACKAGE_ID,
  PAY_AS_YOU_GO_PACKAGE_ID,
  isCreditPackageVisible,
  type CreditPackage,
  type CreditPackagePlanMap,
} from "./config";

export const CREDIT_PACKAGE_MATRIX_SETTING_KEY = "CREDIT_PACKAGE_MATRIX";

export type RuntimeCreditPackage = Omit<CreditPackage, "credits" | "price"> & {
  credits: number;
  price: number;
  pricesByPlan?: CreditPackagePlanMap<number>;
  creemProductIdsByPlan?: CreditPackagePlanMap<string>;
};

const STARTER_DEFAULT_PRICE = 20;
const MAX_CREDIT_PACKAGE_CREDITS = 100_000_000;
const MAX_CREDIT_PACKAGE_PRICE = 1_000_000;
const MAX_CREDIT_PACKAGE_QUANTITY = 999;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parsePositiveNumber(value: unknown, fallback: number, max?: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(max ?? Number.MAX_SAFE_INTEGER, numeric);
}

function parsePositiveInteger(value: unknown, fallback: number, max?: number) {
  return Math.floor(parsePositiveNumber(value, fallback, max));
}

function parsePlanNumberMap(
  value: unknown,
  fallback?: CreditPackagePlanMap<number>
) {
  const result: CreditPackagePlanMap<number> = { ...(fallback ?? {}) };
  if (!isRecord(value)) return Object.keys(result).length ? result : undefined;

  for (const plan of SUBSCRIPTION_PLANS) {
    if (value[plan] === undefined) continue;
    const numeric = Number(value[plan]);
    if (Number.isFinite(numeric) && numeric > 0) {
      result[plan] = Math.min(MAX_CREDIT_PACKAGE_PRICE, numeric);
    }
  }

  return Object.keys(result).length ? result : undefined;
}

function parsePlanStringMap(
  value: unknown,
  fallback?: CreditPackagePlanMap<string>
) {
  const result: CreditPackagePlanMap<string> = { ...(fallback ?? {}) };
  if (!isRecord(value)) return Object.keys(result).length ? result : undefined;

  for (const plan of SUBSCRIPTION_PLANS) {
    const raw = value[plan];
    if (typeof raw === "string" && raw.trim()) {
      result[plan] = raw.trim();
    }
  }

  return Object.keys(result).length ? result : undefined;
}

function normalizeCreditPackage(
  raw: unknown,
  fallback?: RuntimeCreditPackage
): RuntimeCreditPackage | null {
  if (!isRecord(raw)) return fallback ?? null;
  const id =
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim()
      : fallback?.id;
  if (!id) return null;

  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : fallback?.name || id;
  const description =
    typeof raw.description === "string"
      ? raw.description
      : fallback?.description || "";
  const nameZh =
    typeof raw.nameZh === "string" && raw.nameZh.trim()
      ? raw.nameZh.trim()
      : fallback?.nameZh;
  const descriptionZh =
    typeof raw.descriptionZh === "string" && raw.descriptionZh.trim()
      ? raw.descriptionZh.trim()
      : fallback?.descriptionZh;
  const requiresPlan = isSubscriptionPlan(raw.requiresPlan)
    ? raw.requiresPlan
    : fallback?.requiresPlan;
  const maxQuantity = parsePositiveInteger(
    raw.maxQuantity,
    fallback?.maxQuantity ?? 1,
    MAX_CREDIT_PACKAGE_QUANTITY
  );

  const normalized: RuntimeCreditPackage = {
    ...(fallback ?? {}),
    id,
    name,
    description,
    credits: parsePositiveInteger(
      raw.credits,
      fallback?.credits ?? 1,
      MAX_CREDIT_PACKAGE_CREDITS
    ),
    price: parsePositiveNumber(
      raw.price,
      fallback?.price ?? 1,
      MAX_CREDIT_PACKAGE_PRICE
    ),
    maxQuantity,
  };
  const popular =
    typeof raw.popular === "boolean" ? raw.popular : fallback?.popular;
  const visible =
    typeof raw.visible === "boolean" ? raw.visible : fallback?.visible;
  const allowQuantity =
    typeof raw.allowQuantity === "boolean"
      ? raw.allowQuantity
      : fallback?.allowQuantity;
  const creemProductId =
    typeof raw.creemProductId === "string" && raw.creemProductId.trim()
      ? raw.creemProductId.trim()
      : fallback?.creemProductId;
  const pricesByPlan = parsePlanNumberMap(
    raw.pricesByPlan,
    fallback?.pricesByPlan
  );
  const creemProductIdsByPlan = parsePlanStringMap(
    raw.creemProductIdsByPlan,
    fallback?.creemProductIdsByPlan
  );

  if (popular !== undefined) normalized.popular = popular;
  if (nameZh !== undefined) normalized.nameZh = nameZh;
  if (descriptionZh !== undefined) normalized.descriptionZh = descriptionZh;
  if (visible !== undefined) normalized.visible = visible;
  if (requiresPlan !== undefined) normalized.requiresPlan = requiresPlan;
  if (allowQuantity !== undefined) normalized.allowQuantity = allowQuantity;
  if (pricesByPlan !== undefined) normalized.pricesByPlan = pricesByPlan;
  if (creemProductId !== undefined) normalized.creemProductId = creemProductId;
  if (creemProductIdsByPlan !== undefined) {
    normalized.creemProductIdsByPlan = creemProductIdsByPlan;
  }

  return normalized;
}

function packageRank(pkg: RuntimeCreditPackage) {
  if (pkg.id === PAY_AS_YOU_GO_PACKAGE_ID) return 0;
  if (pkg.id === ENTERPRISE_RESOURCE_PACKAGE_ID) return 1;
  return 2;
}

function sortCreditPackages(packages: RuntimeCreditPackage[]) {
  return [...packages].sort((a, b) => {
    const rankDelta = packageRank(a) - packageRank(b);
    if (rankDelta !== 0) return rankDelta;
    return a.id.localeCompare(b.id);
  });
}

export async function getRuntimeCreditPackages(options?: {
  includeHidden?: boolean;
  plan?: SubscriptionPlan;
}) {
  const [starterCredits, starterPrice] = await Promise.all([
    getPlanMonthlyCredits("starter"),
    getRuntimeSettingNumber(
      "PLAN_STARTER_MONTHLY_AMOUNT",
      STARTER_DEFAULT_PRICE,
      { positive: true }
    ),
  ]);
  const [enterpriseCredits, enterprisePrice] = await Promise.all([
    getRuntimeSettingNumber(
      "ENTERPRISE_RESOURCE_PACK_CREDITS",
      ENTERPRISE_RESOURCE_PACKAGE_DEFAULT_CREDITS,
      { positive: true }
    ),
    getRuntimeSettingNumber(
      "ENTERPRISE_RESOURCE_PACK_PRICE",
      ENTERPRISE_RESOURCE_PACKAGE_DEFAULT_PRICE,
      { positive: true }
    ),
  ]);

  const fallbackPackages = CREDIT_PACKAGES.map((pkg) => {
    if (pkg.id === PAY_AS_YOU_GO_PACKAGE_ID) {
      return {
        ...pkg,
        credits: starterCredits,
        price: starterPrice,
        pricesByPlan: {
          free: starterPrice,
          starter: starterPrice,
          pro: starterPrice,
          ultra: starterPrice,
          enterprise: starterPrice,
        },
      };
    }

    if (pkg.id === ENTERPRISE_RESOURCE_PACKAGE_ID) {
      return {
        ...pkg,
        credits: enterpriseCredits,
        price: enterprisePrice,
        pricesByPlan: {
          enterprise: enterprisePrice,
        },
      };
    }

    return pkg;
  }) as RuntimeCreditPackage[];
  const fallbackById = new Map(fallbackPackages.map((pkg) => [pkg.id, pkg]));

  const configured = await getRuntimeSettingJson(
    CREDIT_PACKAGE_MATRIX_SETTING_KEY
  );
  const packagesValue = isRecord(configured) ? configured.packages : configured;
  let packages = fallbackPackages;
  if (Array.isArray(packagesValue)) {
    const configuredPackages = packagesValue
      .map((raw) => {
        const id = isRecord(raw) && typeof raw.id === "string" ? raw.id : "";
        return normalizeCreditPackage(raw, fallbackById.get(id));
      })
      .filter((pkg): pkg is RuntimeCreditPackage => Boolean(pkg));
    if (configuredPackages.length > 0) {
      packages = sortCreditPackages(configuredPackages);
    }
  }

  if (options?.plan) {
    packages = packages.filter(
      (pkg) =>
        !pkg.requiresPlan || isPlanAtLeast(options.plan!, pkg.requiresPlan)
    );
  }

  if (options?.includeHidden) {
    return packages;
  }

  return packages.filter((pkg) => isCreditPackageVisible(pkg));
}

export async function getRuntimeCreditPackageById(
  packageId: string,
  options?: { includeHidden?: boolean; plan?: SubscriptionPlan }
) {
  const packages = await getRuntimeCreditPackages(options);
  return packages.find((pkg) => pkg.id === packageId);
}

export function getCreditPackagePriceForPlan(
  pkg: RuntimeCreditPackage,
  plan: SubscriptionPlan
) {
  for (let i = PLAN_RANK[plan]; i >= 0; i -= 1) {
    const candidate = SUBSCRIPTION_PLANS.find((item) => PLAN_RANK[item] === i);
    if (candidate && pkg.pricesByPlan?.[candidate]) {
      return pkg.pricesByPlan[candidate]!;
    }
  }
  return pkg.price;
}

export function getCreditPackageCreemProductIdForPlan(
  pkg: RuntimeCreditPackage,
  plan: SubscriptionPlan
) {
  for (let i = PLAN_RANK[plan]; i >= 0; i -= 1) {
    const candidate = SUBSCRIPTION_PLANS.find((item) => PLAN_RANK[item] === i);
    if (candidate && pkg.creemProductIdsByPlan?.[candidate]) {
      return pkg.creemProductIdsByPlan[candidate]!;
    }
  }
  return pkg.creemProductId || `credits_${pkg.id}`;
}
