/**
 * 上游 OpenAI 兼容 API 的"测活"（连通性 + 鉴权可用性）探测。
 *
 * 职责：对外部图像/聊天中转端点发起一次轻量只读探针，判断其是否可达、
 * 密钥是否被接受，返回结构化结果（状态 + HTTP 码 + 时延 + 模型数）。
 *
 * 使用方：
 * - apps/web `features/settings`：用户自配外部 API 的"测试连接"按钮。
 * - apps/web `features/image-backend-pool`：后端池 API 成员的"测活"按钮。
 *
 * 关键依赖：`../security/dns-pin` 的 `fetchWithDnsPin`——在连接层 pin DNS、
 * 阻断私网/保留地址、强制 redirect:"manual"、内置超时；据此根除 SSRF 与
 * DNS 重绑定（探测目标来自用户/管理员输入，属不可信外部 URL）。
 *
 * 探针选择 `${baseUrl}/models`：OpenAI 兼容端点的标准只读接口，不计费、
 * 无副作用，且能顺带校验 Bearer 密钥是否有效。
 */
import { fetchWithDnsPin, SsrfBlockedError } from "../security/dns-pin";

/**
 * 探测结果状态：
 * - `ok`：HTTP 2xx，端点可达且密钥被接受。
 * - `auth_failed`：HTTP 401/403，端点可达但密钥被拒绝。
 * - `http_error`：其他非 2xx（含 404/405——端点可达但未实现 /models）。
 * - `unreachable`：DNS/连接/超时失败，或被 SSRF 防护阻断。
 */
export type UpstreamApiHealthStatus =
  | "ok"
  | "auth_failed"
  | "http_error"
  | "unreachable";

/** 单次探测的结构化结果。`message` 为中性简短英文描述，供日志/兜底展示。 */
export interface UpstreamApiHealthResult {
  /** 是否判定为存活可用（等价于 status === "ok"）。 */
  ok: boolean;
  status: UpstreamApiHealthStatus;
  /** 上游返回的 HTTP 状态码；网络层失败时缺省。 */
  httpStatus?: number;
  /** 从发起到拿到响应（或失败）的耗时毫秒。 */
  latencyMs: number;
  /** /models 返回列表时的模型数量；无法解析时缺省。 */
  modelCount?: number;
  /** 中性简短描述（如 "OK"、"HTTP 401"、"timeout"）。 */
  message: string;
}

/** 探测入参。`baseUrl` 应已含版本前缀（如 https://api.example.com/v1）。 */
export interface ProbeUpstreamApiInput {
  baseUrl: string;
  apiKey: string;
  /** 超时毫秒，默认 10000，clamp 到 [1000, 20000]。 */
  timeoutMs?: number;
  /** 外部取消信号。 */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 20_000;

/** 去除末尾斜杠，避免 `${baseUrl}/models` 出现双斜杠。 */
function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * 对一个 OpenAI 兼容端点执行"测活"探针。
 *
 * 行为：GET `${baseUrl}/models`，带 `Authorization: Bearer <apiKey>`，
 * 经 `fetchWithDnsPin` 发送（SSRF 安全），按 HTTP 结果归类。
 *
 * @param input 端点地址、密钥、可选超时与取消信号。
 * @returns 结构化探测结果；本函数不抛错——所有失败都映射为对应 status。
 * @remarks 无副作用（纯探测，不写库、不计费）。baseUrl 非法时直接返回
 *          `unreachable`；被 DNS pin 判定为私网时同样返回 `unreachable`。
 */
export async function probeUpstreamApi(
  input: ProbeUpstreamApiInput
): Promise<UpstreamApiHealthResult> {
  const baseUrl = stripTrailingSlash(input.baseUrl.trim());
  const apiKey = input.apiKey.trim();
  const timeoutMs = Math.min(
    Math.max(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS),
    MAX_TIMEOUT_MS
  );

  let target: string;
  try {
    target = new URL(`${baseUrl}/models`).href;
  } catch {
    return {
      ok: false,
      status: "unreachable",
      latencyMs: 0,
      message: "Invalid base URL",
    };
  }

  const startedAt = Date.now();
  try {
    const response = await fetchWithDnsPin(target, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      timeoutMs,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const latencyMs = Date.now() - startedAt;
    const httpStatus = response.status;

    if (httpStatus >= 200 && httpStatus < 300) {
      let modelCount: number | undefined;
      try {
        const body = (await response.json()) as { data?: unknown };
        if (Array.isArray(body?.data)) {
          modelCount = body.data.length;
        }
      } catch {
        // 2xx 但响应体非 JSON：仍判定为可达可用，仅无法统计模型数。
      }
      return {
        ok: true,
        status: "ok",
        httpStatus,
        latencyMs,
        ...(modelCount !== undefined ? { modelCount } : {}),
        message: "OK",
      };
    }

    if (httpStatus === 401 || httpStatus === 403) {
      return {
        ok: false,
        status: "auth_failed",
        httpStatus,
        latencyMs,
        message: `HTTP ${httpStatus}`,
      };
    }

    return {
      ok: false,
      status: "http_error",
      httpStatus,
      latencyMs,
      message: `HTTP ${httpStatus}`,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (error instanceof SsrfBlockedError) {
      return {
        ok: false,
        status: "unreachable",
        latencyMs,
        message: "Blocked private/reserved address",
      };
    }
    return {
      ok: false,
      status: "unreachable",
      latencyMs,
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}
