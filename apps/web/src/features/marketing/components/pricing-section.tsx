"use client";

import { getPlanPrice, paymentConfig } from "@repo/shared/config/payment";
import {
  PLAN_RANK,
  SUBSCRIPTION_PLANS,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import type { RuntimeCreditPackage } from "@repo/shared/credits/packages";
import type { PaymentConfig } from "@repo/shared/payment/types";
import type {
  PlanCapabilityKey,
  PlanCapabilityMatrix,
} from "@repo/shared/subscription/services/plan-capabilities";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { cn } from "@repo/ui/utils";
import { Check, Coins, ImageIcon, Loader2, ShoppingCart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { useCurrentSession } from "@/features/auth/hooks/use-current-session";
import {
  createCheckoutSession,
  getUserSubscription,
} from "@/features/payment/actions";
import { PlanInterval } from "@/features/payment/types";
import { useRouter } from "@/i18n/routing";

import { AnimatedPrice } from "./animated-price";

function submitEpayForm(url: string, params: Record<string, string>) {
  const form = document.createElement("form");
  form.action = url;
  form.method = "POST";
  form.style.display = "none";

  for (const [key, value] of Object.entries(params)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

/**
 * 计划配置（用于获取价格等非翻译数据）
 */
const PLAN_IDS = ["free", "starter", "pro", "ultra", "enterprise"] as const;
type PricingPlanId = (typeof PLAN_IDS)[number];

const PLAN_ID_SET: ReadonlySet<string> = new Set(PLAN_IDS);
const TEXT_TO_4K_CREDITS = 10.04;

function isPricingPlanId(value: string): value is PricingPlanId {
  return PLAN_ID_SET.has(value);
}

/**
 * 价格计划组件属性
 */
interface PricingSectionProps {
  /** 用户当前订阅的价格 ID */
  currentPriceId?: string | null;
  payment?: PaymentConfig & { yearlyEnabled?: boolean };
  capabilityMatrix: PlanCapabilityMatrix;
  creditPackages?: RuntimeCreditPackage[];
  creditPackageExpiryDays?: number;
}

/**
 * 价格计划展示组件
 */
export function PricingSection({
  currentPriceId,
  payment,
  capabilityMatrix,
  creditPackages = [],
  creditPackageExpiryDays,
}: PricingSectionProps) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const isZh = locale.startsWith("zh");
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
  const activePlanId = getPlanIdByPriceId(activePriceId);

  /**
   * 检查是否为热门计划
   */
  const isPopular = (planId: string) => {
    const config = getPlanConfig(planId);
    return config && "popular" in config && config.popular;
  };

  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const formatNumber = (
    value: number,
    options?: Intl.NumberFormatOptions
  ) => new Intl.NumberFormat(locale, options).format(value);
  const formatCredits = (value: number) =>
    formatNumber(value, { maximumFractionDigits: 0 });
  const formatMoney = (value: number) =>
    `¥${formatNumber(value, { maximumFractionDigits: 2 })}`;
  const formatMegabytes = (value: number) =>
    `${formatNumber(value, { maximumFractionDigits: 0 })}MB`;
  const getPlanLimits = (planId: string) =>
    capabilityMatrix.limits[planId as SubscriptionPlan];
  const canUseCapability = (
    planId: string,
    capability: PlanCapabilityKey
  ) => {
    if (!isPricingPlanId(planId)) return false;
    return (
      PLAN_RANK[planId] >= PLAN_RANK[capabilityMatrix.features[capability]]
    );
  };
  const getPlanCredits = (planId: string) =>
    getPlanLimits(planId).monthlyCredits;
  const getEstimated4kCount = (credits: number) =>
    Math.max(0, Math.floor(credits / TEXT_TO_4K_CREDITS));

  const getPlanDescription = (planId: string) => {
    const credits = formatCredits(getPlanCredits(planId));
    const apiEnabled = canUseCapability(planId, "externalApi.keys.manage");
    const chatEnabled = canUseCapability(planId, "imageGeneration.chat");
    const agentEnabled = canUseCapability(planId, "imageGeneration.agent");
    const gpt55Enabled = canUseCapability(planId, "models.gpt55");

    if (planId === "free") {
      return copy(
        `Basic image generation with ${credits} one-time credits`,
        `基础创作体验，含 ${credits} 一次性积分`
      );
    }

    const highlights = [
      copy(`${credits} credits/month`, `每月 ${credits} 积分`),
    ];
    if (apiEnabled) highlights.push(copy("API access", "开放 API"));
    if (chatEnabled) highlights.push(copy("Chat creation", "对话创作"));
    if (agentEnabled) highlights.push(copy("Agent iteration", "Agent 迭代"));
    if (gpt55Enabled) highlights.push("GPT-5.5");

    return highlights.join(copy(", ", "，"));
  };

  const getGeneratedFeatureTexts = (planId: string) => {
    const limits = getPlanLimits(planId);
    const plan = planId as SubscriptionPlan;
    const items: string[] = [];

    items.push(
      planId === "free"
        ? copy(
            "One-time credits follow the issued batch expiry",
            "一次性积分按发放批次有效期计算"
          )
        : copy(
            "Subscription credits are valid for the current plan period",
            "订阅积分按当前套餐周期有效"
          )
    );

    const modes = [
      canUseCapability(planId, "imageGeneration.text") &&
        copy("text-to-image", "文生图"),
      canUseCapability(planId, "imageGeneration.edit") &&
        copy("image editing", "图生图"),
      canUseCapability(planId, "imageGeneration.chat") &&
        copy("chat-to-image", "对话生图"),
      canUseCapability(planId, "imageGeneration.waterfall") &&
        copy("waterfall", "瀑布流"),
      canUseCapability(planId, "imageGeneration.agent") && "Agent",
    ].filter(Boolean);
    if (modes.length > 0) {
      items.push(
        copy(
          `Creation modes: ${modes.join(", ")}`,
          `创作模式：${modes.join("、")}`
        )
      );
    }

    if (canUseCapability(planId, "imageGeneration.batch")) {
      items.push(
        copy(
          `Batch generation up to ${limits.maxBatchCount} images`,
          `批量生成最多 ${limits.maxBatchCount} 张图`
        )
      );
    }

    items.push(
      copy(
        `Uploads: ${formatMegabytes(limits.maxFileMb)} per image, ${formatMegabytes(
          limits.maxUploadMb
        )} total`,
        `上传：单图 ${formatMegabytes(limits.maxFileMb)}，总量 ${formatMegabytes(
          limits.maxUploadMb
        )}`
      )
    );
    items.push(
      copy(
        `References: ${limits.maxEditImages} edit images, ${limits.maxChatImages} chat images`,
        `参考图：编辑最多 ${limits.maxEditImages} 张，对话最多 ${limits.maxChatImages} 张`
      )
    );

    const priorityLabel =
      limits.queuePriority === "highest"
        ? copy("highest priority", "最高优先级")
        : limits.queuePriority === "priority"
          ? copy("priority queue", "优先队列")
          : copy("normal queue", "普通队列");
    items.push(
      copy(
        `${priorityLabel}, up to ${limits.imageGenerationConcurrency} concurrent generations`,
        `${priorityLabel}，最多 ${limits.imageGenerationConcurrency} 并发`
      )
    );

    const externalApiParts = [
      canUseCapability(planId, "externalApi.chat.completions") && "Chat",
      (canUseCapability(planId, "externalApi.images.generate") ||
        canUseCapability(planId, "externalApi.images.edit")) &&
        "Images",
      canUseCapability(planId, "externalApi.responses") && "Responses",
      canUseCapability(planId, "externalApi.streaming") &&
        copy("streaming", "流式"),
    ].filter(Boolean);
    if (
      canUseCapability(planId, "externalApi.keys.manage") ||
      externalApiParts.length > 0
    ) {
      items.push(
        copy(
          `External API: ${externalApiParts.join(", ") || "API keys"}`,
          `外接 API：${externalApiParts.join("、") || "API Key 管理"}`
        )
      );
    }

    if (canUseCapability(planId, "customApi.configure")) {
      items.push(
        copy(
          "Connect your own OpenAI-compatible API",
          "可接入自己的 OpenAI 兼容 API"
        )
      );
    }
    if (canUseCapability(planId, "backendGroups.select")) {
      items.push(copy("Selectable backend groups", "可选择后端分组"));
    }
    if (canUseCapability(planId, "promptOptimization.control")) {
      items.push(copy("Can minimize prompt changes", "可尽量减少提示词改动"));
    }
    if (canUseCapability(planId, "models.gpt55")) {
      items.push(
        copy(
          "GPT-5.5 available for supported chat backends",
          "支持后端可使用 GPT-5.5"
        )
      );
    }
    if (canUseCapability(planId, "moderation.onlyFailureSettlement")) {
      items.push(
        copy(
          "Moderation failures only charge review credits",
          "审核失败只扣审核积分"
        )
      );
    }

    const moderation = capabilityMatrix.moderation[plan];
    items.push(
      copy(
        `Moderation control up to ${moderation.maxBlockRiskLevel} risk`,
        `审核拦截最高可配置到 ${moderation.maxBlockRiskLevel}`
      )
    );

    const billing = capabilityMatrix.billing[plan];
    if (
      canUseCapability(planId, "imageGeneration.chat") ||
      canUseCapability(planId, "imageGeneration.agent")
    ) {
      items.push(
        copy(
          `Chat ${billing.chatRoundCredits} credits/round, Agent ${billing.agentRoundCredits} credits/round before image output fees`,
          `Chat ${billing.chatRoundCredits} 积分/轮，Agent ${billing.agentRoundCredits} 积分/轮，另计出图费用`
        )
      );
    }

    items.push(
      copy("Download, share, and saved gallery history", "下载、分享与画廊历史保存")
    );
    return items;
  };

  const getPackagePriceForPlan = (
    pkg: RuntimeCreditPackage,
    plan: SubscriptionPlan
  ) => {
    for (let i = PLAN_RANK[plan]; i >= 0; i -= 1) {
      const candidate = SUBSCRIPTION_PLANS.find((item) => PLAN_RANK[item] === i);
      if (candidate && pkg.pricesByPlan?.[candidate]) {
        return pkg.pricesByPlan[candidate]!;
      }
    }
    return pkg.price;
  };

  const getPackagePlanPrices = (pkg: RuntimeCreditPackage) =>
    PLAN_IDS.filter(
      (planId) =>
        !pkg.requiresPlan ||
        PLAN_RANK[planId as SubscriptionPlan] >= PLAN_RANK[pkg.requiresPlan]
    ).map((planId) => ({
      planId,
      price: getPackagePriceForPlan(pkg, planId as SubscriptionPlan),
    }));

  const getPackageExpiryText = () => {
    if (creditPackageExpiryDays === 0) {
      return copy("Credits never expire", "积分永不过期");
    }
    if (typeof creditPackageExpiryDays === "number") {
      return copy(
        `Valid for ${creditPackageExpiryDays} days`,
        `有效期 ${creditPackageExpiryDays} 天`
      );
    }
    return copy("Expiry follows the issued batch", "有效期按发放批次记录");
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
          if (result.data.method === "POST" && result.data.params) {
            submitEpayForm(result.data.url, result.data.params);
          } else {
            window.location.href = result.data.url;
          }
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

  const handleBuyCredits = () => {
    router.push(
      session?.user
        ? "/dashboard/credits/buy"
        : "/sign-in?redirect=/dashboard/credits/buy"
    );
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
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-5">
          {PLAN_IDS.map((planId) => {
            const price = getDisplayPrice(planId);
            const isCurrent = isCurrentPlan(planId);
            const canUpgrade = canUpgradeToPlan(planId);
            const isLoading = loadingPlan === planId;
            const popular = isPopular(planId);
            const planCredits = getPlanCredits(planId);
            const features = getGeneratedFeatureTexts(planId);

            return (
              <Card
                key={planId}
                className={cn(
                  "relative flex flex-col rounded-xl",
                  popular && "border-foreground shadow-lg shadow-foreground/10",
                  planId === "enterprise" &&
                    "border-foreground/60 bg-muted/20",
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
                    {getPlanDescription(planId)}
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
                          formatCredits(planCredits)
                        ) : (
                          <AnimatedPrice
                            value={planCredits}
                            formatOptions={{
                              useGrouping: true,
                              maximumFractionDigits: 0,
                            }}
                          />
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {planId === "free"
                          ? copy("credits", "积分")
                          : copy("credits / month", "积分 / 月")}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <ImageIcon className="size-3" />
                      <span>
                        {t("booksNote", {
                          count: formatCredits(
                            getEstimated4kCount(planCredits)
                          ),
                        })}
                      </span>
                    </div>
                    {planId === "free" && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {copy("one-time", "一次性")}
                      </div>
                    )}
                  </div>

                  <ul className="mb-6 flex-1 space-y-3">
                    {features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2">
                        <Check className="h-4 w-4 shrink-0 text-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {feature}
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

        {creditPackages.length > 0 && (
          <div className="mt-10">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-xl font-semibold">
                  {copy("Extra Credit Packages", "额外积分包")}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {copy(
                    "Top up without changing your subscription. Package names, credits, prices, and plan restrictions come from the admin credit package matrix.",
                    "无需更换订阅即可补充积分。积分包名称、额度、价格和套餐限制均读取后台积分包矩阵。"
                  )}
                </p>
              </div>
              <Button variant="outline" onClick={handleBuyCredits}>
                <ShoppingCart className="mr-2 h-4 w-4" />
                {copy("View packages", "查看积分包")}
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {creditPackages.map((pkg) => {
                const planPrices = getPackagePlanPrices(pkg);
                const prices = planPrices.map((item) => item.price);
                const minPrice = Math.min(...prices);
                const maxPrice = Math.max(...prices);
                const activePackagePrice =
                  activePlanId && isPricingPlanId(activePlanId)
                    ? getPackagePriceForPlan(
                        pkg,
                        activePlanId as SubscriptionPlan
                      )
                    : null;
                const displayPrice =
                  minPrice === maxPrice
                    ? formatMoney(minPrice)
                    : `${formatMoney(minPrice)} - ${formatMoney(maxPrice)}`;

                return (
                  <Card
                    key={pkg.id}
                    className={cn(
                      "flex flex-col rounded-xl",
                      pkg.popular && "border-foreground/70"
                    )}
                  >
                    <CardHeader className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-base font-semibold">
                          {pkg.name}
                        </CardTitle>
                        {pkg.popular && (
                          <Badge variant="secondary">
                            {copy("Best value", "最划算")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {pkg.description ||
                          copy("One-time credit package", "一次性积分包")}
                      </p>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-4">
                      <div>
                        <div className="flex items-end gap-2">
                          <span className="text-3xl font-bold">
                            {displayPrice}
                          </span>
                          <span className="pb-1 text-sm text-muted-foreground">
                            {copy("CNY", "元")}
                          </span>
                        </div>
                        {activePackagePrice !== null && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {copy(
                              `Your plan price: ${formatMoney(activePackagePrice)}`,
                              `当前套餐价：${formatMoney(activePackagePrice)}`
                            )}
                          </p>
                        )}
                      </div>

                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                          <span>
                            {copy(
                              `${formatCredits(pkg.credits)} credits per pack`,
                              `每份 ${formatCredits(pkg.credits)} 积分`
                            )}
                          </span>
                        </li>
                        <li className="flex gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                          <span>{getPackageExpiryText()}</span>
                        </li>
                        {pkg.allowQuantity && (
                          <li className="flex gap-2">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                            <span>
                              {copy(
                                `Quantity purchase, up to ${pkg.maxQuantity ?? 999} packs`,
                                `可按数量购买，最多 ${pkg.maxQuantity ?? 999} 份`
                              )}
                            </span>
                          </li>
                        )}
                        {pkg.requiresPlan && (
                          <li className="flex gap-2">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                            <span>
                              {copy(
                                `Available from ${t(`plans.${pkg.requiresPlan}.name`)}`,
                                `${t(`plans.${pkg.requiresPlan}.name`)}及以上可购买`
                              )}
                            </span>
                          </li>
                        )}
                      </ul>

                      <div className="flex flex-wrap gap-2">
                        {planPrices.map(({ planId, price }) => (
                          <Badge
                            key={`${pkg.id}-${planId}`}
                            variant="outline"
                            className="rounded-md"
                          >
                            {t(`plans.${planId}.name`)} {formatMoney(price)}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

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
