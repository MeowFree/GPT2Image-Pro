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
import sharp from "sharp";

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

// ============================================
// 缩略图按需缩放（?w=<width>）
// ============================================
// 列表/网格里把全分辨率大图（平均 2.4MB、最大 14MB）当缩略图加载，会压满浏览器
// 内存与主线程解码，导致“点历史/图库后整体发卡”。这里在读取路由内用 sharp 按请求宽度
// 缩成小 webp，并按 (bucket,key,width) 进程内 LRU 缓存（与会变化的签名 sig/exp 无关），
// 首次缩放后命中即取缓存。仅缩小、不放大；缩放失败回退原图，不影响可用性。

// 仅对这些栅格图做缩放（gif 动图、svg 不处理，避免丢帧/安全问题）。
const THUMB_RESIZABLE_TYPES = new Set([".png", ".jpg", ".jpeg", ".webp"]);
// 限制宽度取值范围，约束缓存碎片与处理开销。
const THUMB_MIN_WIDTH = 16;
const THUMB_MAX_WIDTH = 1280;
// 进程内 LRU：按条数上限（每条数十~一两百 KB，整体内存有界）。
const THUMB_CACHE_MAX_ENTRIES = 1000;
const thumbCache = new Map<string, Buffer>();

function parseThumbWidth(raw: string | null): number | null {
  if (!raw) return null;
  const w = Number(raw);
  if (!Number.isInteger(w) || w < THUMB_MIN_WIDTH || w > THUMB_MAX_WIDTH) {
    return null;
  }
  return w;
}

function getCachedThumb(key: string): Buffer | undefined {
  const cached = thumbCache.get(key);
  if (cached) {
    // LRU：命中后移到末尾，最久未用的留在最前。
    thumbCache.delete(key);
    thumbCache.set(key, cached);
  }
  return cached;
}

function setCachedThumb(key: string, buf: Buffer): void {
  thumbCache.set(key, buf);
  if (thumbCache.size > THUMB_CACHE_MAX_ENTRIES) {
    const oldest = thumbCache.keys().next().value;
    if (oldest !== undefined) {
      thumbCache.delete(oldest);
    }
  }
}

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

  // 按需缩略图：仅对可缩放栅格图、且带合法 w 参数时生效。命中缓存直接返回小 webp,
  // 否则用 sharp 缩放后入缓存;缩放失败则落到下方原图返回(不影响可用性)。
  const thumbWidth = THUMB_RESIZABLE_TYPES.has(ext)
    ? parseThumbWidth(request.nextUrl.searchParams.get("w"))
    : null;
  if (thumbWidth) {
    const cacheKey = `${bucket}/${fileKey}@w${thumbWidth}`;
    let thumb = getCachedThumb(cacheKey);
    if (!thumb) {
      try {
        thumb = await sharp(data)
          .rotate()
          .resize({ width: thumbWidth, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        setCachedThumb(cacheKey, thumb);
      } catch (error) {
        logError(error, {
          source: "storage-thumb",
          bucket,
          key: fileKey,
          width: thumbWidth,
        });
        thumb = undefined;
      }
    }
    if (thumb) {
      return new NextResponse(new Uint8Array(thumb), {
        headers: {
          "Content-Type": "image/webp",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": cacheControl,
          "CDN-Cache-Control": cacheControl,
          "Cloudflare-CDN-Cache-Control": cacheControl,
          "Content-Length": String(thumb.length),
        },
      });
    }
  }

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
