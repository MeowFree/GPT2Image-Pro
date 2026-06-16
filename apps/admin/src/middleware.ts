import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// 管理后台中间件：国际化路由
// 认证保护由各页面的 server component 检查处理
export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
