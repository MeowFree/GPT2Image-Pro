/**
 * ChatGPT 注册机批次执行器（服务端复用逻辑）
 *
 * 职责：把"读 moemail/代理系统配置 → 调 chatgpt-register sidecar 注册 → 收集 access
 *   token → 导入生图池 web 账号"这一批次流程抽成可复用函数，供两处调用：
 *   - SSE 路由（apps/web/src/app/api/admin/chatgpt-register/route.ts），onLog 实时推流
 *   - 号池维持定时任务（scheduled-jobs.ts），静默批量补号
 *
 * 关键依赖：
 *   - CHATGPT_REGISTER_URL / CHATGPT_REGISTER_SECRET（sidecar 地址与鉴权）
 *   - 系统设置 CHATGPT_REGISTER_MOEMAIL_*（moemail 配置）、CHATGPT_REGISTER_PROXY
 *   - importImageBackendWebAccountsFromAccessTokens（token 入库）
 *
 * 安全：moemail/代理凭据仅服务端读取并下发给同内网 sidecar，不返回客户端。
 */
import {
  getRuntimeSettingBoolean,
  getRuntimeSettingNumber,
  getRuntimeSettingString,
} from "@repo/shared/system-settings";

import { importImageBackendWebAccountsFromAccessTokens } from "./service";

// sidecar 回传的 SSE 事件。
type SidecarEvent =
  | { type: "log"; line: string }
  | { type: "tokens"; tokens: string[] }
  | { type: "error"; message: string }
  | { type: "done" };

export type RegisterBatchResult = {
  tokens: string[];
  imported: number;
  failed: number;
  skipped: number;
};

/**
 * 调 sidecar 跑一批注册，流式回调日志，返回获得的 access token。
 *
 * @param input.count 注册数量
 * @param input.concurrency exe 并发
 * @param onLog 每条日志回调（SSE 透传用；定时任务可不传）
 * @throws 配置缺失或 sidecar 不可用时抛错
 */
export async function callRegisterSidecar(
  input: { count: number; concurrency: number },
  onLog?: (line: string) => void
): Promise<string[]> {
  const sidecarUrl = process.env.CHATGPT_REGISTER_URL?.trim();
  const sidecarSecret = process.env.CHATGPT_REGISTER_SECRET?.trim() ?? "";
  if (!sidecarUrl) {
    throw new Error("注册机 sidecar 未配置（CHATGPT_REGISTER_URL）");
  }

  const [apiKey, baseUrl, domain, proxy, refreshUrl, proxyDisabled] =
    await Promise.all([
      getRuntimeSettingString("CHATGPT_REGISTER_MOEMAIL_API_KEY"),
      getRuntimeSettingString("CHATGPT_REGISTER_MOEMAIL_BASE_URL"),
      getRuntimeSettingString("CHATGPT_REGISTER_MOEMAIL_DOMAIN"),
      getRuntimeSettingString("CHATGPT_REGISTER_PROXY"),
      getRuntimeSettingString("CHATGPT_REGISTER_REFRESH_URL"),
      getRuntimeSettingBoolean("CHATGPT_REGISTER_PROXY_DISABLED", false),
    ]);
  // 禁用代理开关：直连本机 IP。代理值保留不动（避免 secret 空值无法清空的问题），
  // 仅由开关决定是否启用；禁用时刷新也跳过（本机 IP 刷新无意义）。
  const effectiveProxy = proxyDisabled ? "" : (proxy ?? "");
  const effectiveRefreshUrl = proxyDisabled ? "" : (refreshUrl ?? "");
  // 代理 IP 刷新节流：取「每 N 秒一次」与「每 M 次尝试一次」的慢者，缺省 60s / 100 次。
  const [refreshMinIntervalSeconds, refreshMinAttempts] = await Promise.all([
    getRuntimeSettingNumber(
      "CHATGPT_REGISTER_REFRESH_MIN_INTERVAL_SECONDS",
      60,
      { positive: true }
    ),
    getRuntimeSettingNumber("CHATGPT_REGISTER_REFRESH_MIN_ATTEMPTS", 100, {
      positive: true,
    }),
  ]);
  if (!apiKey) {
    throw new Error("未配置 Moemail API Key");
  }
  if (!domain) {
    throw new Error("未配置邮箱域名");
  }

  const resp = await fetch(`${sidecarUrl.replace(/\/$/, "")}/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Register-Secret": sidecarSecret,
    },
    body: JSON.stringify({
      count: input.count,
      concurrency: input.concurrency,
      moemailBaseUrl: baseUrl ?? "",
      moemailApiKey: apiKey,
      moemailDomain: domain,
      proxy: effectiveProxy,
      refreshUrl: effectiveRefreshUrl,
      refreshMinIntervalSeconds,
      refreshMinAttempts,
    }),
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`注册机 sidecar 返回 ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let tokens: string[] = [];

  const handleEvent = (event: SidecarEvent) => {
    if (event.type === "log") {
      onLog?.(event.line);
    } else if (event.type === "tokens") {
      tokens = event.tokens;
    } else if (event.type === "error") {
      onLog?.(`[错误] ${event.message}`);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      for (const rawLine of part.split("\n")) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        try {
          handleEvent(JSON.parse(json) as SidecarEvent);
        } catch {
          // 忽略无法解析的行
        }
      }
    }
  }

  return tokens;
}

/**
 * 跑一批注册并把获得的 token 导入生图池 web 账号。
 *
 * @param input.count 注册数量
 * @param input.concurrency exe 并发
 * @param input.webGroupId 导入目标分组（null 为不指定）
 * @param input.namePrefix 账号名前缀
 * @param onLog 日志回调（可选）
 */
export async function runChatgptRegisterBatch(
  input: {
    count: number;
    concurrency: number;
    webGroupId?: string | null;
    namePrefix?: string | null;
  },
  onLog?: (line: string) => void
): Promise<RegisterBatchResult> {
  const tokens = await callRegisterSidecar(
    { count: input.count, concurrency: input.concurrency },
    onLog
  );

  if (tokens.length === 0) {
    onLog?.("[注册机] 未获得任何 access token，跳过导入");
    return { tokens: [], imported: 0, failed: 0, skipped: 0 };
  }

  onLog?.(`[注册机] 获得 ${tokens.length} 个 token，开始导入生图池...`);

  const importResult = await importImageBackendWebAccountsFromAccessTokens({
    accessTokensText: tokens.join("\n"),
    webGroupId: input.webGroupId ?? null,
    namePrefix: input.namePrefix ?? null,
    model: null,
    contentSafetyEnabled: true,
    priority: 50,
    concurrency: 5,
  });

  const imported =
    (importResult.syncedByMode?.web ?? 0) +
    (importResult.syncedByMode?.responses ?? 0);
  const failed =
    (importResult.failedByMode?.web ?? 0) +
    (importResult.failedByMode?.responses ?? 0);
  const skipped =
    (importResult.skipped?.web ?? 0) + (importResult.skipped?.responses ?? 0);

  onLog?.(
    `[注册机] 导入完成：成功 ${imported}，失败 ${failed}，跳过 ${skipped}`
  );

  return { tokens, imported, failed, skipped };
}
