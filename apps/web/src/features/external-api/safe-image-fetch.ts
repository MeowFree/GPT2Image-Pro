import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * 共享的图片 URL SSRF 防护。
 *
 * 用于所有"按用户提供的 URL 拉取图片"的外部 API 处理器，统一阻断：
 * - 内网 / 回环 / 链路本地（含云元数据 169.254.169.254）/ CGNAT / ULA 等地址
 * - 携带凭证的 URL、非 http(s) 协议、*.internal / localhost 主机名
 * - 重定向到内网：使用 redirect:"manual" 并逐跳复检，关闭"公网 URL 302 跳内网"绕过
 *
 * 残留风险（已知）：DNS 重绑定（校验与连接之间重解析）需在连接层 pin IP 才能根除，
 * 当前未实现，依赖逐跳校验大幅收敛攻击面。
 */
export class SafeImageFetchError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "SafeImageFetchError";
  }
}

const MAX_REDIRECTS = 3;

function isPrivateIpAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized === "::" || normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpAddress(normalized.replace(/^::ffff:/, ""));
  }

  const parts = normalized.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }

  const [a = 0, b = 0] = parts.map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT（含阿里云 100.100.x.x 元数据）
  if (a === 169 && b === 254) return true; // 链路本地 / 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // 组播 / 保留
  return false;
}

export async function assertPublicImageUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeImageFetchError("URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new SafeImageFetchError("Image URL must not include credentials.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new SafeImageFetchError("Image URL must be publicly reachable.");
  }
  if (
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".internal")
  ) {
    throw new SafeImageFetchError("Image URL must be publicly reachable.");
  }

  const strippedHostname = hostname.replace(/^\[|\]$/g, "");
  if (isIP(strippedHostname)) {
    if (isPrivateIpAddress(strippedHostname)) {
      throw new SafeImageFetchError("Image URL must be publicly reachable.");
    }
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateIpAddress(entry.address))
  ) {
    throw new SafeImageFetchError("Image URL must be publicly reachable.");
  }
}

/**
 * 校验用户自定义 API base URL 指向公网（请求时复检，弥补"仅保存时校验"的 TOCTOU）。
 * 仅校验主机；不发起请求。无法解析或指向内网即抛出。
 */
export async function assertPublicApiBaseUrl(baseUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new SafeImageFetchError("API base URL is invalid.");
  }
  await assertPublicImageUrl(parsed);
}

/**
 * 校验并拉取一个公网图片 URL，逐跳复检重定向目标，禁止跳转到内网地址。
 * 返回最终的非重定向 Response（调用方负责检查 ok / content-type / 大小）。
 */
export async function fetchPublicImage(
  rawUrl: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<Response> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new SafeImageFetchError("Image URL is invalid.");
    }

    await assertPublicImageUrl(parsed);

    const response = await fetch(parsed, {
      redirect: "manual",
      ...(init.headers ? { headers: init.headers } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new SafeImageFetchError("Image URL redirect missing location.");
      }
      // 解析为绝对地址后，下一轮循环会对其再次执行 SSRF 校验。
      currentUrl = new URL(location, parsed).toString();
      continue;
    }

    return response;
  }

  throw new SafeImageFetchError("Too many redirects while loading image.");
}
