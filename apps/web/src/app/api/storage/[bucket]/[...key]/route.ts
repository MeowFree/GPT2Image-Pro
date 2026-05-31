/**
 * 存储对象读取 API 路由
 *
 * 提供本地/S3 存储桶中图像的 HTTP 读取。
 * - avatars 桶：公开访问，无需鉴权。
 * - generations 桶：需要有效的短时签名 URL（sig + exp 查询参数）。
 *   签名验证使用 HMAC-SHA256 + 常量时间比较，防止时序攻击。
 *   v1 API 消费者通过签名 URL 参数获取授权（无 cookie）。
 */

import { logError } from "@repo/shared/logger";
import { getStorageProvider } from "@repo/shared/storage/providers";
import {
  isPublicBucket,
  verifySignedImageUrl,
} from "@repo/shared/storage/signed-url";
import { type NextRequest, NextResponse } from "next/server";
import path from "node:path";

const GENERATIONS_BUCKET =
  process.env.NEXT_PUBLIC_GENERATIONS_BUCKET_NAME || "generations";

const ALLOWED_BUCKETS = new Set([
  process.env.NEXT_PUBLIC_AVATARS_BUCKET_NAME || "avatars",
  GENERATIONS_BUCKET,
]);

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const GENERATION_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800, immutable";
const PUBLIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const NO_STORE_CACHE_CONTROL = "no-store";

/**
 * 判断存储对象是否"不存在"。
 *
 * 用于区分真正的 404（对象缺失/键非法）与底层基础设施故障（凭证缺失、
 * S3 不可达、配置缺失等），避免把所有异常一律吞成 404 掩盖真实故障。
 * - local provider：fs.readFile 缺文件抛 ENOENT。
 * - s3 provider：缺键抛 NoSuchKey / NotFound，或 HTTP 404，或 Body 为空时
 *   抛 "File not found"。
 */
function isObjectNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  // Node 文件系统错误带 code 字段（如 ENOENT）。
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT" || code === "ENOTDIR") {
    return true;
  }
  // AWS SDK 错误以 name 标识，缺键场景为 NoSuchKey / NotFound。
  if (error.name === "NoSuchKey" || error.name === "NotFound") {
    return true;
  }
  // AWS SDK 错误携带 HTTP 元数据，404 同样视为对象不存在。
  const statusCode = (
    error as { $metadata?: { httpStatusCode?: unknown } }
  ).$metadata?.httpStatusCode;
  if (statusCode === 404) {
    return true;
  }
  // s3 provider 在 Body 为空时抛出的显式 "File not found" 文案。
  return error.message.startsWith("File not found");
}

/**
 * 验证 generations 桶的签名 URL。
 * 公开桶跳过验证；非公开桶需要有效的 sig + exp 查询参数。
 *
 * @returns null 表示验证通过，否则返回错误 Response
 */
function verifyBucketAccess(
  request: NextRequest,
  bucket: string,
  fileKey: string
): NextResponse | null {
  // 公开桶无需签名
  if (isPublicBucket(bucket)) {
    return null;
  }

  const sig = request.nextUrl.searchParams.get("sig");
  const expParam = request.nextUrl.searchParams.get("exp");

  if (!sig || !expParam) {
    return NextResponse.json(
      { error: "Missing signature" },
      {
        status: 403,
        headers: { "Cache-Control": NO_STORE_CACHE_CONTROL },
      }
    );
  }

  const exp = Number(expParam);
  if (!Number.isFinite(exp) || exp <= 0) {
    return NextResponse.json(
      { error: "Invalid expiry" },
      {
        status: 403,
        headers: { "Cache-Control": NO_STORE_CACHE_CONTROL },
      }
    );
  }

  const result = verifySignedImageUrl(bucket, fileKey, sig, exp);

  if (result === "expired") {
    return NextResponse.json(
      { error: "Signature expired" },
      {
        status: 403,
        headers: { "Cache-Control": NO_STORE_CACHE_CONTROL },
      }
    );
  }

  if (result === "invalid") {
    return NextResponse.json(
      { error: "Invalid signature" },
      {
        status: 403,
        headers: { "Cache-Control": NO_STORE_CACHE_CONTROL },
      }
    );
  }

  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bucket: string; key: string[] }> }
) {
  const { bucket, key } = await params;
  const fileKey = key.join("/");

  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "Bucket not allowed" }, { status: 403 });
  }

  if (
    !fileKey ||
    fileKey.includes("..") ||
    fileKey.startsWith("/") ||
    fileKey.includes("\\")
  ) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // 签名验证：generations 桶需要有效签名，avatars 桶公开访问。
  const accessError = verifyBucketAccess(request, bucket, fileKey);
  if (accessError) {
    return accessError;
  }

  const ext = path.extname(fileKey).toLowerCase();
  const mappedContentType = CONTENT_TYPES[ext];
  const contentType = mappedContentType || "application/octet-stream";

  let data: Buffer;
  try {
    const storage = await getStorageProvider();
    data = await storage.getObject(fileKey, bucket);
  } catch (error) {
    if (isObjectNotFoundError(error)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    // 凭证/网络/配置等基础设施故障不可静默吞成 404：记日志并返回 502。
    logError(error, { source: "storage-read", bucket, key: fileKey });
    return NextResponse.json(
      { error: "Storage backend error" },
      { status: 502 }
    );
  }

  const cacheControl =
    bucket === GENERATIONS_BUCKET
      ? GENERATION_CACHE_CONTROL
      : PUBLIC_ASSET_CACHE_CONTROL;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    // 阻止浏览器对响应体做内容嗅探，避免把用户上传内容当作可执行类型解析。
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": cacheControl,
    "CDN-Cache-Control": cacheControl,
    "Cloudflare-CDN-Cache-Control": cacheControl,
    "Content-Length": String(data.length),
  };
  // 非图片白名单扩展强制以附件下载，避免在同源下被当作 HTML/SVG 渲染（存储型 XSS）。
  if (!mappedContentType) {
    headers["Content-Disposition"] = "attachment";
  }

  return new NextResponse(new Uint8Array(data), { headers });
}
