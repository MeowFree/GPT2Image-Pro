import { adminAuth } from "@repo/shared/auth/admin-auth";
import { toNextJsHandler } from "better-auth/next-js";

/**
 * 管理员认证 API 路由
 *
 * 使用独立的 adminAuth 实例处理管理员登录/登出。
 * 与用户侧认证完全隔离：独立 session 表、独立 cookie。
 */
export const { GET, POST } = toNextJsHandler(adminAuth);
