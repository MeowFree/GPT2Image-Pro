"use client";

import {
  getPlanPrice,
  paymentConfig,
} from "@repo/shared/config/payment";
import {
  PLAN_RANK,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import type { PaymentConfig } from "@repo/shared/payment/types";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { cn } from "@repo/ui/utils";
import { Check, Coins, ImageIcon, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import {
  createCheckoutSession,
  getUserSubscription,
} from "@/features/payment/actions";
import { useCurrentSession } from "@/features/auth/hooks/use-current-session";
import { PlanInterval } from "@/features/payment/types";
import { useRouter } from "@/i18n/routing";

import { AnimatedPrice } from "./animated-price";

/**
 * 计划配置（用于获取价格等非翻译数据）
 */
const PLAN_IDS = ["free", "starter", "pro", "ultra"] as const;
function parsePlanNumber(value: string) {
  return Number.parseInt(value.replace(/,/g, ""), 10);
}

/**
 * 计划功能 keys（按顺序显示，credits 单独突出显示）
 */
const PLAN_FEATURE_KEYS: Record<string, string[]> = {
  free: [
    "creditsValidity",
    "input",
    "characters",
    "fileSize",
    "export",
    "history",
  ],
  starter: [
    "creditsValidity",
    "input",
    "characters",
    "fileSize",
    "chat",
    "externalApi",
    "customApi",
    "export",
    "history",
    "support",
  ],
  pro: [
    "creditsValidity",
    "input",
    "characters",
    "fileSize",
    "promptOptimization",
    "queue",
    "export",
    "history",
    "externalApi",
    "customApi",
    "support",
  ],
  ultra: [
    "creditsValidity",
    "input",
    "characters",
    "fileSize",
    "chatGpt55",
    "promptOptimization",
    "queue",
    "export",
    "history",
    "externalApi",
    "customApi",
    "support",
  ],
};

/**
 * 价格计划组件属性
 */
interface PricingSectionProps {
  /** 用户当前订阅的价格 ID */
  currentPriceId?: string | null;
  payment?: PaymentConfig & { yearlyEnabled?: boolean };
}

/**
 * 价格计划展示组件
 */
export function PricingSection({ currentPriceId, payment }: PricingSectionProps) {
  const t = useTranslations("Pricing");
  const [isPending, startTransition] = useTransition();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const router = useRouter();
  const { data: session } = useCurrentSession();

  // 获取用户当前订阅状态
  const [activePriceId, setActivePriceId] = useState<string | null>(
    currentPriceId ?? null
  );

  useEffect(() => {
    if (!session?.user || currentPriceId) return;
    getUserSubscription().then((result) => {
      if (
        result?.data?.subscription?.isActive &&
        result.data.subscription.priceId
      ) {
        setActivePriceId(result.data.subscription.priceId);
      }
    });
  }, [session?.user, currentPriceId]);

  /**
   * 获取计划配置
   */
  const getPlanConfig = (planId: string) => {
    const config = payment ?? paymentConfig;
    return config.plans[planId as keyof typeof config.plans];
  };

  /**
   * 获取计划的当前价格
   */
  const getCurrentPrice = (planId: string) => {
    const config = getPlanConfig(planId);
    if (!config || !("prices" in config) || !config.prices) return null;
    return getPlanPrice(
      { ...config, name: "", description: "", features: [], cta: "" },
      PlanInterval.MONTH
    );
  };

  /**
   * 获取显示价格
   */
  const getDisplayPrice = (planId: string): number => {
    if (planId === "free") return 0;
    const price = getCurrentPrice(planId);
    return price?.amount ?? 0;
  };

  /**
   * 获取价格后缀
   */
  const getPriceSuffix = (planId: string): string => {
    if (planId === "free") return "";
    return "/month";
  };

  /**
   * 检查是否为当前订阅
   */
  const isCurrentPlan = (planId: string) => {
    if (!activePriceId) return false;
    const config = getPlanConfig(planId);
    if (!config || !("prices" in config) || !config.prices) return false;
    return config.prices.some((p) => p.priceId === activePriceId);
  };

  const getPlanIdByPriceId = (priceId: string | null) => {
    if (!priceId) return null;
    for (const planId of PLAN_IDS) {
      const config = getPlanConfig(planId);
      if (!config || !("prices" in config) || !config.prices) continue;
      if (config.prices.some((price) => price.priceId === priceId)) {
        return planId;
      }
    }
    return null;
  };

  const getActivePriceInterval = () => {
    if (!activePriceId) return PlanInterval.MONTH;
    const activePlanId = getPlanIdByPriceId(activePriceId);
    const activeConfig = activePlanId ? getPlanConfig(activePlanId) : null;
    const price =
      activeConfig && "prices" in activeConfig
        ? activeConfig.prices?.find((item) => item.priceId === activePriceId)
        : null;
    return price?.interval ?? PlanInterval.MONTH;
  };

  const getCheckoutPrice = (planId: string) => {
    const config = getPlanConfig(planId);
    if (!config || !("prices" in config) || !config.prices) return null;
    return getPlanPrice(
      { ...config, name: "", description: "", features: [], cta: "" },
      getActivePriceInterval()
    );
  };

  const canUpgradeToPlan = (planId: string) => {
    if (!activePriceId || planId === "free") return false;
    const currentPlanId = getPlanIdByPriceId(activePriceId);
    if (!currentPlanId || !(planId in PLAN_RANK)) return false;
    return PLAN_RANK[planId as SubscriptionPlan] > PLAN_RANK[currentPlanId];
  };

  /**
   * 检查用户是否有活跃订阅（任意计划）
   */
  const hasSubscription = !!activePriceId;

  /**
   * 检查是否为热门计划
   */
  const isPopular = (planId: string) => {
    const config = getPlanConfig(planId);
    return config && "popular" in config && config.popular;
  };

  /**
   * 处理订阅按钮点击
   */
  const handleSubscribe = async (planId: string) => {
    if (planId === "free") {
      router.push(session?.user ? "/dashboard" : "/sign-up");
      return;
    }

    if (!session?.user) {
      router.push("/sign-in?redirect=/#pricing");
      return;
    }

    const price = getCheckoutPrice(planId);
    if (!price?.priceId) return;

    setLoadingPlan(planId);

    startTransition(async () => {
      try {
        const result = await createCheckoutSession({
          priceId: price.priceId,
          type: price.type,
        });
        if (result?.data?.url) {
          window.location.href = result.data.url;
        }
      } catch (error) {
        console.error("Failed to create checkout session:", error);
      } finally {
        setLoadingPlan(null);
      }
    });
  };

  /**
   * 处理管理订阅按钮点击 — 跳转到账单设置页
   */
  const handleManageSubscription = () => {
    router.push("/dashboard/settings");
  };

  return (
    <section id="pricing" className="container py-24">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-balance font-serif text-3xl font-medium tracking-tight md:text-4xl">
            {t("title")}
          </h2>
          <p className="mx-auto max-w-2xl text-muted-foreground">
            {t.rich("subtitle", {
              strong: (chunks) => (
                <strong className="font-semibold text-foreground">
                  {chunks}
                </strong>
              ),
            })}
          </p>
        </div>

        {/* Cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PLAN_IDS.map((planId) => {
            const price = getDisplayPrice(planId);
            const isCurrent = isCurrentPlan(planId);
            const canUpgrade = canUpgradeToPlan(planId);
            const isLoading = loadingPlan === planId;
            const popular = isPopular(planId);
            const featureKeys = PLAN_FEATURE_KEYS[planId] || [];

            return (
              <Card
                key={planId}
                className={cn(
                  "relative flex flex-col rounded-xl",
                  popular && "border-foreground shadow-lg shadow-foreground/10",
                  isCurrent && "ring-2 ring-foreground"
                )}
              >
                {popular && !isCurrent && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-foreground text-background">
                    {t("mostPopular")}
                  </Badge>
                )}
                {isCurrent && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-foreground text-background">
                    {t("currentPlan")}
                  </Badge>
                )}
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">
                    {t(`plans.${planId}.name`)}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {t(`plans.${planId}.description`)}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col">
                  <div className="mb-4">
                    <span className="text-4xl font-bold">
                      ¥<AnimatedPrice value={price} />
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {getPriceSuffix(planId)}
                    </span>
                  </div>

                  {/* Credits highlight */}
                  <div className="mb-5 rounded-lg border bg-muted/30 px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Coins className="size-4 text-foreground" />
                      <span className="text-lg font-bold">
                        {planId === "free" ? (
                          t(`plans.${planId}.creditsAmount`)
                        ) : (
                          <AnimatedPrice
                            value={parsePlanNumber(
                              t(`plans.${planId}.creditsAmount`)
                            )}
                            formatOptions={{
                              useGrouping: true,
                              maximumFractionDigits: 0,
                            }}
                          />
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t(`plans.${planId}.creditsLabel`)}
                      </span>
                    </div>
                    {t.has(`plans.${planId}.booksCount`) && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <ImageIcon className="size-3" />
                        <span>
                          {t("booksNote", {
                            count: String(
                              parsePlanNumber(
                                t(`plans.${planId}.booksCount`)
                              ).toLocaleString("en-US")
                            ),
                          })}
                        </span>
                      </div>
                    )}
                    {t.has(`plans.${planId}.creditsNote`) && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t(`plans.${planId}.creditsNote`)}
                      </div>
                    )}
                  </div>

                  <ul className="mb-6 flex-1 space-y-3">
                    {featureKeys.map((featureKey) => (
                      <li key={featureKey} className="flex items-center gap-2">
                        <Check className="h-4 w-4 shrink-0 text-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {t(`plans.${planId}.features.${featureKey}`)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={handleManageSubscription}
                      disabled={isPending}
                    >
                      {isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      {t("manageSubscription")}
                    </Button>
                  ) : hasSubscription && planId !== "free" && !canUpgrade ? (
                    <Button className="w-full" variant="outline" disabled>
                      {t("alreadySubscribed")}
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      variant={popular ? "default" : "outline"}
                      onClick={() => handleSubscribe(planId)}
                      disabled={isLoading || isPending}
                    >
                      {isLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      {canUpgrade ? t("upgradePlan") : t(`plans.${planId}.cta`)}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-8 rounded-lg border bg-muted/30 px-4 py-4">
          <h3 className="text-sm font-semibold">{t("billingRules.title")}</h3>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
            {(t.raw("billingRules.items") as string[]).map((item) => (
              <li key={item} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
