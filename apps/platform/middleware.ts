import createMiddleware from "next-intl/middleware";
import { routing } from "./src/i18n/routing";

// 平台站中间件：仅处理国际化路由，无鉴权
export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
