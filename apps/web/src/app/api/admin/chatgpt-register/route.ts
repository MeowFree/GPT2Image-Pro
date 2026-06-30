/**
 * ChatGPT 账号注册机 SSE 接口
 *
 * 职责：把管理后台发起的注册请求转发给 chatgpt-register sidecar（wine 跑 exe），
 *   把 sidecar 流式回传的日志透传给前端，sidecar 产出 access token 后由本路由
 *   负责将 token 导入生图池 web 账号（DB 凭据只在 web 侧，不进 sidecar）。
 *
 * 使用方：管理后台 "注册机" Tab（chatgpt-register-tab.tsx）
 * 关键依赖：
 *   - chatgpt-register sidecar（CHATGPT_REGISTER_URL，X-Register-Secret 鉴权）
 *   - importImageBackendWebAccountsFromAccessTokens（生图池 service，token 入库）
 *   - @repo/shared/auth（鉴权）、@repo/shared/system-settings（读 moemail/代理配置）
 *
 * 安全设计：
 *   - 仅管理员可调用（getUserRoleById + canAccessAdminArea）
 *   - 代理凭据、API Key 从服务端系统设置读取，仅下发给同内网 sidecar，不返回客户端
 *   - count/concurrency 服务端硬限
 *   - sidecar 未配置（CHATGPT_REGISTER_URL 为空）时直接报错，不在 web 进程内跑 wine
 */
import { auth } from "@repo/shared/auth";
import { canAccessAdminArea } from "@repo/shared/auth/roles";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { importImageBackendWebAccountsFromAccessTokens } from "@/features/image-backend-pool/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_COUNT = 500;
const MAX_CONCURRENCY = 50;

const requestSchema = z.object({
  count: z.coerce.number().int().min(1).max(MAX_COUNT).default(1),
  concurrency: z.coerce.number().int().min(1).max(MAX_CONCURRENCY).default(5),
  webGroupId: z.string().trim().min(1).optional().nullable(),
  namePrefix: z.string().trim().max(80).optional(),
});

// sidecar 回传给本路由的事件。
type SidecarEvent =
  | { type: "log"; line: string }
  | { type: "tokens"; tokens: string[] }
  | { type: "error"; message: string }
  | { type: "done" };

// 本路由回传给前端的事件。
type ClientEvent =
  | { type: "log"; line: string }
  | { type: "imported"; imported: number; failed: number; skipped: number }
  | { type: "error"; message: string }
  | { type: "done" };

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest) {
  // 鉴权：仅管理员可调用
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return jsonError("未登录", 401);
  }
  const role = await getUserRoleById(session.user.id);
  if (!canAccessAdminArea(role)) {
    return jsonError("无权限", 403);
  }

  // 解析请求参数
  let params: z.infer<typeof requestSchema>;
  try {
    const body = await request.json();
    params = requestSchema.parse(body);
  } catch {
    return jsonError("参数错误", 400);
  }

  // sidecar 地址与密钥（环境变量，部署时配置）。
  const sidecarUrl = process.env.CHATGPT_REGISTER_URL?.trim();
  const sidecarSecret = process.env.CHATGPT_REGISTER_SECRET?.trim() ?? "";
  if (!sidecarUrl) {
    return jsonError("注册机 sidecar 未配置（CHATGPT_REGISTER_URL）", 503);
  }

  // 从系统设置读取 moemail 配置与代理。
  const [apiKey, baseUrl, domain, proxy] = await Promise.all([
    getRuntimeSettingString("CHATGPT_REGISTER_MOEMAIL_API_KEY"),
    getRuntimeSettingString("CHATGPT_REGISTER_MOEMAIL_BASE_URL"),
    getRuntimeSettingString("CHATGPT_REGISTER_MOEMAIL_DOMAIN"),
    getRuntimeSettingString("CHATGPT_REGISTER_PROXY"),
  ]);
  if (!apiKey) {
    return jsonError("未配置 Moemail API Key", 400);
  }
  if (!domain) {
    return jsonError("未配置邮箱域名", 400);
  }

  const encoder = new TextEncoder();
  const flushPadding = `: ${" ".repeat(2048)}\n\n`;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const emit = (event: ClientEvent) => {
        write(`data: ${JSON.stringify(event)}\n\n${flushPadding}`);
      };

      try {
        // 转发给 sidecar，下发 moemail/代理凭据与数量/并发。
        const sidecarResp = await fetch(
          `${sidecarUrl.replace(/\/$/, "")}/register`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Register-Secret": sidecarSecret,
            },
            body: JSON.stringify({
              count: params.count,
              concurrency: params.concurrency,
              moemailBaseUrl: baseUrl ?? "",
              moemailApiKey: apiKey,
              moemailDomain: domain,
              proxy: proxy ?? "",
            }),
          }
        );

        if (!sidecarResp.ok || !sidecarResp.body) {
          emit({
            type: "error",
            message: `注册机 sidecar 返回 ${sidecarResp.status}`,
          });
          return;
        }

        // 逐事件读取 sidecar 的 SSE 流，透传日志、收集 token。
        const reader = sidecarResp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let tokens: string[] = [];

        const handleEvent = (event: SidecarEvent) => {
          if (event.type === "log") {
            emit({ type: "log", line: event.line });
          } else if (event.type === "tokens") {
            tokens = event.tokens;
          } else if (event.type === "error") {
            emit({ type: "error", message: event.message });
          }
          // sidecar 的 "done" 不直接转发，等导入完成后由本路由统一收尾。
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

        // 导入 token 到生图池 web 账号。
        if (tokens.length === 0) {
          emit({
            type: "log",
            line: "[注册机] 未获得任何 access token，跳过导入",
          });
          emit({ type: "imported", imported: 0, failed: 0, skipped: 0 });
          return;
        }

        emit({
          type: "log",
          line: `[注册机] 获得 ${tokens.length} 个 token，开始导入生图池...`,
        });

        const importResult =
          await importImageBackendWebAccountsFromAccessTokens({
            accessTokensText: tokens.join("\n"),
            webGroupId: params.webGroupId ?? null,
            namePrefix: params.namePrefix ?? null,
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
          (importResult.skipped?.web ?? 0) +
          (importResult.skipped?.responses ?? 0);

        emit({ type: "imported", imported, failed, skipped });
        emit({
          type: "log",
          line: `[注册机] 导入完成：成功 ${imported}，失败 ${failed}，跳过 ${skipped}`,
        });
      } catch (error) {
        emit({
          type: "error",
          message: error instanceof Error ? error.message : "未知错误",
        });
      } finally {
        emit({ type: "done" });
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // 已关闭
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
