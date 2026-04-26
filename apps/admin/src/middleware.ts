import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";

import { routing } from "@/i18n/routing";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
  type RateLimitType,
} from "@repo/shared/rate-limit";

/**
 * 创建国际化中间件
 */
const intlMiddleware = createIntlMiddleware(routing);

/**
 * API 路由限流配置（白名单模式）
 *
 * 只对敏感接口做限流，其余放行
 */
const API_RATE_LIMITS: Array<{ pattern: RegExp; type: RateLimitType }> = [
  // 认证相关 - 严格限流防暴力破解
  { pattern: /^\/api\/auth\/sign-in/, type: "auth" },
  { pattern: /^\/api\/auth\/forgot-password/, type: "auth" },
  { pattern: /^\/api\/auth\/reset-password/, type: "auth" },
];

/**
 * 获取 API 路由的限流类型
 */
function getApiRateLimitType(pathname: string): RateLimitType | null {
  for (const { pattern, type } of API_RATE_LIMITS) {
    if (pattern.test(pathname)) {
      return type;
    }
  }
  return null;
}

/**
 * Admin 站中间件
 *
 * 功能:
 * 1. API 限流
 * 2. 国际化路由处理 (next-intl)
 * 3. 认证保护
 *    - /dashboard/* 需要 session token
 *    - 未登录用户重定向到 /sign-in
 *    - 已登录用户访问 /sign-in 重定向到 /dashboard
 *
 * 注意: admin role 检查在 layout 级别完成（middleware 无法直接查 DB）
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ============================================
  // API 路由限流
  // ============================================
  if (pathname.startsWith("/api/")) {
    // 跳过 webhook
    if (pathname.startsWith("/api/webhooks/")) {
      return NextResponse.next();
    }

    // 白名单模式：只对匹配的敏感路由做限流
    const rateLimitType = getApiRateLimitType(pathname);
    if (rateLimitType) {
      const ip = getClientIp(request);
      const result = await checkRateLimit(ip, rateLimitType);

      if (!result.success) {
        return createRateLimitResponse(result);
      }

      const response = NextResponse.next();
      const headers = getRateLimitHeaders(result);
      for (const [key, value] of Object.entries(headers)) {
        response.headers.set(key, value);
      }
      return response;
    }

    // 未匹配的 API 路由直接放行
    return NextResponse.next();
  }

  // ============================================
  // 非 API 路由：国际化 + 认证保护
  // ============================================

  // 获取 Better Auth 的 session token
  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ||
    request.cookies.get("__Secure-better-auth.session_token")?.value;

  // 从路径中提取不带语言前缀的路径
  const pathnameWithoutLocale = pathname.replace(/^\/(en|zh)/, "") || "/";

  // 定义需要保护的路由（管理站的所有 /dashboard 路由）
  const protectedRoutes = ["/dashboard"];

  // 定义认证页面路由 (已登录用户不应访问)
  const authRoutes = ["/sign-in"];

  // 检查当前路径是否是受保护的路由
  const isProtectedRoute = protectedRoutes.some(
    (route) =>
      pathnameWithoutLocale === route ||
      pathnameWithoutLocale.startsWith(`${route}/`)
  );

  // 检查当前路径是否是认证页面
  const isAuthRoute = authRoutes.some(
    (route) => pathnameWithoutLocale === route
  );

  // 获取当前语言前缀
  const localeMatch = pathname.match(/^\/(en|zh)/);
  const locale = localeMatch ? localeMatch[1] : routing.defaultLocale;

  // 如果访问受保护路由但未登录，重定向到登录页
  if (isProtectedRoute && !sessionToken) {
    const signInUrl = new URL(`/${locale}/sign-in`, request.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // 如果已登录用户访问认证页面，重定向到 Dashboard
  if (isAuthRoute && sessionToken) {
    return NextResponse.redirect(
      new URL(`/${locale}/dashboard`, request.url)
    );
  }

  // 根路径重定向到 /dashboard（管理站首页就是 dashboard）
  if (pathnameWithoutLocale === "/" || pathnameWithoutLocale === "") {
    if (sessionToken) {
      return NextResponse.redirect(
        new URL(`/${locale}/dashboard`, request.url)
      );
    }
    return NextResponse.redirect(
      new URL(`/${locale}/sign-in`, request.url)
    );
  }

  // 执行国际化中间件
  return intlMiddleware(request);
}

/**
 * 中间件匹配配置
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
