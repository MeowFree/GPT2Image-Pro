import { headers } from "next/headers";

import { adminAuth } from "./admin-auth";

/**
 * 管理员服务端会话工具函数
 *
 * 与用户侧 server.ts 功能对等，但使用独立的 adminAuth 实例。
 * 读取 admin.session_token cookie 进行认证，与用户侧 cookie 完全隔离。
 *
 * 使用方：apps/admin 的 Server Components / Server Actions / middleware。
 * 依赖：adminAuth (admin-auth.ts)、next/headers。
 */

/**
 * 获取管理员服务端会话
 *
 * 从请求 headers 中解析 admin.session_token cookie，
 * 查询 admin_session 表验证会话有效性。
 *
 * @returns 管理员会话对象 (包含 user 和 session)，未认证时返回 null
 */
export async function getAdminServerSession() {
  const session = await adminAuth.api.getSession({
    headers: await headers(),
  });
  return session;
}

/**
 * 获取当前管理员用户
 *
 * 便捷方法，直接返回管理员用户对象或 null。
 *
 * @returns 管理员用户对象，未认证时返回 null
 */
export async function getCurrentAdmin() {
  const session = await getAdminServerSession();
  return session?.user ?? null;
}

/**
 * 检查是否已认证为管理员
 *
 * @returns boolean - 当前请求是否携带有效的管理员会话
 */
export async function isAdminAuthenticated() {
  const session = await getAdminServerSession();
  return !!session?.user;
}
