import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Toaster } from "sonner";

import { Providers } from "@/components/providers";
import { routing } from "@/i18n/routing";

/**
 * 生成静态参数
 * 为每个支持的语言生成静态页面
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * 生成 hreflang metadata
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  return {
    alternates: {
      canonical: `/${locale}`,
      languages: {
        en: "/en",
        zh: "/zh",
        "x-default": "/en",
      },
    },
  };
}

/**
 * Locale 布局 (Admin)
 *
 * 功能:
 * - 验证语言参数有效性
 * - 提供国际化上下文 (NextIntlClientProvider)
 * - 包装 Providers (主题等)
 * - 全局 Toaster
 * - 不包含 marketing header/footer 和 CookieConsent
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
    <NextIntlClientProvider messages={messages}>
      <Providers>
        {children}
        <Toaster richColors position="top-right" />
      </Providers>
    </NextIntlClientProvider>
  );
}
