import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

/**
 * 请求级别的国际化配置
 *
 * 根据请求的语言加载对应的翻译消息
 */
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as "en" | "zh")) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
