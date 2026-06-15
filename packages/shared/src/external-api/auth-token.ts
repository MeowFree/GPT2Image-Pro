/**
 * 外部 API 鉴权的纯工具（DB-free）。
 *
 * 从 auth.ts 抽出 Bearer 解析与定时安全比较，使其可在不 import @repo/database 的情况下单测
 * （auth.ts 顶层 import db）。auth.ts import 并复用这些函数，行为不变。
 */
import { createHash, timingSafeEqual } from "node:crypto";

export function hashApiKey(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

/**
 * 定时安全字符串比较：先比较长度（不等长直接返回 false，避免 timingSafeEqual 抛错），
 * 再以恒定时间比对内容，防止逐字节计时侧信道。
 */
export function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return (
    valueBuffer.length === expectedBuffer.length &&
    timingSafeEqual(valueBuffer, expectedBuffer)
  );
}

/**
 * 从请求头解析 Bearer token：缺失或非 Bearer 前缀返回 null；trim 后为空也返回 null。
 */
export function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}
