import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Toaster } from "sonner";
import { siteConfig } from "@repo/shared/config";
import { Analytics } from "@/features/analytics";
// 深路径直引(不经 marketing barrel):barrel 同时 re-export Header/PricingSection,
// 它们 import framer-motion(~62KB gzip)。经 barrel 引入会把 framer 引擎拖进每个
// 非营销路由(dashboard/auth 共 21 个)的首屏。直引 cookie-consent 即可避免。
import { CookieConsent } from "@/features/marketing/components/cookie-consent";
import { Providers } from "@repo/shared/components";
import { routing } from "@/i18n/routing";

import "@repo/ui/globals.css";

/**
 * 生成静态参数
 * 为每个支持的语言生成静态页面
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * 生成 metadata(站点级 + hreflang)
 *
 * WHY 合并在此:本文件即根布局(app/ 下无独立 layout.tsx),
 * 站点级 metadata 与按 locale 的 alternates 必须在同一处产出。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const baseUrl = siteConfig.url;

  return {
    title: {
      default: siteConfig.name,
      template: `%s | ${siteConfig.name}`,
    },
    description: siteConfig.description,
    keywords: [...siteConfig.keywords],
    authors: [{ name: siteConfig.author.name, url: siteConfig.author.url }],
    creator: siteConfig.author.name,
    metadataBase: new URL(siteConfig.url),
    openGraph: {
      type: "website",
      locale: locale === "zh" ? "zh_CN" : "en_US",
      url: `${baseUrl}/${locale}`,
      title: siteConfig.name,
      description: siteConfig.description,
      siteName: siteConfig.name,
      images: [
        {
          url: siteConfig.ogImage,
          width: 1200,
          height: 630,
          alt: siteConfig.name,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: siteConfig.name,
      description: siteConfig.description,
      images: [siteConfig.ogImage],
      creator: "@gpt2image",
    },
    manifest: "/site.webmanifest",
    alternates: {
      canonical: `${baseUrl}/${locale}`,
      languages: {
        en: `${baseUrl}/en`,
        zh: `${baseUrl}/zh`,
        "x-default": `${baseUrl}/en`,
      },
    },
  };
}

/**
 * 根布局(兼 locale 布局)
 *
 * WHY html 在此渲染:lang 属性必须跟随路由 locale(此前根布局硬编码
 * lang="en",中文页面语言标签错误,影响 SEO 与读屏)。app/ 下不再有
 * layout.tsx,本文件是最顶层布局,html/body 由此输出。
 *
 * 功能:
 * - 验证语言参数有效性
 * - html lang 按 locale 输出;suppressHydrationWarning 供 next-themes 换肤
 * - body 全站衬线字体(font-serif,见 @repo/ui/globals.css 字体栈)
 * - 提供国际化上下文 (NextIntlClientProvider)
 * - 包装 Providers (主题等)
 * - 全局组件 (CookieConsent, Toaster)
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // 获取语言参数
  const { locale } = await params;

  // 验证语言是否有效
  if (!routing.locales.includes(locale as "en" | "zh")) {
    notFound();
  }

  // 获取翻译消息
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="font-serif antialiased">
        <NextIntlClientProvider messages={messages}>
          <Providers>
            {children}
            <CookieConsent />
            <Toaster richColors position="top-right" />
            <Analytics />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
