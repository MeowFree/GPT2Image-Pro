/**
 * Adobe Firefly 直连派发（mode=direct）：用本仓库移植的逆向逻辑
 * （@repo/shared/adobe/firefly-direct）直连 Adobe Firefly，经 Go TLS 旁路过风控，
 * 不依赖外部 adobe2api 进程。
 *
 * 职责：
 * - 账号/token 池（adobe_account / adobe_token）：cookie → IMS access_token 刷新、
 *   token 轮换选取、失效/配额错误标记。
 * - 出图：选 token → 选模型族/尺寸 → 图生图先 uploadImage → generateImage → 返回 base64。
 */

import { db } from "@repo/database";
import { adobeAccount, adobeToken } from "@repo/database/schema";
import {
  type AdobeImageFamily,
  type AdobeImageResolution,
  type AdobeRatio,
  composeAdobeImageModelId,
  mapSizeToAdobe,
} from "@repo/shared/adobe";
import {
  AdobeFireflyClient,
  AuthError,
  decodeJwtExp,
  decodeJwtPayload,
  FetchFireflyTransport,
  type FireflyTransport,
  fetchAccountInfo,
  fetchCreditsBalance,
  isTokenExpired,
  fireflyVideoSize,
  ProxyFireflyTransport,
  QuotaExhaustedError,
  refreshAccessTokenFromCookie,
  resolveFireflyImageModel,
  resolveFireflyVideoModel,
} from "@repo/shared/adobe/firefly-direct";
import { logError } from "@repo/shared/logger";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { and, asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { ApiConfig, GenerateImageResult } from "./types";

// IMS access_token 距过期多久内视为需要刷新（秒）。
const TOKEN_REFRESH_SKEW_SECONDS = 120;

/** 读取 Firefly 旁路代理配置：优先 FIREFLY_PROXY_*，回落到 chatgpt-web 旁路（同一 Go 服务）。 */
async function getFireflyProxyConfig(): Promise<{
  url: string;
  secret: string;
} | null> {
  // 复用 chatgpt-web 旁路（同一个 Go TLS 服务）；FIREFLY_PROXY_* 仅作 env 覆盖。
  const rawUrl =
    process.env.FIREFLY_PROXY_URL?.trim() ||
    (await getRuntimeSettingString("CHATGPT_WEB_PROXY_URL")) ||
    process.env.CHATGPT_WEB_PROXY_URL?.trim();
  const url = rawUrl?.replace(/\/+$/, "");
  if (!url) return null;
  const secret =
    process.env.FIREFLY_PROXY_SECRET?.trim() ||
    (await getRuntimeSettingString("CHATGPT_WEB_PROXY_SECRET")) ||
    process.env.CHATGPT_WEB_PROXY_SECRET?.trim() ||
    "";
  return { url, secret };
}

/** 构造 API/下载传输：API 走旁路（无则回落直连），产物下载走直连。 */
async function buildAdobeTransports(sessionKey: string): Promise<{
  apiTransport: FireflyTransport;
  downloadTransport: FireflyTransport;
}> {
  const proxy = await getFireflyProxyConfig();
  const downloadTransport = new FetchFireflyTransport();
  if (!proxy) {
    return { apiTransport: new FetchFireflyTransport(), downloadTransport };
  }
  return {
    apiTransport: new ProxyFireflyTransport({
      proxyUrl: proxy.url,
      secret: proxy.secret,
      sessionKey,
    }),
    downloadTransport,
  };
}

function tokenExpiresAt(value: string): Date | null {
  const exp = decodeJwtExp(value);
  return exp === null ? null : new Date(exp * 1000);
}

/** 拒绝 Guest 会话 cookie：能 refresh 但 Firefly 生图会 401。 */
function assertLoggedInAdobeCookie(
  accessToken: string,
  account: { displayName: string; email: string; userId: string } | null
): void {
  const sub = String(decodeJwtPayload(accessToken).sub || "").trim();
  if (sub.includes("@GuestID")) {
    throw new Error(
      "Cookie 对应 Firefly 访客会话（GuestID），不是已登录 Adobe 账号。请在已登录 firefly.adobe.com 的标签页用 tools/adobe-cookie-exporter 重新导出（需含 HttpOnly 会话 cookie，例如 aux_sid）。"
    );
  }
  if (!account?.userId && !account?.email && !account?.displayName) {
    throw new Error(
      "Cookie 能刷新 token，但读不到 Adobe 账号信息。请确认浏览器已登录 Adobe ID，并用 cookie 导出扩展重新导出完整 cookie。"
    );
  }
}

/**
 * 用某账号的 cookie 刷新出 access_token，并 upsert 到 adobe_token（一个账号一行
 * auto_refresh token）。同时回写账号信息/状态。
 */
async function refreshAccountToken(
  adobeId: string,
  account: { id: string; cookie: string; scope: string | null },
  transport: FireflyTransport,
  signal?: AbortSignal
): Promise<{ id: string; value: string } | null> {
  try {
    const result = await refreshAccessTokenFromCookie(
      transport,
      account.cookie,
      {
        scope: account.scope ?? undefined,
        signal,
        fetchAccount: true,
      }
    );
    const now = new Date();
    const accountUserId = result.account?.userId || "";

    await db
      .update(adobeAccount)
      .set({
        status: "active",
        lastRefreshAt: now,
        lastRefreshError: null,
        consecutiveFailures: 0,
        ...(result.account
          ? {
              displayName: result.account.displayName || null,
              email: result.account.email || null,
              accountUserId: result.account.userId || null,
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(adobeAccount.id, account.id));

    // 该账号已有的 auto_refresh token？有则更新，无则插入。
    const existing = await db
      .select({ id: adobeToken.id })
      .from(adobeToken)
      .where(
        and(
          eq(adobeToken.accountId, account.id),
          eq(adobeToken.source, "auto_refresh")
        )
      )
      .limit(1);

    const expiresAt = tokenExpiresAt(result.accessToken);
    let tokenId: string;
    if (existing[0]) {
      await db
        .update(adobeToken)
        .set({
          value: result.accessToken,
          accountUserId: accountUserId || null,
          status: "active",
          fails: 0,
          expiresAt,
          updatedAt: now,
        })
        .where(eq(adobeToken.id, existing[0].id));
      tokenId = existing[0].id;
    } else {
      tokenId = nanoid();
      await db.insert(adobeToken).values({
        id: tokenId,
        adobeId,
        accountId: account.id,
        value: result.accessToken,
        accountUserId: accountUserId || null,
        status: "active",
        source: "auto_refresh",
        expiresAt,
      });
    }
    // best-effort 拉 Firefly 余额写入 token（失败不影响刷新结果）。
    await storeTokenCredits(
      transport,
      tokenId,
      result.accessToken,
      signal
    ).catch((error) =>
      logError(error, { source: "adobe-credits-balance", adobeId })
    );
    return { id: tokenId, value: result.accessToken };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(adobeAccount)
      .set({
        status: "error",
        lastRefreshError: message.slice(0, 500),
        consecutiveFailures: sql`${adobeAccount.consecutiveFailures} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(adobeAccount.id, account.id));
    logError(error, { source: "adobe-direct-refresh", adobeId });
    return null;
  }
}

// best-effort 拉取 Firefly 余额并写入 adobe_token 的 credits 列；失败只记 creditsError,
// 不抛出（余额是运营展示用，不应影响刷新/生成主流程）。
async function storeTokenCredits(
  transport: FireflyTransport,
  tokenId: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<void> {
  const toInt = (value: number | null) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : null;
  try {
    const balance = await fetchCreditsBalance(transport, accessToken, signal);
    await db
      .update(adobeToken)
      .set({
        creditsTotal: toInt(balance.total),
        creditsUsed: toInt(balance.used),
        creditsAvailable: toInt(balance.available),
        creditsUpdatedAt: new Date(),
        creditsError: null,
        updatedAt: new Date(),
      })
      .where(eq(adobeToken.id, tokenId));
  } catch (error) {
    await db
      .update(adobeToken)
      .set({
        creditsError: (error instanceof Error
          ? error.message
          : String(error)
        ).slice(0, 300),
        creditsUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(adobeToken.id, tokenId))
      .catch(() => {});
  }
}

/**
 * 为某 adobe 后端取一个可用 access_token：
 * 1. 现有 active 且未过期的 token → 轮换选取（lastUsedAt 最旧优先）。
 * 2. 否则用某个 enabled 账号的 cookie 刷新出新 token。
 */
async function acquireToken(
  adobeId: string,
  transport: FireflyTransport,
  signal?: AbortSignal
): Promise<{ id: string; value: string } | null> {
  const candidates = await db
    .select({
      id: adobeToken.id,
      value: adobeToken.value,
      expiresAt: adobeToken.expiresAt,
    })
    .from(adobeToken)
    .where(
      and(eq(adobeToken.adobeId, adobeId), eq(adobeToken.status, "active"))
    )
    .orderBy(asc(adobeToken.lastUsedAt), asc(adobeToken.createdAt));

  for (const candidate of candidates) {
    const expired = candidate.expiresAt
      ? candidate.expiresAt.getTime() - TOKEN_REFRESH_SKEW_SECONDS * 1000 <=
        Date.now()
      : isTokenExpired(candidate.value, TOKEN_REFRESH_SKEW_SECONDS);
    if (expired) continue;
    await db
      .update(adobeToken)
      .set({ lastUsedAt: new Date() })
      .where(eq(adobeToken.id, candidate.id));
    return { id: candidate.id, value: candidate.value };
  }

  // 没有可用 token：用一个 enabled 账号刷新。
  const accounts = await db
    .select({
      id: adobeAccount.id,
      cookie: adobeAccount.cookie,
      scope: adobeAccount.scope,
    })
    .from(adobeAccount)
    .where(
      and(eq(adobeAccount.adobeId, adobeId), eq(adobeAccount.isEnabled, true))
    )
    .orderBy(asc(adobeAccount.lastRefreshAt), asc(adobeAccount.createdAt));

  for (const account of accounts) {
    const refreshed = await refreshAccountToken(
      adobeId,
      account,
      transport,
      signal
    );
    if (refreshed) {
      await db
        .update(adobeToken)
        .set({ lastUsedAt: new Date() })
        .where(eq(adobeToken.id, refreshed.id));
      return refreshed;
    }
  }
  return null;
}

async function markTokenStatus(
  tokenId: string,
  status: "error" | "exhausted" | "invalid"
): Promise<void> {
  await db
    .update(adobeToken)
    .set({
      status,
      fails: sql`${adobeToken.fails} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(adobeToken.id, tokenId));
}

const ALLOWED_FAMILIES: AdobeImageFamily[] = [
  "gpt-image",
  "nano-banana",
  "nano-banana2",
  "nano-banana-pro",
];

function pickFamily(enabled: string[] | null | undefined): AdobeImageFamily {
  if (enabled) {
    for (const candidate of enabled) {
      if (ALLOWED_FAMILIES.includes(candidate as AdobeImageFamily)) {
        return candidate as AdobeImageFamily;
      }
    }
  }
  return "gpt-image";
}

// 从请求 model（firefly-<family> 或 firefly-<family>-<res>-<ratio>）解析模型族；
// 用户在创作页/接口选的具体 Firefly 模型优先，解析不到才回退后端默认族。按最长前缀
// 匹配，避免 nano-banana 误吞 nano-banana-pro / nano-banana2。
function resolveAdobeFamilyFromModel(
  model: string | null | undefined,
  enabled: string[] | null | undefined
): AdobeImageFamily {
  const normalized = String(model || "")
    .trim()
    .toLowerCase();
  if (normalized.startsWith("firefly-")) {
    const rest = normalized.slice("firefly-".length);
    const byLength = [...ALLOWED_FAMILIES].sort((a, b) => b.length - a.length);
    for (const family of byLength) {
      if (rest === family || rest.startsWith(`${family}-`)) {
        return family;
      }
    }
  }
  return pickFamily(enabled);
}

/**
 * mode=direct 的 adobe 派发：选 token → 选模型族/尺寸 → 图生图先上传 → generateImage。
 * 出错返回 { error }，由上层管线统一处理（含池上报）。
 */
export async function runAdobeDirectImageRequest(
  config: ApiConfig,
  params: {
    prompt: string;
    model?: string | null;
    size?: string | null;
    images?: Array<{ data: Buffer; type?: string | null }>;
    signal?: AbortSignal;
  }
): Promise<GenerateImageResult> {
  const adobeId = config.backend?.id;
  if (!adobeId) return { error: "Adobe 直连后端缺少 id" };

  const sessionKey = `adobe-${adobeId}`;
  const { apiTransport, downloadTransport } =
    await buildAdobeTransports(sessionKey);

  const acquired = await acquireToken(adobeId, apiTransport, params.signal);
  if (!acquired) {
    return {
      error: "Adobe 直连无可用账号/token（请在 admin 导入 Adobe cookie 账号）",
    };
  }

  // 模型族 + 宽高比/分辨率：family 优先取请求 model（创作页/接口选的 Firefly 模型），
  // 解析不到回退后端默认族；ratio/res 由 size 映射，缺省走后端默认。
  const family = resolveAdobeFamilyFromModel(
    params.model,
    config.backend?.adobeEnabledModels
  );
  const fallbackRatio = (config.backend?.adobeDefaultRatio ||
    "1x1") as AdobeRatio;
  const fallbackResolution = (config.backend?.adobeDefaultResolution ||
    "2k") as AdobeImageResolution;
  const mapped = mapSizeToAdobe(params.size, {
    ratio: fallbackRatio,
    resolution: fallbackResolution,
  });
  const modelId = composeAdobeImageModelId({
    family,
    resolution: mapped.resolution,
    ratio: mapped.ratio,
  });
  const modelConf = resolveFireflyImageModel(modelId);
  if (!modelConf) {
    return { error: `Adobe 直连不支持的模型组合: ${modelId}` };
  }

  const client = new AdobeFireflyClient({
    transport: apiTransport,
    downloadTransport,
  });

  try {
    // 图生图：先上传输入图，拿 Adobe image id。
    let sourceImageIds: string[] | undefined;
    if (params.images && params.images.length > 0) {
      sourceImageIds = [];
      for (const image of params.images) {
        const id = await client.uploadImage(
          acquired.value,
          image.data,
          image.type || "image/png",
          params.signal
        );
        sourceImageIds.push(id);
      }
    }

    const output = await client.generateImage({
      token: acquired.value,
      prompt: params.prompt,
      aspectRatio: modelConf.aspectRatio,
      outputResolution: modelConf.outputResolution,
      upstreamModelId: modelConf.upstreamModelId,
      upstreamModelVersion: modelConf.upstreamModelVersion,
      ...(sourceImageIds ? { sourceImageIds } : {}),
      signal: params.signal,
    });

    return { imageBase64: output.bytes.toString("base64") };
  } catch (error) {
    // token 级错误：标记 token 状态（账号失效/配额耗尽），便于轮换跳过。
    if (error instanceof QuotaExhaustedError) {
      await markTokenStatus(acquired.id, "exhausted").catch(() => {});
    } else if (error instanceof AuthError) {
      await markTokenStatus(acquired.id, "invalid").catch(() => {});
    }
    logError(error, { source: "adobe-direct-generate", adobeId });
    return {
      error: error instanceof Error ? error.message : "Adobe 直连生成失败",
    };
  }
}

export type AdobeVideoResult =
  | { bytes: Buffer; contentType: string; raw: Record<string, unknown> }
  | { error: string };

/**
 * mode=direct 的 adobe 视频派发：解析视频模型 → 选 token → 图生视频先上传输入图 →
 * generateVideo（submit→轮询→下载）→ 返回视频字节。产物持久化（video_generation 落库、
 * re-host、扣费）由调用方完成。出错返回 { error }，token 级错误标记 token 状态便于轮换。
 */
export async function runAdobeDirectVideoRequest(
  config: ApiConfig,
  params: {
    prompt: string;
    model: string;
    inputImages?: Array<{ data: Buffer; type?: string | null }>;
    negativePrompt?: string | null;
    signal?: AbortSignal;
  }
): Promise<AdobeVideoResult> {
  const adobeId = config.backend?.id;
  if (!adobeId) return { error: "Adobe 直连后端缺少 id" };

  const conf = resolveFireflyVideoModel(params.model);
  if (!conf) {
    return { error: `Adobe 直连不支持的视频模型: ${params.model}` };
  }
  const size = fireflyVideoSize(conf.outputResolution, conf.aspectRatio);
  if (!size) {
    return {
      error: `视频尺寸映射失败: ${conf.outputResolution}/${conf.aspectRatio}`,
    };
  }

  const sessionKey = `adobe-${adobeId}`;
  const { apiTransport, downloadTransport } =
    await buildAdobeTransports(sessionKey);
  const acquired = await acquireToken(adobeId, apiTransport, params.signal);
  if (!acquired) {
    return {
      error: "Adobe 直连无可用账号/token（请在 admin 导入 Adobe cookie 账号）",
    };
  }

  const client = new AdobeFireflyClient({
    transport: apiTransport,
    downloadTransport,
  });

  try {
    let sourceImageIds: string[] | undefined;
    if (params.inputImages && params.inputImages.length > 0) {
      sourceImageIds = [];
      for (const image of params.inputImages) {
        const id = await client.uploadImage(
          acquired.value,
          image.data,
          image.type || "image/png",
          params.signal
        );
        sourceImageIds.push(id);
      }
    }

    const output = await client.generateVideo({
      token: acquired.value,
      prompt: params.prompt,
      upstreamModel: conf.upstreamModel,
      upstreamModelId: conf.upstreamModelId,
      upstreamModelVersion: conf.upstreamModelVersion,
      engine: conf.engine,
      duration: conf.duration,
      size,
      generateAudio: conf.generateAudio,
      ...(conf.referenceMode ? { referenceMode: conf.referenceMode } : {}),
      ...(params.negativePrompt != null
        ? { negativePrompt: params.negativePrompt }
        : {}),
      ...(sourceImageIds ? { sourceImageIds } : {}),
      signal: params.signal,
    });

    return { bytes: output.bytes, contentType: "video/mp4", raw: output.raw };
  } catch (error) {
    if (error instanceof QuotaExhaustedError) {
      await markTokenStatus(acquired.id, "exhausted").catch(() => {});
    } else if (error instanceof AuthError) {
      await markTokenStatus(acquired.id, "invalid").catch(() => {});
    }
    logError(error, { source: "adobe-direct-video", adobeId });
    return {
      error: error instanceof Error ? error.message : "Adobe 直连视频生成失败",
    };
  }
}

/**
 * 供 admin 调用：导入一个 Adobe cookie 账号并立即刷新一次（验证 cookie 有效）。
 * 返回账号信息或抛错。
 */
export async function importAdobeAccount(input: {
  adobeId: string;
  name?: string;
  cookie: string;
  scope?: string | null;
}): Promise<{ id: string; displayName: string; email: string }> {
  const id = nanoid();
  const sessionKey = `adobe-${input.adobeId}`;
  const { apiTransport } = await buildAdobeTransports(sessionKey);
  const result = await refreshAccessTokenFromCookie(
    apiTransport,
    input.cookie,
    {
      scope: input.scope ?? undefined,
      fetchAccount: true,
    }
  );
  assertLoggedInAdobeCookie(result.accessToken, result.account);
  const account = result.account;
  const now = new Date();

  await db.insert(adobeAccount).values({
    id,
    adobeId: input.adobeId,
    name: input.name?.trim() || account?.displayName || account?.email || id,
    cookie: input.cookie,
    scope: input.scope ?? null,
    isEnabled: true,
    displayName: account?.displayName || null,
    email: account?.email || null,
    accountUserId: account?.userId || null,
    status: "active",
    lastRefreshAt: now,
  });

  await db.insert(adobeToken).values({
    id: nanoid(),
    adobeId: input.adobeId,
    accountId: id,
    value: result.accessToken,
    accountUserId: account?.userId || null,
    status: "active",
    source: "auto_refresh",
    expiresAt: tokenExpiresAt(result.accessToken),
  });

  return {
    id,
    displayName: account?.displayName || "",
    email: account?.email || "",
  };
}

/** 列出某 adobe 后端的账号（admin 用）。不返回 cookie 明文。 */
export async function listAdobeAccounts(adobeId: string): Promise<
  Array<{
    id: string;
    name: string;
    displayName: string | null;
    email: string | null;
    isEnabled: boolean;
    status: string;
    lastRefreshAt: Date | null;
    lastRefreshError: string | null;
    consecutiveFailures: number;
    creditsTotal: number | null;
    creditsUsed: number | null;
    creditsAvailable: number | null;
    creditsUpdatedAt: Date | null;
    creditsError: string | null;
  }>
> {
  // 左连账号的 auto_refresh token，带出最新的 Firefly 余额（运营展示）。
  return db
    .select({
      id: adobeAccount.id,
      name: adobeAccount.name,
      displayName: adobeAccount.displayName,
      email: adobeAccount.email,
      isEnabled: adobeAccount.isEnabled,
      status: adobeAccount.status,
      lastRefreshAt: adobeAccount.lastRefreshAt,
      lastRefreshError: adobeAccount.lastRefreshError,
      consecutiveFailures: adobeAccount.consecutiveFailures,
      creditsTotal: adobeToken.creditsTotal,
      creditsUsed: adobeToken.creditsUsed,
      creditsAvailable: adobeToken.creditsAvailable,
      creditsUpdatedAt: adobeToken.creditsUpdatedAt,
      creditsError: adobeToken.creditsError,
    })
    .from(adobeAccount)
    .leftJoin(
      adobeToken,
      and(
        eq(adobeToken.accountId, adobeAccount.id),
        eq(adobeToken.source, "auto_refresh")
      )
    )
    .where(eq(adobeAccount.adobeId, adobeId))
    .orderBy(asc(adobeAccount.createdAt));
}

/** 删除一个 Adobe 账号（其 token 经 FK cascade 一并删除）。 */
export async function deleteAdobeAccount(id: string): Promise<void> {
  await db.delete(adobeAccount).where(eq(adobeAccount.id, id));
}

/** 启用/停用一个 Adobe 账号。停用即不再参与刷新/出图。 */
export async function setAdobeAccountEnabled(
  id: string,
  isEnabled: boolean
): Promise<void> {
  await db
    .update(adobeAccount)
    .set({
      isEnabled,
      ...(isEnabled
        ? { status: "active", lastRefreshError: null, consecutiveFailures: 0 }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(adobeAccount.id, id));
}

export { fetchAccountInfo };
