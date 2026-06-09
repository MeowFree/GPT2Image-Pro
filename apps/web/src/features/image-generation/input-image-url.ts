/**
 * 输入图片 URL 产出（纯同步、无 I/O）。
 *
 * 给上游 api 后端（chat/completions、responses）构造 image_url 时，把一张输入图
 * 解析为可发送的 URL 或 data: base64。优先级：
 * 1. storageKey/storageBucket → 站内代理签名 URL（/api/storage/...，我方可控）；
 * 2. image.url 但仅当其为第一方站内 URL 时透传（避免把第三方易限流外链交给上游，
 *    上游下载外链会被图床限流返回 "failed download file 429"）；
 * 3. 否则：有字节用 base64 内联；无字节（如历史图空 Buffer）退而透传原外链
 *    (best-effort，无字节无法做得更好)。
 *
 * opts.forceBase64：一次性兜底。上游有时下载我方 URL 失败（返回
 * "Error while downloading file. Upstream status code: 407." 等），调用方据此
 * 重发同一请求并强制内联：只要有字节就直接走 base64，跳过 URL 选择；无字节则保持
 * 原逻辑（历史图空 Buffer 仍透传原外链，不做网络下载）。
 *
 * 使用方：service.ts buildChatCompletionContent、responses-image.ts getInputImageContent。
 * 关键依赖：@repo/shared/storage/signed-url 的 buildSignedStorageImageUrl /
 * parseStorageImageUrl。re-host（下载外链并转存到我方存储）由异步层
 * rehost-input-images.ts 在 api 后端分发前完成，本函数只做最终选择。
 */
import {
  buildSignedStorageImageUrl,
  parseStorageImageUrl,
} from "@repo/shared/storage/signed-url";
import type { ImageInputFile } from "./types";

/**
 * 判定上游错误是否为"下载我方 URL 失败"（如签名存储 URL / 第一方 URL 被上游拉取失败，
 * 典型返回 "Error while downloading file. Upstream status code: 407."）。命中则调用方
 * 可一次性重发同一请求并强制把输入图改为内联 base64（我方已有字节）。
 *
 * @param error 上游返回的错误文案（可空）。
 * @returns 命中下载失败语义返回 true。
 * @remarks 子串与 image-backend-pool/service.ts isUserRequestBackendError 保持一致。
 */
export function isImageDownloadUpstreamError(error?: string): boolean {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("error while downloading file") ||
    normalized.includes("unable to download content from the provided url")
  );
}

/**
 * 取站内公开基址，与下方 toAbsoluteUrl 一致；用于 parseStorageImageUrl 判定第一方。
 */
function getPublicBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "";
}

function toAbsoluteUrl(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("data:image/")) return url;
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return null;
  return new URL(url, baseUrl).toString();
}

function getSignedStorageUrl(image: ImageInputFile) {
  try {
    return buildSignedStorageImageUrl(image.storageKey, image.storageBucket);
  } catch {
    return null;
  }
}

/**
 * 构造 data: base64 内联 URL（最后兜底，需有字节）。
 */
function toBase64DataUrl(image: ImageInputFile) {
  return `data:${image.type || "image/png"};base64,${image.data.toString(
    "base64"
  )}`;
}

/**
 * 把一张输入图解析为发送给上游的 image_url（或 data: base64）。
 *
 * @param image 输入图，含可选 storageKey/url/data。
 * @param opts.forceBase64 强制内联：有字节时跳过 URL 选择直接返回 base64（上游下载
 *   我方 URL 失败时的一次性兜底）；无字节则维持原逻辑。
 * @returns 站内签名 URL（首选）/ 第一方透传 URL / base64 / 外链（无字节兜底）。
 * @remarks 纯同步、无副作用、无网络 I/O。
 */
export function getInputImageUrl(
  image: ImageInputFile,
  opts?: { forceBase64?: boolean }
) {
  // 强制内联且有字节：直接 base64，避免上游再去下载我方 URL（曾返回 407）。
  if (opts?.forceBase64 && image.data?.length) {
    return toBase64DataUrl(image);
  }

  const signedStorageUrl = getSignedStorageUrl(image);
  const absoluteSignedStorageUrl = signedStorageUrl
    ? toAbsoluteUrl(signedStorageUrl)
    : null;
  if (absoluteSignedStorageUrl) return absoluteSignedStorageUrl;

  const existingUrl = image.url?.trim();
  if (existingUrl) {
    // data: URL 原样返回（已是内联字节，无下载风险）。
    if (existingUrl.startsWith("data:")) return existingUrl;

    const publicBaseUrl = getPublicBaseUrl();
    const isFirstParty = Boolean(
      parseStorageImageUrl(existingUrl, publicBaseUrl)
    );
    if (isFirstParty) {
      const absoluteExistingUrl = toAbsoluteUrl(existingUrl);
      if (absoluteExistingUrl) return absoluteExistingUrl;
    } else if (!image.data?.length) {
      // 外链且无字节：无法 base64，best-effort 透传原外链。
      const absoluteExistingUrl = toAbsoluteUrl(existingUrl);
      if (absoluteExistingUrl) return absoluteExistingUrl;
    }
    // 外链且有字节：落到下方 base64，避免上游再去下载易限流外链。
  }

  return toBase64DataUrl(image);
}
