/**
 * Adobe IMS 鉴权（移植自 adobe2api core/refresh_mgr.py + token_mgr.py 的核心逻辑）。
 *
 * - cookie → access_token：POST adobeid-na1 的 IMS check/v6/token（form：client_id +
 *   guest_allowed + scope；headers 带 Cookie）→ 拿短期 access_token（IMS Bearer）。
 * - 账号信息：用 access_token 查 IMS profile/v1。
 * - 余额：查 firefly.adobe.io/v1/credits/balance。
 * - token 轮换：round_robin / random 的纯函数选择。
 * 这些请求同样经传输层（生产走 Go TLS 旁路；主机白名单含 .adobe.com/.adobelogin.com/.adobe.io）。
 */

import { accountIdFromToken } from "./signing";
import type { FireflyTransport } from "./transport";

export const IMS_REFRESH_URL =
  "https://adobeid-na1.services.adobe.com/ims/check/v6/token?jslVersion=v2-v0.48.0-1-g1e322cb";

export const IMS_DEFAULT_SCOPE = "AdobeID,firefly_api,openid";

const IMS_CLIENT_ID = "projectx_webapp";

export type AdobeAccountInfo = {
  displayName: string;
  email: string;
  userId: string;
};

export type RefreshResult = {
  accessToken: string;
  expiresIn: number | null;
  account: AdobeAccountInfo | null;
  raw: Record<string, unknown>;
};

/** 把多种 cookie 输入（字符串/数组/对象）归一为 "k=v; k=v" 串。移植 _cookie_string_from_input。 */
export function normalizeCookieString(input: unknown): string {
  if (typeof input === "string") {
    let text = input.trim();
    if (text.toLowerCase().startsWith("cookie:")) {
      text = text.slice(text.indexOf(":") + 1).trim();
    }
    return text;
  }
  let value: unknown = input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.cookies)) value = obj.cookies;
    else if (obj.cookie !== undefined) value = obj.cookie;
    else return "";
  }
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const pairs: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        const txt = item.trim();
        if (txt) pairs.push(txt);
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const name = String(rec.name || "").trim();
      const val = String(rec.value || "").trim();
      if (!name) continue;
      pairs.push(`${name}=${val}`);
    }
    return pairs.join("; ");
  }
  return "";
}

function refreshFormBody(scope: string): string {
  const form = new URLSearchParams();
  form.set("client_id", IMS_CLIENT_ID);
  form.set("guest_allowed", "true");
  form.set("scope", scope);
  return form.toString();
}

/** 用 cookie 换 access_token。移植 refresh_once 的 IMS 请求部分。 */
export async function refreshAccessTokenFromCookie(
  transport: FireflyTransport,
  cookieInput: unknown,
  opts?: { scope?: string; signal?: AbortSignal; fetchAccount?: boolean }
): Promise<RefreshResult> {
  const cookie = normalizeCookieString(cookieInput);
  if (!cookie) throw new Error("cookie is required");
  // Express 身份只使用上游固定 scope；保留 opts.scope 字段仅兼容已有调用方。
  const scope = IMS_DEFAULT_SCOPE;

  const resp = await transport.request({
    method: "POST",
    url: IMS_REFRESH_URL,
    headers: {
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Cookie: cookie,
      Origin: "https://new.express.adobe.com",
      Referer: "https://new.express.adobe.com/",
      "User-Agent": "Mozilla/5.0",
    },
    body: refreshFormBody(scope),
    signal: opts?.signal,
    timeoutMs: 30_000,
  });

  if (resp.status !== 200) {
    const body = (await resp.text().catch(() => "")).slice(0, 200);
    throw new Error(`refresh request failed: ${resp.status} ${body}`);
  }
  const data = (await resp.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!data) throw new Error("refresh response is not valid json");
  const accessToken = String(data.access_token || "").trim();
  if (!accessToken) throw new Error("refresh response missing access_token");

  let account: AdobeAccountInfo | null = null;
  if (opts?.fetchAccount !== false) {
    account = await fetchAccountInfo(
      transport,
      accessToken,
      opts?.signal
    ).catch(() => null);
  }

  const expiresInRaw = data.expires_in;
  const expiresIn =
    typeof expiresInRaw === "number"
      ? expiresInRaw
      : Number.isFinite(Number(expiresInRaw))
        ? Number(expiresInRaw)
        : null;

  return { accessToken, expiresIn, account, raw: data };
}

/** 用 access_token 查账号信息。移植 _fetch_account_info。 */
export async function fetchAccountInfo(
  transport: FireflyTransport,
  accessToken: string,
  signal?: AbortSignal
): Promise<AdobeAccountInfo | null> {
  const token = String(accessToken || "").trim();
  if (!token) return null;
  const urls = [
    "https://ims-na1.adobelogin.com/ims/profile/v1",
    "https://adobeid-na1.services.adobe.com/ims/profile/v1",
  ];
  for (const url of urls) {
    let data: Record<string, unknown> | null = null;
    try {
      const resp = await transport.request({
        method: "GET",
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal,
        timeoutMs: 15_000,
      });
      if (resp.status !== 200) continue;
      data = (await resp.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
    } catch {
      continue;
    }
    if (!data || typeof data !== "object") continue;
    const displayName = String(
      data.displayName || data.name || data.fullName || ""
    ).trim();
    const email = String(data.email || "").trim();
    const userId = String(data.userId || data.authId || "").trim();
    if (displayName || email || userId) {
      return { displayName, email, userId };
    }
  }
  return null;
}

export type AdobeCreditsBalance = {
  total: number | null;
  used: number | null;
  available: number | null;
  availableUntil: unknown;
};

/** 查 Firefly 余额。移植 _fetch_credits_balance。 */
export async function fetchCreditsBalance(
  transport: FireflyTransport,
  accessToken: string,
  signal?: AbortSignal
): Promise<AdobeCreditsBalance> {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("empty access token");
  const accountId = accountIdFromToken(token);
  if (!accountId) throw new Error("missing account id");

  const resp = await transport.request({
    method: "GET",
    url: "https://firefly.adobe.io/v1/credits/balance",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-key": "SunbreakWebUI1",
      "x-account-id": accountId,
      Origin: "https://new.express.adobe.com",
      Referer: "https://new.express.adobe.com/",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    signal,
    timeoutMs: 20_000,
  });
  if (resp.status !== 200) {
    throw new Error(`credits request failed: ${resp.status}`);
  }
  const payload = (await resp.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const total = (payload?.total as Record<string, unknown>) || {};
  const quota = (total.quota as Record<string, unknown>) || {};
  return {
    total: (quota.total as number) ?? null,
    used: (quota.used as number) ?? null,
    available: (quota.available as number) ?? null,
    availableUntil: total.availableUntil ?? null,
  };
}

export type AdobeTokenLike = { value: string; status?: string };

/**
 * token 轮换选择（纯函数）。移植 _pick_active_token：从 active/error 状态里按策略选一个。
 * 返回所选索引（便于调用方推进 round-robin 游标），无可用返回 -1。
 */
export function pickAdobeToken<T extends AdobeTokenLike>(
  tokens: T[],
  opts: { strategy?: "round_robin" | "random"; rrIndex?: number }
): { index: number; token: T | null } {
  const active = tokens.filter(
    (t) =>
      t.status === "active" || t.status === "error" || t.status === undefined
  );
  if (active.length === 0) return { index: -1, token: null };
  const strategy = opts.strategy === "random" ? "random" : "round_robin";
  if (strategy === "random") {
    const i = Math.floor(Math.random() * active.length);
    const chosen = active[i];
    return chosen
      ? { index: tokens.indexOf(chosen), token: chosen }
      : { index: -1, token: null };
  }
  const rr =
    (((opts.rrIndex ?? 0) % active.length) + active.length) % active.length;
  const chosen = active[rr];
  return chosen
    ? { index: tokens.indexOf(chosen), token: chosen }
    : { index: -1, token: null };
}
