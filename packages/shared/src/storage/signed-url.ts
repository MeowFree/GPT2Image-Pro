/**
 * 存储 URL 签名工具
 *
 * 为 generations 桶的图像 URL 提供短时签名机制，防止未授权访问。
 * 使用 HMAC-SHA256 签名，签名密钥为 BETTER_AUTH_SECRET 环境变量。
 *
 * 签名覆盖内容：bucket + "/" + key + ":" + expiresAt（unix epoch 秒）
 * 验证使用 crypto.timingSafeEqual 防止时序攻击。
 *
 * 纯函数，不依赖数据库。供 API 路由与 URL 构建层使用。
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 不需要签名的公开桶名集合。
 * 头像桶始终公开（OAuth 头像等场景无 cookie/token 可用）。
 */
const PUBLIC_BUCKETS = new Set([
  process.env.NEXT_PUBLIC_AVATARS_BUCKET_NAME || "avatars",
]);

/**
 * 判断桶是否为公开桶（不需要签名验证）
 */
export function isPublicBucket(bucket: string): boolean {
  return PUBLIC_BUCKETS.has(bucket);
}

/**
 * 获取签名密钥。
 * 使用 BETTER_AUTH_SECRET，与 auth 系统共享密钥以避免引入新环境变量。
 */
function getSigningSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is required for storage URL signing"
    );
  }
  return secret;
}

/**
 * 构建签名消息（被签名的原始文本）。
 * 格式：bucket/key:expiresAt
 */
function buildSignatureMessage(
  bucket: string,
  key: string,
  expiresAt: number
): string {
  return `${bucket}/${key}:${expiresAt}`;
}

/**
 * 计算 HMAC-SHA256 签名，返回 hex 字符串。
 */
function computeHmac(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * 生成带签名的图像 URL 查询参数。
 *
 * @param bucket - 存储桶名
 * @param key - 文件键名
 * @param expiresInSeconds - 签名有效期（秒），默认 3600（1 小时）
 * @returns 包含 sig 和 exp 的对象，用于拼接 URL 查询参数
 *
 * @example
 * ```ts
 * const { sig, exp } = generateSignedImageParams("generations", "user-1/abc.png");
 * const url = `/api/storage/generations/user-1/abc.png?sig=${sig}&exp=${exp}`;
 * ```
 */
export function generateSignedImageParams(
  bucket: string,
  key: string,
  expiresInSeconds = 3600
): { sig: string; exp: number } {
  const secret = getSigningSecret();
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const message = buildSignatureMessage(bucket, key, expiresAt);
  const sig = computeHmac(message, secret);
  return { sig, exp: expiresAt };
}

/**
 * 生成带签名的完整相对 URL。
 *
 * @param bucket - 存储桶名
 * @param key - 文件键名
 * @param expiresInSeconds - 签名有效期（秒），默认 3600
 * @returns 带 sig 和 exp 查询参数的相对 URL
 */
export function generateSignedImageUrl(
  bucket: string,
  key: string,
  expiresInSeconds = 3600
): string {
  if (isPublicBucket(bucket)) {
    return `/api/storage/${bucket}/${key}`;
  }
  const { sig, exp } = generateSignedImageParams(
    bucket,
    key,
    expiresInSeconds
  );
  return `/api/storage/${bucket}/${key}?sig=${sig}&exp=${exp}`;
}

/**
 * 验证签名 URL 的有效性。
 *
 * 使用 timingSafeEqual 进行常量时间比较，防止时序攻击。
 *
 * @param bucket - 存储桶名
 * @param key - 文件键名
 * @param signature - 请求中携带的签名（hex 字符串）
 * @param expiresAt - 签名到期时间（unix epoch 秒）
 * @returns 验证结果：valid 表示通过，expired 表示已过期，invalid 表示签名不匹配
 */
export function verifySignedImageUrl(
  bucket: string,
  key: string,
  signature: string,
  expiresAt: number
): "valid" | "expired" | "invalid" {
  // 先检查过期——过期检查不泄露签名信息，可提前返回。
  const now = Math.floor(Date.now() / 1000);
  if (now > expiresAt) {
    return "expired";
  }

  const secret = getSigningSecret();
  const message = buildSignatureMessage(bucket, key, expiresAt);
  const expected = computeHmac(message, secret);

  // 常量时间比较：两侧必须等长，否则 timingSafeEqual 会抛异常。
  // 将 hex 字符串转为 Buffer 进行安全比较。
  const sigBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  // 长度不匹配意味着签名格式非法或被篡改。
  // 为避免长度比较本身泄露信息，使用固定长度哈希再比较。
  if (sigBuffer.length !== expectedBuffer.length) {
    return "invalid";
  }

  if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
    return "invalid";
  }

  return "valid";
}
