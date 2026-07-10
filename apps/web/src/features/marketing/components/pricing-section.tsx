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
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  ImageIcon,
  Loader2,
  ShoppingCart,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { useCurrentSession } from "@/features/auth/hooks/use-current-session";
import {
  createCheckoutSession,
  getUserSubscription,
} from "@/features/payment/actions";
import {
  getImageBaseCreditPricing,
  getImageCreditCostBreakdown,
  IMAGE_MODERATION_PRICE_CNY,
  REFERENCE_CREDIT_PRICE_CNY,
  TEXT_MODERATION_PRICE_CNY,
  type ImageBaseCreditPricing,
} from "@/features/image-generation/resolution";
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
  imageBasePricing?: ImageBaseCreditPricing;
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
  imageBasePricing,
}: PricingSectionProps) {
  const t = useTranslations("Pricing");
  // 影片第五幕"装裱"眉标文案(仅语义包装,定价交互与内容不动)
  const tCinema = useTranslations("Cinema");
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
  const formatCreditAmount = (value: number) =>
    formatNumber(value, { maximumFractionDigits: 2 });
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
  const normalizedImageBasePricing = getImageBaseCreditPricing(imageBasePricing);
  const textModerationCredits =
    TEXT_MODERATION_PRICE_CNY / REFERENCE_CREDIT_PRICE_CNY;
  const imageModerationCredits =
    IMAGE_MODERATION_PRICE_CNY / REFERENCE_CREDIT_PRICE_CNY;
  const textTo4kCredits = getImageCreditCostBreakdown("3840x2160", {
    basePricing: normalizedImageBasePricing,
    imageModerationCount: 0,
    textModerationCount: 1,
  }).totalCredits;
  const getEstimated4kCount = (credits: number) =>
    Math.max(0, Math.floor(credits / textTo4kCredits));

  const getRoundCreditSummary = (
    key: "chatRoundCredits" | "agentRoundCredits"
  ) => {
    const entries = PLAN_IDS.map((planId) => ({
      planId,
      value: capabilityMatrix.billing[planId as SubscriptionPlan][key],
    }));
    const uniqueValues = new Set(entries.map((entry) => entry.value));
    if (uniqueValues.size === 1) {
      const firstValue = entries[0]?.value ?? 0;
      return copy(
        `${formatCreditAmount(firstValue)} credits/round for all plans`,
        `所有套餐 ${formatCreditAmount(firstValue)} 积分/轮`
      );
    }
    return entries
      .map(({ planId, value }) =>
        copy(
          `${t(`plans.${planId}.name`)} ${formatCreditAmount(value)}`,
          `${t(`plans.${planId}.name`)} ${formatCreditAmount(value)}`
        )
      )
      .join(copy(", ", "，"));
  };

  const pricingSubtitle = copy(
    `Pay with credits. Subscription credits follow the current plan period; other credits follow the batch expiry shown on the usage page. Base image pricing is loaded from admin settings: 1024×1024 = ${formatCreditAmount(
      normalizedImageBasePricing.base1024Credits
    )} credits, 4K = ${formatCreditAmount(
      normalizedImageBasePricing.base4kCredits
    )} credits, plus ${formatCreditAmount(
      textModerationCredits
    )} text review and ${formatCreditAmount(imageModerationCredits)} image review credits.`,
    `按积分付费，订阅积分按套餐周期有效，其他积分以用量页显示的批次到期时间为准。出图基础价格读取后台配置：1024×1024 = ${formatCreditAmount(
      normalizedImageBasePricing.base1024Credits
    )} 积分，4K = ${formatCreditAmount(
      normalizedImageBasePricing.base4kCredits
    )} 积分，并叠加文本审核 ${formatCreditAmount(
      textModerationCredits
    )}、图片审核 ${formatCreditAmount(imageModerationCredits)} 积分。`
  );

  const billingRuleItems = [
    copy(
      `Base image credits are loaded from admin settings: 1024×1024 = ${formatCreditAmount(
        normalizedImageBasePricing.base1024Credits
      )} credits, 3840×2160 / 2160×3840 = ${formatCreditAmount(
        normalizedImageBasePricing.base4kCredits
      )} credits. Sizes between them are linearly interpolated by output pixels; below 1024×1024 uses the 1024 price floor, and above 4K uses the 4K cap.`,
      `基础出图读取后台配置：1024×1024 = ${formatCreditAmount(
        normalizedImageBasePricing.base1024Credits
      )} 积分，3840×2160 / 2160×3840 = ${formatCreditAmount(
        normalizedImageBasePricing.base4kCredits
      )} 积分；中间尺寸按实际输出像素量线性推算，低于 1024×1024 按 1024 价格封底，高于 4K 按 4K 价格封顶。`
    ),
    copy(
      `Page Chat base round charge comes from the Plan Capability Matrix: ${getRoundCreditSummary(
        "chatRoundCredits"
      )}. If the round generates images, actual image output and review fees are added.`,
      `页面 Chat 基础轮次费读取套餐能力矩阵：${getRoundCreditSummary(
        "chatRoundCredits"
      )}；若本轮生成图片，再叠加实际图片输出和审核费用。`
    ),
    copy(
      `Page Agent base round charge comes from the Plan Capability Matrix: ${getRoundCreditSummary(
        "agentRoundCredits"
      )}. Agent stream previews are not charged as final image outputs; final completed images are billed by actual size and count.`,
      `页面 Agent 基础轮次费读取套餐能力矩阵：${getRoundCreditSummary(
        "agentRoundCredits"
      )}；Agent 流式预览不按成品图单独收费，最终成品图按实际尺寸和数量追加计费。`
    ),
    copy(
      `Text review: ${formatCreditAmount(
        textModerationCredits
      )} credits per request, calculated only from the latest input text.`,
      `文本审核：每次 ${formatCreditAmount(
        textModerationCredits
      )} 积分，只按本次最新输入文本计算。`
    ),
    copy(
      `Image review: ${formatCreditAmount(
        imageModerationCredits
      )} credits for each image in the current input; text-to-image has no image review fee.`,
      `图片审核：本次输入的每张图片 ${formatCreditAmount(
        imageModerationCredits
      )} 积分；文生图无输入图时不收图片审核费。`
    ),
    copy(
      "Final price = Chat/Agent base round credits + base image credits + text review credits + input image review credits, shown and charged with two decimals. Plain text-to-image/image-edit requests do not include Chat/Agent base round credits.",
      "最终价格 = Chat/Agent 每轮基础积分 + 基础出图积分 + 文本审核积分 + 输入图片审核积分，按两位小数展示和扣费。普通文生图/图生图没有 Chat/Agent 每轮基础积分。"
    ),
  ];

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
      canUseCapability(planId, "externalApi.agent") && "Agent",
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

  // -- 套餐轮播控制 --
  const plansScrollRef = useRef<HTMLDivElement>(null);

  /** 桌面端箭头:按一张卡宽度(含 24px 间距)平滑步进 */
  const scrollPlans = (direction: 1 | -1) => {
    const container = plansScrollRef.current;
    if (!container) return;
    const card = container.querySelector<HTMLElement>("[data-plan-card]");
    const step = (card?.offsetWidth ?? 330) + 24;
    container.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  // 首次挂载把推荐档滚到视口中央(instant,不与入场动画抢戏)。
  // 无依赖数组 + ref 门闩:isPopular 每渲染变身份,进 deps 会反复触发。
  const didCenterPopularRef = useRef(false);
  useEffect(() => {
    if (didCenterPopularRef.current) return;
    didCenterPopularRef.current = true;
    const container = plansScrollRef.current;
    if (!container) return;
    const popularId = PLAN_IDS.find((id) => isPopular(id));
    if (!popularId) return;
    const el = container.querySelector<HTMLElement>(
      `[data-plan-card="${popularId}"]`
    );
    if (!el) return;
    const left = el.offsetLeft - (container.clientWidth - el.offsetWidth) / 2;
    container.scrollTo({ left: Math.max(0, left), behavior: "instant" });
  });

  return (
    <section id="pricing" className="py-20 md:py-28">
      <div className="container mx-auto max-w-6xl">
        {/* Header:装裱眉标承接影片第五幕语义(选中作品的装裱规格) */}
        <div className="mb-12 text-center">
          <p className="mb-3 text-[11px] uppercase tracking-widest text-muted-foreground">
            {tCinema("framingLabel")}
          </p>
          <h2 className="mb-4 text-balance font-serif text-3xl font-medium tracking-tight md:text-5xl">
            {t("title")}
          </h2>
          <p className="mx-auto max-w-2xl leading-relaxed text-muted-foreground">
            {pricingSubtitle}
          </p>
        </div>
      </div>

      {/* 套餐轮播:snap 横向滑动选择(卡片加宽,替代 5 列挤压网格)。
          - 触屏直接滑,桌面另有左右箭头按 1 卡步进
          - 两侧渐隐遮罩提示可滑动;首次挂载把推荐档滚到视口中央 */}
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-background to-transparent md:w-24"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-background to-transparent md:w-24"
        />
        <button
          type="button"
          aria-label={copy("Previous plan", "上一个套餐")}
          onClick={() => scrollPlans(-1)}
          className="absolute left-4 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-menu backdrop-blur transition-[color,border-color,scale] duration-150 hover:border-foreground/40 hover:text-foreground active:scale-95 md:flex"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label={copy("Next plan", "下一个套餐")}
          onClick={() => scrollPlans(1)}
          className="absolute right-4 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-menu backdrop-blur transition-[color,border-color,scale] duration-150 hover:border-foreground/40 hover:text-foreground active:scale-95 md:flex"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        <div
          ref={plansScrollRef}
          className="scrollbar-none flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-smooth px-[max(1.5rem,calc((100vw-72rem)/2))] py-6"
        >
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
                data-plan-card={planId}
                className={cn(
                  // 轮播卡:固定宽度 + snap 对齐,悬停轻抬升。
                  // WHY translate:v4 的 -translate-y-* 产出原生 translate 属性,
                  // 过渡表写 transform 不会生效(位移瞬跳)。
                  "relative flex w-[300px] shrink-0 snap-center flex-col rounded-xl border-border transition-[border-color,box-shadow,translate] duration-250 hover:-translate-y-1.5 hover:border-foreground/30 hover:shadow-whisper sm:w-[330px] lg:w-[350px]",
                  // 推荐档:细 ring + 轻阴影,替代粗边框重阴影
                  popular &&
                    !isCurrent &&
                    "ring-1 ring-foreground/20 shadow-whisper",
                  // enterprise 卡边框本就更深,悬停保持同深度避免反向变浅
                  planId === "enterprise" &&
                    "border-foreground/60 bg-muted/20 hover:border-foreground/60",
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
                  <CardTitle className="text-lg font-medium">
                    {t(`plans.${planId}.name`)}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {getPlanDescription(planId)}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col">
                  <div className="mb-4">
                    {/* 价格数字:衬线大号 */}
                    <span className="font-serif text-4xl font-medium">
                      ¥<AnimatedPrice value={price} />
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {getPriceSuffix(planId)}
                    </span>
                  </div>

                  {/* Credits highlight */}
                  <div className="mb-5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Coins className="size-4 text-foreground" />
                      <span className="font-serif text-lg font-medium">
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
      </div>

      <div className="container mx-auto max-w-6xl">
        {creditPackages.length > 0 && (
          <div className="mt-10">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="font-serif text-xl font-medium">
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
                      "flex flex-col rounded-xl border-border transition-[border-color,box-shadow] duration-150 hover:border-foreground/30 hover:shadow-whisper",
                      pkg.popular && "ring-1 ring-foreground/20 shadow-whisper"
                    )}
                  >
                    <CardHeader className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-base font-medium">
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
                          <span className="font-serif text-3xl font-medium">
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

        <div className="mt-8 rounded-lg border border-border bg-muted/30 px-4 py-4">
          <h3 className="text-sm font-medium">{t("billingRules.title")}</h3>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
            {billingRuleItems.map((item) => (
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
