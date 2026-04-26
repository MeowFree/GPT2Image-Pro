import { toNextJsHandler } from "better-auth/next-js";
import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";

/**
 * Better Auth API 路由处理器 (Admin)
 *
 * 此文件处理所有 /api/auth/* 请求
 * Better Auth 自动处理:
 * - /api/auth/sign-in - 登录
 * - /api/auth/sign-out - 登出
 * - /api/auth/session - 获取会话
 * - 等等...
 */
const authHandlers = toNextJsHandler(auth);

export const GET = withApiLogging(authHandlers.GET);
export const POST = withApiLogging(authHandlers.POST);
