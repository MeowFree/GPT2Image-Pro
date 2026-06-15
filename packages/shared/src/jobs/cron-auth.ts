/**
 * Cron 定时任务的 Bearer Token 鉴权工具
 *
 * 职责：以恒定时间比对 Authorization header 中的 Bearer Token 与
 * 环境变量 CRON_SECRET，防止时序侧信道泄露密钥信息。
 * 使用方：apps/web/src/app/api/jobs/ 下的所有 cron 路由。
 * 关键依赖：node:crypto（SHA-256 + timingSafeEqual）。
 *
 * 设计要点：
 * - 先将 token 和 secret 分别做 SHA-256 哈希，再用 timingSafeEqual 比对，
 *   避免在长度不等时直接短路（SHA-256 输出定长 32 字节，保证 timingSafeEqual 不抛错）。
 * - CRON_SECRET 未配置时记录警告并拒绝，而非静默放行。
 */

import crypto from "node:crypto";

import { logWarn } from "@repo/shared/logger";

/**
 * 验证 Cron Job 请求的 Bearer Token 是否与 CRON_SECRET 匹配。
 *
 * @param authHeader HTTP Authorization header 原始值（含或不含 "Bearer " 前缀）
 * @returns true 当且仅当 token 与 CRON_SECRET 恒定时间比对通过
 * @remarks 纯同步计算，无副作用（仅在 CRON_SECRET 未配置时记一条 warn 日志）。
 */
export function validateCronSecret(authHeader: string | null): boolean {
  if (!authHeader) return false;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logWarn("CRON_SECRET environment variable is not set");
    return false;
  }

  // 支持 Bearer Token 格式
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  if (!token) return false;

  const tokenHash = crypto
    .createHash("sha256")
    .update(Buffer.from(token))
    .digest();
  const secretHash = crypto
    .createHash("sha256")
    .update(Buffer.from(cronSecret))
    .digest();
  // SHA-256 输出定长，此处检查仅为防御性编程，避免 timingSafeEqual 抛错
  if (tokenHash.length !== secretHash.length) return false;
  return crypto.timingSafeEqual(tokenHash, secretHash);
}
