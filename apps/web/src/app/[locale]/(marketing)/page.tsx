import type { Metadata } from "next";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { isAdminRole } from "@repo/shared/auth/roles";
import { getServerSession } from "@repo/shared/auth/server";
import { SiteJsonLd, SoftwareAppJsonLd } from "@/components/seo/json-ld";
import { siteConfig } from "@repo/shared/config";
import { getRuntimePaymentConfig } from "@repo/shared/config/payment-runtime";
import { CREDIT_CONFIG_DEFAULTS } from "@repo/shared/credits/config";
import { getRuntimeCreditPackages } from "@repo/shared/credits/packages";
import {
  getRuntimeSettingBoolean,
  getRuntimeSettingNumber,
} from "@repo/shared/system-settings";
import { getPlanCapabilityMatrix } from "@repo/shared/subscription/services/plan-capabilities";
import {
  FAQSection,
  PricingSection,
  SlaStatusSection,
} from "@/features/marketing/components";
// CinemaFilm 为 client 组件,静态 import 即可:其内部 GL 引擎按需初始化,
// SSR 输出 StaticFilm 全量正文(SEO/无 JS 真相),营销页本就含 framer-motion
import {
  CinemaFilm,
  FinaleStage,
  InkThread,
} from "@/features/marketing/components/cinema";
import { getRuntimeImageBaseCreditPricing } from "@/features/image-generation/pricing-settings";
import { getRecentGenerationSlaStats } from "@/features/image-generation/sla";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * 生成首页 Metadata
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";

  const title = isZh
    ? "GPT2IMAGE - AI 对话生图平台"
    : "GPT2IMAGE - AI Chat-to-Image Generation Platform";

  const description = isZh
    ? "通过自然对话将你的想法转化为精美视觉图片。由最先进的 AI 模型驱动，支持批量生成、画廊管理与灵活积分系统。"
    : "Transform your ideas into stunning visuals through natural conversation. Powered by state-of-the-art AI models with batch generation, gallery management, and flexible credits.";

  return {
    title,
    description,
    keywords: [
      "AI image generation",
      "chat to image",
      "text to image",
      "AI art",
      "GPT2IMAGE",
      "image generation API",
      "creative AI",
      ...(isZh ? ["AI图像生成", "对话生图", "文字转图片", "AI艺术"] : []),
    ],
    openGraph: {
      title,
      description,
      type: "website",
      url: `${siteConfig.url}/${locale}`,
      siteName: siteConfig.name,
      images: [
        {
          url: `${siteConfig.url}${siteConfig.ogImage}`,
          width: 1200,
          height: 630,
          alt: siteConfig.name,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${siteConfig.url}${siteConfig.ogImage}`],
    },
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [
    runtimePaymentConfig,
    capabilityMatrix,
    creditPackages,
    creditPackageExpiryDays,
    imageBasePricing,
    slaEnabled,
    slaStats,
    session,
  ] = await Promise.all([
    getRuntimePaymentConfig(),
    getPlanCapabilityMatrix(),
    getRuntimeCreditPackages(),
    getRuntimeSettingNumber(
      "CREDITS_EXPIRY_DAYS",
      CREDIT_CONFIG_DEFAULTS.creditsExpiryDays,
      { nonNegative: true }
    ),
    getRuntimeImageBaseCreditPricing(),
    getRuntimeSettingBoolean("MARKETING_SLA_STATUS_ENABLED", true),
    getRecentGenerationSlaStats(1000),
    getServerSession(),
  ]);
  const role = session?.user?.id
    ? await getUserRoleById(session.user.id)
    : "user";
  const canToggleSlaStatus = isAdminRole(role);

  return (
    <>
      {/* JSON-LD Structured Data */}
      <SiteJsonLd locale={locale as "en" | "zh"} />
      <SoftwareAppJsonLd locale={locale as "en" | "zh"} />

      {/* 影片化首页:七幕影片承接原 Hero..Testimonials 区块;
          谷段常规流(SLA/Pricing/FAQ)与终幕作 children 传入 CinemaFilm,
          与影片共享同一 GL 上下文与探测结果(单画布单引擎不变式) */}
      <CinemaFilm>
        {/* 静默谷一:SLA 素面排版 + 页边墨线章节刻度 */}
        {(slaEnabled || canToggleSlaStatus) && (
          <section className="relative">
            {/* labelTop 78vh:左栏大数字占视口中带,刻度落下部空白避让 */}
            <InkThread numeral="V" step="export" side="left" labelTop="78vh" />
            <SlaStatusSection
              locale={locale}
              stats={slaStats}
              initiallyEnabled={slaEnabled}
              canToggleVisibility={canToggleSlaStatus}
            />
          </section>
        )}
        {/* 谷段二折「润格」:五档立轴挂单走成廊道,墨线续缝。
            side=left:廊道满宽,右页边标签会被轴身裁切;横移使左侧
            渐空,左页边标签悬于空白纸面(v1.0.1 走查实证) */}
        <section className="relative">
          <InkThread numeral="VI" step="framing" side="left" />
          <PricingSection
            payment={runtimePaymentConfig}
            capabilityMatrix={capabilityMatrix}
            creditPackages={creditPackages}
            creditPackageExpiryDays={creditPackageExpiryDays}
            imageBasePricing={imageBasePricing}
          />
        </section>
        {/* 谷段三折「册页」:问答折子 + 页边墨线章节刻度 */}
        <section className="relative">
          <InkThread numeral="VII" step="completion" side="left" />
          <FAQSection />
        </section>
        {/* 终幕:反向显影 bookend + CTA(承接原 CTASection 内容) */}
        <FinaleStage />
      </CinemaFilm>
    </>
  );
}
