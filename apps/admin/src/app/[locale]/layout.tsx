import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Toaster } from "sonner";
import { Providers } from "@repo/shared/components";
import { routing } from "@/i18n/routing";

/**
 * 管理后台 Locale 布局
 *
 * 功能:
 * - 验证语言参数有效性
 * - 提供国际化上下文 (NextIntlClientProvider)
 * - 包装 Providers (主题等)
 * - Toaster 通知
 *
 * 与 apps/web 的区别：无 CookieConsent、无 Analytics、无 CreateRuntimeProvider
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as "en" | "zh")) {
    notFound();
  }

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
