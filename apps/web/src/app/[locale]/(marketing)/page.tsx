import type { Metadata } from "next";
import { Suspense } from "react";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { isAdminRole } from "@repo/shared/auth/roles";
import { getServerSession } from "@repo/shared/auth/server";
import { SiteJsonLd, SoftwareAppJsonLd } from "@/components/seo/json-ld";
import { siteConfig } from "@repo/shared/config";
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
import { getMarketingHomeData } from "@/features/marketing/home-data";

// 数据获取分层:非会话配置走 1h 进程内缓存,SLA 走 120s 缓存
// (均单飞去重;配置失败用陈旧值,SLA 失败隐藏 120s;设置写入立即失效);
// 会话/角色仍按请求读取(匿名访客无 cookie 不触库,查询失败按匿名处理)。
// force-dynamic 仅因会话依赖保留。
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

async function HomeRuntimeSections({ locale }: { locale: string }) {
  // 非会话配置走 1h 缓存,SLA 走 120s 缓存(均单飞,分别陈旧/隐藏兜底);
  // 会话/角色按请求读取——匿名访客无 cookie 不触库,
  // 查询失败按匿名处理(session=null, role="user"),营销页不可 500。
  const {
    runtimePaymentConfig,
    capabilityMatrix,
    creditPackages,
    creditPackageExpiryDays,
    imageBasePricing,
    imageRetentionPolicy,
    slaEnabled,
    slaStats,
  } = await getMarketingHomeData();
  let session: Awaited<ReturnType<typeof getServerSession>> = null;
  let role = "user";
  try {
    session = await getServerSession();
    if (session?.user?.id) {
      role = await getUserRoleById(session.user.id);
    }
  } catch (err) {
    console.error("[marketing-home] 会话/角色查询失败,按匿名访客处理", err);
    session = null;
    role = "user";
  }
  const canToggleSlaStatus = isAdminRole(role);

  return (
    <>
      {/* 静默谷一:SLA 素面排版 + 页边墨线章节刻度;
          slaStats 为 null(统计查询失败兜底)时隐藏整个区块 */}
      {(slaEnabled || canToggleSlaStatus) && slaStats && (
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
        {/* labelFadeAt 0.6:廊道落幕即收刻度,积分包/例言进屏前隐去 */}
        <InkThread
          numeral="VI"
          step="framing"
          side="left"
          labelFadeAt={0.6}
        />
        <PricingSection
          payment={runtimePaymentConfig}
          capabilityMatrix={capabilityMatrix}
          creditPackages={creditPackages}
          creditPackageExpiryDays={creditPackageExpiryDays}
          imageBasePricing={imageBasePricing}
          imageRetentionPolicy={imageRetentionPolicy}
        />
      </section>
      {/* 谷段三折「册页」:问答折子 + 页边墨线章节刻度 */}
      <section className="relative">
        <InkThread numeral="VII" step="completion" side="left" />
        <FAQSection imageRetentionPolicy={imageRetentionPolicy} />
      </section>
    </>
  );
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <>
      <SiteJsonLd locale={locale as "en" | "zh"} />
      <SoftwareAppJsonLd locale={locale as "en" | "zh"} />

      <CinemaFilm>
        <Suspense
          fallback={<div aria-hidden="true" className="min-h-[160vh]" />}
        >
          <HomeRuntimeSections locale={locale} />
        </Suspense>
        <FinaleStage />
      </CinemaFilm>
    </>
  );
}
