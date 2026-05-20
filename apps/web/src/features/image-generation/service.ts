import { db } from "@repo/database";
import { userApiConfig } from "@repo/database/schema";
import {
  canUseCustomApi,
  GPT52_CHAT_MODEL,
  GPT54_CHAT_MODEL,
  GPT54_MINI_CHAT_MODEL,
  GPT55_CHAT_MODEL,
  RESPONSES_IMAGE_MODELS,
} from "@repo/shared/config/subscription-plan";
import { logError, logWarn } from "@repo/shared/logger";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { eq } from "drizzle-orm";
import {
  acquireImageBackendInflight,
  ImageBackendPoolUnavailableError,
  isImageBackendRetryableError,
  reportImageBackendResult,
  releaseImageBackendInflight,
  resolveImageBackendPoolConfig,
} from "@/features/image-backend-pool/service";
import type { ImageBackendRequestKind } from "@/features/image-backend-pool/types";
import {
  editImageWithChatGptWeb,
  generateImageWithChatGptWeb,
} from "./chatgpt-web";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  getImageModel,
  isImageModel,
  normalizeImageModel,
  parseImageSize,
} from "./resolution";
import {
  buildResponsesImageEditRequest,
  buildResponsesImageGenerationRequest,
} from "./responses-image";
import type {
  ApiConfig,
  ChatHistoryMessage,
  ChatImageParams,
  EditImageParams,
  GenerateImageParams,
  GenerateImageResult,
  ImageGenerationCallbacks,
  ImageInputFile,
  ImageModeration,
  ImageQuality,
  PartialImageResult,
  ThinkingLevel,
} from "./types";

const VALID_QUALITIES = new Set<ImageQuality>([
  "auto",
  "low",
  "medium",
  "high",
]);
const VALID_MODERATION = new Set<ImageModeration>(["auto", "low"]);
const DEFAULT_RESPONSES_MODEL = GPT54_CHAT_MODEL;
const DEFAULT_RESPONSES_IMAGE_INSTRUCTIONS =
  "You are an image generation assistant. Use the image_generation tool when the user asks for an image, edit, or visual output.";
const ORIGINAL_PROMPT_RESPONSES_IMAGE_INSTRUCTIONS =
  "Use the user's original image prompt exactly as written when calling the image_generation tool. Do not rewrite, expand, translate, polish, or optimize the latest user prompt before image generation.";

type ImageOutput = {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
};

type ImageResponsePayload = {
  type?: string;
  data?: ImageOutput[];
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
  index?: number;
  partial_image_index?: number;
  error?: { message?: string } | string;
  message?: string;
};

type ResponsesOutputItem = {
  type?: string;
  result?: string;
  revised_prompt?: string;
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  summary?: Array<{
    type?: string;
    text?: string;
  }>;
};

type ResponsesPayload = {
  output?: ResponsesOutputItem[];
  error?: { message?: string } | string;
  message?: string;
};

type ResponsesRequestContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "output_text"; text: string };

type ResponsesRequestMessage = {
  role: "user" | "assistant";
  content: ResponsesRequestContent[];
};

type ReasoningConfig = {
  effort: ThinkingLevel;
  summary?: "concise";
};

function getModel(config: ApiConfig, model?: string) {
  const requestedModel = normalizeImageModel(model);
  if (requestedModel && !isImageModel(requestedModel)) {
    throw new Error(
      "Unsupported model for image generation. Use a gpt-image-* model."
    );
  }

  const imageModel = getImageModel(requestedModel, config.model);
  if (!imageModel) {
    throw new Error(
      "Unsupported model for image generation. Use a gpt-image-* model."
    );
  }
  return imageModel;
}

function isPoolBackend(config: ApiConfig) {
  return config.backend?.type === "pool-account";
}

function getHeaders(
  config: ApiConfig,
  defaults: Record<string, string>
): Record<string, string> {
  return {
    ...defaults,
    ...(config.headers || {}),
    Authorization: `Bearer ${config.apiKey}`,
  };
}

function normalizeResponsesModel(
  model: string,
  options?: { allowGpt55?: boolean },
  explicit = false
) {
  const requested = model.trim();
  if (!requested) return null;
  if (isImageModel(requested)) {
    if (explicit) {
      throw new Error(
        `Unsupported chat model. Use ${RESPONSES_IMAGE_MODELS.join(", ")}.`
      );
    }
    return null;
  }

  if (requested === GPT55_CHAT_MODEL && !options?.allowGpt55) {
    throw new Error("GPT-5.5 chat model requires Ultra plan.");
  }

  if (
    requested === GPT54_CHAT_MODEL ||
    requested === GPT54_MINI_CHAT_MODEL ||
    requested === GPT52_CHAT_MODEL ||
    requested === GPT55_CHAT_MODEL
  ) {
    return requested;
  }

  if (explicit) {
    throw new Error(
      `Unsupported chat model. Use ${RESPONSES_IMAGE_MODELS.join(", ")}.`
    );
  }

  return null;
}

export async function getResponsesModel(
  config: ApiConfig,
  model?: string,
  options?: { allowGpt55?: boolean }
) {
  const requested = model?.trim();
  if (requested) {
    const normalized = normalizeResponsesModel(requested, options, true);
    if (normalized) return normalized;
  }

  const configured = config.model?.trim();
  if (configured) {
    const normalized = normalizeResponsesModel(configured, options);
    if (normalized) return normalized;
  }

  if (options?.allowGpt55) {
    return GPT55_CHAT_MODEL;
  }

  const fallbackModel =
    (await getRuntimeSettingString("PLATFORM_RESPONSES_MODEL")) ||
    (await getRuntimeSettingString("PLATFORM_CHAT_MODEL")) ||
    DEFAULT_RESPONSES_MODEL;

  return (
    normalizeResponsesModel(fallbackModel, {
      allowGpt55: options?.allowGpt55,
    }) || DEFAULT_RESPONSES_MODEL
  );
}

async function getDefaultImageGptModel(
  config: ApiConfig,
  options?: { allowGpt55?: boolean }
) {
  if (!isPoolBackend(config)) return undefined;
  return await getResponsesModel(config, undefined, options);
}

function getApiErrorMessage(errorData: unknown): string | null {
  if (typeof errorData === "string" && errorData.trim()) {
    return errorData.trim();
  }

  if (Array.isArray(errorData)) {
    const parts = errorData
      .map((item) => getApiErrorMessage(item))
      .filter((item): item is string => Boolean(item));
    return parts.length ? parts.join(" | ") : null;
  }

  if (
    errorData &&
    typeof errorData === "object" &&
    "error" in errorData &&
    errorData.error
  ) {
    const nested = getApiErrorMessage(errorData.error);
    if (nested) return nested;
  }

  if (
    errorData &&
    typeof errorData === "object" &&
    "response" in errorData &&
    errorData.response
  ) {
    const nested = getApiErrorMessage(errorData.response);
    if (nested) return nested;
  }

  if (errorData && typeof errorData === "object") {
    const record = errorData as Record<string, unknown>;
    const parts = [
      record.message,
      record.detail,
      record.details,
      record.code,
      record.type,
      record.status,
    ]
      .flatMap((value) => {
        if (typeof value === "string" && value.trim()) return [value.trim()];
        if (typeof value === "number" && Number.isFinite(value)) {
          return [String(value)];
        }
        const nested = getApiErrorMessage(value);
        return nested ? [nested] : [];
      })
      .filter(Boolean);
    if (parts.length) return parts.join(" | ");
  }

  return null;
}

function getApiError(errorData: unknown, fallback: string) {
  return getApiErrorMessage(errorData) || fallback;
}

function getHeaderValue(headers: Headers, names: string[]) {
  for (const name of names) {
    const value = headers.get(name);
    if (value?.trim()) return value.trim();
  }
  return null;
}

function parseHeaderNumber(headers: Headers, name: string) {
  const value = headers.get(name);
  if (!value?.trim()) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseRetryAfterHeader(value: string | null) {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const durationMs = parseDurationMs(value);
  if (durationMs) return Math.max(1, Math.ceil(durationMs / 1000));
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));
}

function parseDurationMs(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^\d+(?:\.\d+)?\s*ms$/.test(trimmed)) {
    return Number.parseFloat(trimmed) || null;
  }
  if (/^\d+(?:\.\d+)?\s*s$/.test(trimmed)) {
    return Number.parseFloat(trimmed) * 1000;
  }
  if (/^\d+(?:\.\d+)?\s*m$/.test(trimmed)) {
    return Number.parseFloat(trimmed) * 60_000;
  }
  if (/^\d+(?:\.\d+)?\s*h$/.test(trimmed)) {
    return Number.parseFloat(trimmed) * 60 * 60_000;
  }
  if (/^\d+(?:\.\d+)?\s*d(?:ay|ays)?$/.test(trimmed)) {
    return Number.parseFloat(trimmed) * 24 * 60 * 60_000;
  }
  const parts = [
    ...trimmed.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|day|days)/g),
  ];
  if (!parts.length) return null;
  const total = parts.reduce((sum, match) => {
    const amount = Number.parseFloat(match[1] || "0");
    const unit = match[2];
    if (unit === "ms") return sum + amount;
    if (unit === "s") return sum + amount * 1000;
    if (unit === "m") return sum + amount * 60_000;
    if (unit === "h") return sum + amount * 60 * 60_000;
    if (unit === "d" || unit === "day" || unit === "days") {
      return sum + amount * 24 * 60 * 60_000;
    }
    return sum;
  }, 0);
  return total > 0 ? total : null;
}

function getCodexRetryAfterSeconds(headers: Headers) {
  // Codex reports two windows, currently commonly 5h (300m) and 7d (10080m).
  // When a window is exhausted, use that window's reset-after seconds.
  const windows = [
    {
      usedPercent: parseHeaderNumber(headers, "x-codex-primary-used-percent"),
      resetAfterSeconds: parseHeaderNumber(
        headers,
        "x-codex-primary-reset-after-seconds"
      ),
      windowMinutes: parseHeaderNumber(
        headers,
        "x-codex-primary-window-minutes"
      ),
    },
    {
      usedPercent: parseHeaderNumber(headers, "x-codex-secondary-used-percent"),
      resetAfterSeconds: parseHeaderNumber(
        headers,
        "x-codex-secondary-reset-after-seconds"
      ),
      windowMinutes: parseHeaderNumber(
        headers,
        "x-codex-secondary-window-minutes"
      ),
    },
  ].filter(
    (item) =>
      item.resetAfterSeconds &&
      item.resetAfterSeconds > 0 &&
      item.windowMinutes &&
      item.windowMinutes > 0
  );

  if (!windows.length) return undefined;

  const exhausted = windows.filter(
    (item) => item.usedPercent !== undefined && item.usedPercent >= 100
  );
  if (exhausted.length) {
    return Math.max(...exhausted.map((item) => item.resetAfterSeconds || 0));
  }

  return Math.max(...windows.map((item) => item.resetAfterSeconds || 0));
}

function getResponseRetryMetadata(response: Response) {
  const retryAfterSeconds = parseRetryAfterHeader(
    getHeaderValue(response.headers, ["retry-after"])
  );
  const upstreamResetAt = getHeaderValue(response.headers, [
    "x-ratelimit-reset",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "x-ratelimit-reset-images",
    "x-ratelimit-reset-image-requests",
    "x-ratelimit-reset-input-tokens",
    "x-ratelimit-reset-output-tokens",
  ]);
  const codexResetAfterSeconds = getCodexRetryAfterSeconds(response.headers);
  return {
    upstreamResetAt: upstreamResetAt || undefined,
    retryAfterSeconds:
      Math.max(retryAfterSeconds || 0, codexResetAfterSeconds || 0) ||
      undefined,
  };
}

function extractPayloadRetryMetadata(payload: unknown): {
  upstreamResetAt?: string;
  retryAfterSeconds?: number;
} {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const metadata = extractPayloadRetryMetadata(item);
      if (metadata.upstreamResetAt || metadata.retryAfterSeconds) {
        return metadata;
      }
    }
    return {};
  }
  if (!payload || typeof payload !== "object") return {};
  const record = payload as Record<string, unknown>;
  const nested = [
    record.error,
    record.response,
    record.details,
    record.metadata,
    record.payload,
    record.data,
  ];
  const keys = [
    "resetAt",
    "reset_at",
    "resetAfter",
    "reset_after",
    "reset_after_seconds",
    "resetsAt",
    "resets_at",
    "resetsInSeconds",
    "resets_in_seconds",
    "restore_at",
    "restoreAt",
    "restoreAfter",
    "restore_after",
    "quotaResetDelay",
    "retry_at",
    "upstreamResetAt",
    "upstream_reset_at",
  ];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      if (
        /after$/i.test(key) ||
        /seconds$/i.test(key) ||
        key === "quotaResetDelay"
      ) {
        const parsed = parseRetryAfterHeader(value.trim());
        if (parsed) return { retryAfterSeconds: parsed };
      }
      return { upstreamResetAt: value.trim() };
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      if (
        /after$/i.test(key) ||
        /seconds$/i.test(key) ||
        key === "quotaResetDelay"
      ) {
        return { retryAfterSeconds: value };
      }
      return { upstreamResetAt: String(value) };
    }
  }
  const retryAfter = record.retry_after ?? record.retryAfter;
  if (
    typeof retryAfter === "number" &&
    Number.isFinite(retryAfter) &&
    retryAfter > 0
  ) {
    return { retryAfterSeconds: retryAfter };
  }
  if (typeof retryAfter === "string" && retryAfter.trim()) {
    const parsed = parseRetryAfterHeader(retryAfter.trim());
    if (parsed) return { retryAfterSeconds: parsed };
  }
  for (const value of nested) {
    const metadata = extractPayloadRetryMetadata(value);
    if (metadata.upstreamResetAt || metadata.retryAfterSeconds) return metadata;
  }
  return {};
}

function withRetryMetadata(
  result: GenerateImageResult,
  metadata: { upstreamResetAt?: string; retryAfterSeconds?: number }
): GenerateImageResult {
  if (!metadata.upstreamResetAt && !metadata.retryAfterSeconds) return result;
  return {
    ...result,
    upstreamResetAt: result.upstreamResetAt || metadata.upstreamResetAt,
    retryAfterSeconds: result.retryAfterSeconds ?? metadata.retryAfterSeconds,
  };
}

function safeParseJson(value: string) {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function truncateResponseBody(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function getHttpErrorMessage(
  response: Response,
  rawBody: string,
  apiName: "Images API" | "Responses API"
) {
  const fallback = `Upstream ${apiName} returned HTTP ${response.status}`;
  const trimmedBody = truncateResponseBody(rawBody);

  if (!trimmedBody) return fallback;
  if (trimmedBody.startsWith("<")) {
    return `${fallback}: HTML response body. Check that the API base URL points to an OpenAI-compatible /v1 endpoint.`;
  }

  let errorData: unknown = trimmedBody;
  try {
    errorData = JSON.parse(rawBody);
  } catch {
    return `${fallback}: ${trimmedBody}`;
  }

  const apiError = getApiErrorMessage(errorData);
  return apiError ? `${fallback}: ${apiError}` : `${fallback}: ${trimmedBody}`;
}

function getNonJsonErrorMessage(
  rawBody: string,
  apiName: "Images API" | "Responses API"
) {
  const trimmedBody = truncateResponseBody(rawBody);
  if (trimmedBody.startsWith("<")) {
    return `API returned an HTML page instead of a ${apiName} response. Check that the API base URL points to an OpenAI-compatible /v1 endpoint.`;
  }
  if (!trimmedBody)
    return `API returned an empty non-JSON ${apiName} response.`;
  return `API returned a non-JSON ${apiName} response: ${trimmedBody}`;
}

function looksLikeEventStreamText(text: string) {
  return /(?:^|\n)(?:event|data):/.test(text.replace(/\r\n/g, "\n"));
}

function normalizeQuality(quality?: string): ImageQuality | undefined {
  if (!quality || quality === "auto") return undefined;
  return VALID_QUALITIES.has(quality as ImageQuality)
    ? (quality as ImageQuality)
    : undefined;
}

function normalizeModeration(moderation?: string): ImageModeration | undefined {
  if (!moderation) return undefined;
  return VALID_MODERATION.has(moderation as ImageModeration)
    ? (moderation as ImageModeration)
    : undefined;
}

function normalizeThinking(thinking?: string): ThinkingLevel | undefined {
  if (
    thinking === "none" ||
    thinking === "low" ||
    thinking === "medium" ||
    thinking === "high" ||
    thinking === "xhigh"
  ) {
    return thinking;
  }

  return undefined;
}

function describeEndpoint(baseUrl: string, path: string) {
  try {
    const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    return `${url.origin}${url.pathname}`;
  } catch {
    return `${baseUrl.replace(/\/$/, "")}${path}`;
  }
}

function logImageRequestError(
  error: unknown,
  context: {
    operation: "generate" | "edit" | "chat";
    baseUrl: string;
    path: string;
    model?: string;
    useStream?: boolean;
  }
) {
  logError(error, {
    source: "image-generation",
    operation: context.operation,
    endpoint: describeEndpoint(context.baseUrl, context.path),
    model: context.model,
    useStream: Boolean(context.useStream),
  });
}

function toBlobPart(buffer: Buffer): BlobPart {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isPoolAccountBackend(
  config: ApiConfig,
  accountBackend: "web" | "responses"
) {
  return (
    config.backend?.type === "pool-account" &&
    config.backend.accountBackend === accountBackend
  );
}

function isResponsesBackend(config: ApiConfig) {
  return isPoolAccountBackend(config, "responses");
}

async function reportPoolBackendResult(
  config: ApiConfig,
  result: GenerateImageResult
): Promise<boolean> {
  if (!config.backend?.reportResult) return false;
  if (
    config.backend.type !== "pool-api" &&
    config.backend.type !== "pool-account"
  ) {
    return false;
  }
  try {
    const outcome = await reportImageBackendResult({
      memberType: config.backend.type === "pool-api" ? "api" : "account",
      memberId: config.backend.id,
      success: !result.error,
      error: result.error,
      upstreamResetAt: result.upstreamResetAt,
      retryAfterSeconds: result.retryAfterSeconds,
    });
    return outcome.retryable;
  } catch (error) {
    logError(error, {
      source: "image-backend-pool",
      operation: "report-result",
      backendType: config.backend.type,
      backendId: config.backend.id,
    });
  }
  return false;
}

function poolBackendMemberKey(config: ApiConfig) {
  if (
    config.backend?.type !== "pool-api" &&
    config.backend?.type !== "pool-account"
  ) {
    return null;
  }
  if (!config.backend.id) return null;
  return `${config.backend.type === "pool-api" ? "api" : "account"}:${
    config.backend.id
  }`;
}

async function retryPoolBackendResult(
  config: ApiConfig,
  run: (candidate: ApiConfig) => Promise<GenerateImageResult>
) {
  if (
    !config.backend?.reportResult ||
    (config.backend.type !== "pool-api" &&
      config.backend.type !== "pool-account")
  ) {
    return run(config);
  }

  const requestKind = config.backend.requestKind;
  const excluded = new Set<string>();
  let candidate = config;
  let lastResult: GenerateImageResult | null = null;
  let attempt = 0;

  while (true) {
    attempt += 1;
    let result: GenerateImageResult;
    const currentBackend = candidate.backend;
    if (
      currentBackend?.type === "pool-api" ||
      currentBackend?.type === "pool-account"
    ) {
      acquireImageBackendInflight({
        memberType: currentBackend.type === "pool-api" ? "api" : "account",
        memberId: currentBackend.id,
      });
    }
    try {
      result = await run(withoutPoolBackendReport(candidate));
    } finally {
      if (
        currentBackend?.type === "pool-api" ||
        currentBackend?.type === "pool-account"
      ) {
        releaseImageBackendInflight({
          memberType: currentBackend.type === "pool-api" ? "api" : "account",
          memberId: currentBackend.id,
        });
      }
    }
    const shouldRetry = await reportPoolBackendResult(candidate, result);
    lastResult = result;

    if (
      !result.error ||
      !(shouldRetry || isImageBackendRetryableError(result.error))
    ) {
      return result;
    }

    const memberKey = poolBackendMemberKey(candidate);
    if (memberKey) excluded.add(memberKey);
    if (!requestKind || !config.backend.userId) break;
    const backend = candidate.backend;
    if (
      !backend ||
      (backend.type !== "pool-api" && backend.type !== "pool-account")
    ) {
      break;
    }

    logWarn("生图后端可重试错误，准备切换账号池成员", {
      attempt,
      requestKind,
      backendType: backend.type,
      backendId: backend.id,
      groupId: backend.groupId,
      error: result.error,
    });

    let next: Awaited<ReturnType<typeof resolveImageBackendPoolConfig>>;
    try {
      next = await resolveImageBackendPoolConfig({
        userId: config.backend.userId,
        apiKeyId: config.backend.apiKeyId,
        requestKind,
        excludedMemberKeys: Array.from(excluded),
      });
    } catch (error) {
      if (error instanceof ImageBackendPoolUnavailableError) {
        logWarn("生图后端没有可切换的账号池成员", {
          attempt,
          requestKind,
          excludedCount: excluded.size,
          lastError: result.error,
        });
        break;
      }
      throw error;
    }
    if (!next?.config?.backend) break;
    if (poolBackendMemberKey(next.config) === memberKey) {
      logWarn("生图后端重试选回同一成员，停止切换", {
        requestKind,
        memberKey,
        lastError: result.error,
      });
      break;
    }
    logWarn("生图后端已切换账号池成员重试", {
      nextAttempt: attempt + 1,
      requestKind,
      previousMemberKey: memberKey,
      nextBackendType: next.config.backend.type,
      nextBackendId: next.config.backend.id,
      nextGroupId: next.config.backend.groupId,
      excludedCount: excluded.size,
    });
    candidate = next.config;
  }

  return lastResult || run(withoutPoolBackendReport(config));
}

function withoutPoolBackendReport(config: ApiConfig): ApiConfig {
  if (!config.backend) return config;
  return {
    ...config,
    backend: {
      ...config.backend,
      reportResult: false,
    },
  };
}

function applyPromptOptimizationResultVisibility(
  result: GenerateImageResult
): GenerateImageResult {
  if (result.error) return result;
  const upstreamRevisedPrompt =
    result.upstreamRevisedPrompt || result.revisedPrompt;
  if (!upstreamRevisedPrompt) return result;

  return {
    ...result,
    revisedPrompt: result.revisedPrompt || upstreamRevisedPrompt,
    upstreamRevisedPrompt,
  };
}

function getDataUrl(image: ImageInputFile) {
  if (image.url?.startsWith("http://") || image.url?.startsWith("https://")) {
    return image.url;
  }
  return `data:${image.type || "image/png"};base64,${image.data.toString("base64")}`;
}

function isUsableInputImageUrl(url: string) {
  return (
    url.startsWith("data:image/") ||
    url.startsWith("http://") ||
    url.startsWith("https://")
  );
}

function historyVariantText(message: ChatHistoryMessage) {
  const variants = message.variants || [];
  const variant = variants[message.activeVariant || 0] || variants[0];
  const imageNote = variant?.imageUrl
    ? `\nGenerated image: ${variant.imageUrl}`
    : "";
  return `${variant?.text || message.text || ""}${imageNote}`;
}

function buildResponsesInput(
  prompt: string,
  images: ImageInputFile[] | undefined,
  history: ChatHistoryMessage[] | undefined
): ResponsesRequestMessage[] {
  const input: ResponsesRequestMessage[] = [];

  for (const message of history || []) {
    if (message.error) continue;

    if (message.role === "user") {
      const content: ResponsesRequestContent[] = [
        { type: "input_text", text: message.text || "" },
      ];
      for (const imageUrl of message.imageUrls || []) {
        if (isUsableInputImageUrl(imageUrl)) {
          content.push({ type: "input_image", image_url: imageUrl });
        }
      }
      input.push({ role: "user", content });
      continue;
    }

    const text = historyVariantText(message).trim();
    if (text) {
      input.push({
        role: "assistant",
        content: [{ type: "output_text", text }],
      });
    }
  }

  const currentContent: ResponsesRequestContent[] = [
    { type: "input_text", text: prompt },
    ...(images || []).map((image) => ({
      type: "input_image" as const,
      image_url: getDataUrl(image),
    })),
  ];
  input.push({ role: "user", content: currentContent });

  return input;
}

function getEffectivePrompt(params: {
  prompt: string;
  apiPrompt?: string;
  promptOptimization?: boolean;
}) {
  if (params.promptOptimization === false) {
    return params.prompt;
  }
  return params.apiPrompt || params.prompt;
}

function appendImageParams(
  formData: FormData,
  config: ApiConfig,
  params: {
    prompt: string;
    model?: string;
    n?: number;
    size?: string;
    quality?: ImageQuality;
    moderation?: ImageModeration;
    promptOptimization?: boolean;
  }
) {
  formData.append("model", getModel(config, params.model));
  formData.append("prompt", params.prompt);
  formData.append("n", String(params.n || 1));
  formData.append("response_format", "b64_json");

  if (params.size) {
    formData.append("size", params.size);
    const dimensions = parseImageSize(params.size);
    if (dimensions) {
      formData.append("width", String(dimensions.width));
      formData.append("height", String(dimensions.height));
    }
  }

  const quality = normalizeQuality(params.quality);
  if (quality) {
    formData.append("quality", quality);
  }

  const moderation = normalizeModeration(params.moderation);
  if (moderation) {
    formData.append("moderation", moderation);
  }

  if (config.useStream) {
    formData.append("stream", "true");
    formData.append("partial_images", "2");
  }
}

function toGenerateImageResult(image: ImageOutput): GenerateImageResult {
  const result: GenerateImageResult = {};
  if (image.b64_json) result.imageBase64 = image.b64_json;
  if (image.url) result.imageUrl = image.url;
  if (image.revised_prompt) result.upstreamRevisedPrompt = image.revised_prompt;
  return result;
}

function getPayloadError(payload: unknown): string | null {
  const apiError = getApiErrorMessage(payload);
  if (apiError) return apiError;

  if (
    payload &&
    typeof payload === "object" &&
    "type" in payload &&
    payload.type === "upstream_error" &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }

  return null;
}

function extractImageFromPayload(
  payload: ImageResponsePayload
): GenerateImageResult | null {
  const image = payload.data?.find((item) => item.b64_json || item.url);
  if (image) {
    return toGenerateImageResult(image);
  }

  if (payload.b64_json || payload.url) {
    return toGenerateImageResult(payload);
  }

  return null;
}

function extractPartialImage(
  payload: ImageResponsePayload
): PartialImageResult | null {
  if (!payload.b64_json && !payload.url) {
    return null;
  }

  const result: PartialImageResult = {};
  if (payload.b64_json) result.imageBase64 = payload.b64_json;
  if (payload.url) result.imageUrl = payload.url;
  if (typeof payload.index === "number") result.index = payload.index;
  if (typeof payload.partial_image_index === "number") {
    result.partialImageIndex = payload.partial_image_index;
  }
  return result;
}

function parseResponsesOutput(
  output: ResponsesOutputItem[] | undefined
): GenerateImageResult | null {
  let imageBase64: string | undefined;
  let revisedPrompt: string | undefined;
  let responseText: string | undefined;
  let responseThinking: string | undefined;

  for (const item of output || []) {
    if (item.type === "reasoning" && item.summary) {
      const text = item.summary
        .filter((part) => part.type === "summary_text" && part.text)
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text) {
        responseThinking = responseThinking
          ? `${responseThinking}\n${text}`
          : text;
      }
    }

    if (item.type === "image_generation_call" && item.result) {
      imageBase64 = item.result;
      if (item.revised_prompt) revisedPrompt = item.revised_prompt;
      continue;
    }

    if (item.type === "message" && item.content) {
      const text = item.content
        .filter((part) => part.type === "output_text" && part.text)
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text) responseText = responseText ? `${responseText}\n${text}` : text;
    }
  }

  if (!imageBase64 && !responseText && !responseThinking) return null;

  return {
    imageBase64,
    upstreamRevisedPrompt: revisedPrompt,
    responseText,
    responseThinking,
  };
}

function extractResponseCompletedPayload(
  payload: ResponsesPayload | { response?: ResponsesPayload }
) {
  if ("response" in payload && payload.response) {
    return payload.response;
  }
  return payload as ResponsesPayload;
}

async function processResponsesEventPayload(
  eventName: string,
  dataLines: string[],
  state: EventStreamParseState,
  callbacks?: ImageGenerationCallbacks
) {
  const data = dataLines.join("\n").trim();
  if (!data || data === "[DONE]") return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (
    eventName === "response.failed" ||
    eventName === "error" ||
    payload.type === "response.failed" ||
    payload.type === "error"
  ) {
    const retryMetadata = extractPayloadRetryMetadata(payload);
    const message = getApiError(payload, "Responses API stream failed");
    if (!retryMetadata.upstreamResetAt && !retryMetadata.retryAfterSeconds) {
      return message;
    }
    return `${message} ${JSON.stringify(retryMetadata)}`;
  }

  if (eventName === "response.output_item.done") {
    const item = payload.item as ResponsesOutputItem | undefined;
    if (item?.type === "image_generation_call" && item.result) {
      const partialImage = {
        imageBase64: item.result,
      };
      await callbacks?.onPartialImage?.(partialImage);
      state.fallbackResult = {
        imageBase64: item.result,
        upstreamRevisedPrompt: item.revised_prompt,
      };
    }
    return null;
  }

  if (eventName === "response.output_text.delta") {
    const delta = payload.delta;
    if (typeof delta === "string" && delta) {
      await callbacks?.onTextDelta?.(delta);
      state.fallbackResult = {
        ...(state.fallbackResult || {}),
        responseText: `${state.fallbackResult?.responseText || ""}${delta}`,
      };
    }
    return null;
  }

  if (eventName === "response.reasoning_summary_text.delta") {
    const delta = payload.delta;
    if (typeof delta === "string" && delta) {
      await callbacks?.onThinkingDelta?.(delta);
      state.fallbackResult = {
        ...(state.fallbackResult || {}),
        responseThinking: `${state.fallbackResult?.responseThinking || ""}${delta}`,
      };
    }
    return null;
  }

  if (eventName === "response.completed") {
    const completedPayload = extractResponseCompletedPayload(
      payload as ResponsesPayload | { response?: ResponsesPayload }
    );
    const result = parseResponsesOutput(completedPayload.output);
    if (result) {
      state.completedResult = result;
    }
  }

  return null;
}

async function processResponsesEventBlock(
  block: string,
  state: EventStreamParseState,
  callbacks?: ImageGenerationCallbacks
) {
  let eventName = "";
  const dataLines: string[] = [];
  const lines = block.replace(/\r\n/g, "\n").split("\n");

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue =
      separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") {
      eventName = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  return await processResponsesEventPayload(
    eventName,
    dataLines,
    state,
    callbacks
  );
}

async function parseResponsesEventStreamResponse(
  response: Response,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  if (!response.body) {
    return parseResponsesEventStreamText(await response.text(), callbacks);
  }

  const state: EventStreamParseState = {
    completedResult: null,
    fallbackResult: null,
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      if (!block.trim()) continue;
      const error = await processResponsesEventBlock(block, state, callbacks);
      if (error) {
        await reader.cancel().catch(() => undefined);
        return { error };
      }
    }

    if (done) break;
  }

  if (buffer.trim()) {
    const error = await processResponsesEventBlock(buffer, state, callbacks);
    if (error) return { error };
  }

  return finishEventStream(state);
}

async function parseResponsesEventStreamText(
  text: string,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  const state: EventStreamParseState = {
    completedResult: null,
    fallbackResult: null,
  };

  for (const block of text.replace(/\r\n/g, "\n").split("\n\n")) {
    if (!block.trim()) continue;
    const error = await processResponsesEventBlock(block, state, callbacks);
    if (error) return { error };
  }

  return finishEventStream(state);
}

async function parseResponsesResponse(
  response: Response,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  const responseRetryMetadata = getResponseRetryMetadata(response);
  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    return {
      error: getHttpErrorMessage(response, rawBody, "Responses API"),
      ...responseRetryMetadata,
      ...extractPayloadRetryMetadata(safeParseJson(rawBody)),
    };
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return withRetryMetadata(
      await parseResponsesEventStreamResponse(response, callbacks),
      responseRetryMetadata
    );
  }

  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    if (looksLikeEventStreamText(text)) {
      return withRetryMetadata(
        await parseResponsesEventStreamText(text, callbacks),
        responseRetryMetadata
      );
    }
    return {
      error: getNonJsonErrorMessage(text, "Responses API"),
      ...responseRetryMetadata,
    };
  }

  const data = (await response.json()) as ResponsesPayload;
  const result = parseResponsesOutput(data.output);

  return withRetryMetadata(
    result || { error: getPayloadError(data) || "API returned no image data" },
    { ...responseRetryMetadata, ...extractPayloadRetryMetadata(data) }
  );
}

type EventStreamParseState = {
  completedResult: GenerateImageResult | null;
  fallbackResult: GenerateImageResult | null;
};

async function processEventPayload(
  eventName: string,
  dataLines: string[],
  state: EventStreamParseState,
  callbacks?: ImageGenerationCallbacks
) {
  if (dataLines.length === 0) return null;

  const data = dataLines.join("\n").trim();
  if (!data || data === "[DONE]") return null;

  let payload: ImageResponsePayload;
  try {
    payload = JSON.parse(data) as ImageResponsePayload;
  } catch {
    return null;
  }

  if (eventName === "error" || payload.type === "upstream_error") {
    return getPayloadError(payload) || "Image generation stream failed";
  }

  if (
    eventName.includes("partial_image") ||
    payload.type?.includes("partial_image")
  ) {
    const partialImage = extractPartialImage(payload);
    if (partialImage) {
      await callbacks?.onPartialImage?.(partialImage);
    }
    return null;
  }

  const result = extractImageFromPayload(payload);
  if (!result) return null;

  if (
    eventName.endsWith(".completed") ||
    payload.type?.endsWith(".completed")
  ) {
    state.completedResult = result;
  } else if (!state.fallbackResult) {
    state.fallbackResult = result;
  }

  return null;
}

async function processEventBlock(
  block: string,
  state: EventStreamParseState,
  callbacks?: ImageGenerationCallbacks
) {
  let eventName = "";
  const dataLines: string[] = [];
  const lines = block.replace(/\r\n/g, "\n").split("\n");

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue =
      separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") {
      eventName = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  return await processEventPayload(eventName, dataLines, state, callbacks);
}

function finishEventStream(state: EventStreamParseState): GenerateImageResult {
  const result = state.completedResult || state.fallbackResult;
  if (result) return result;

  return { error: "API returned no image data" };
}

async function parseEventStreamText(
  text: string,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  const state: EventStreamParseState = {
    completedResult: null,
    fallbackResult: null,
  };

  const blocks = text.replace(/\r\n/g, "\n").split("\n\n");
  for (const block of blocks) {
    if (!block.trim()) continue;
    const error = await processEventBlock(block, state, callbacks);
    if (error) return { error };
  }

  return finishEventStream(state);
}

async function parseEventStreamResponse(
  response: Response,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  if (!response.body) {
    return parseEventStreamText(await response.text(), callbacks);
  }

  const state: EventStreamParseState = {
    completedResult: null,
    fallbackResult: null,
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      if (!block.trim()) continue;
      const error = await processEventBlock(block, state, callbacks);
      if (error) {
        await reader.cancel().catch(() => undefined);
        return { error };
      }
    }

    if (done) break;
  }

  if (buffer.trim()) {
    const error = await processEventBlock(buffer, state, callbacks);
    if (error) return { error };
  }

  return finishEventStream(state);
}

async function parseImageResponse(
  response: Response,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  const responseRetryMetadata = getResponseRetryMetadata(response);
  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    return {
      error: getHttpErrorMessage(response, rawBody, "Images API"),
      ...responseRetryMetadata,
      ...extractPayloadRetryMetadata(safeParseJson(rawBody)),
    };
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return withRetryMetadata(
      await parseEventStreamResponse(response, callbacks),
      responseRetryMetadata
    );
  }

  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    return {
      error: getNonJsonErrorMessage(text, "Images API"),
      ...responseRetryMetadata,
    };
  }

  const data = (await response.json()) as ImageResponsePayload;
  const result = extractImageFromPayload(data);

  if (!result) {
    return withRetryMetadata(
      { error: getPayloadError(data) || "API returned no image data" },
      { ...responseRetryMetadata, ...extractPayloadRetryMetadata(data) }
    );
  }

  return withRetryMetadata(result, responseRetryMetadata);
}

async function getPlatformConfig(): Promise<ApiConfig> {
  const baseUrl = await getRuntimeSettingString("PLATFORM_API_BASE_URL");
  const apiKey = await getRuntimeSettingString("PLATFORM_API_KEY");
  if (!baseUrl || !apiKey) {
    throw new Error("Platform API configuration is missing");
  }
  return {
    baseUrl,
    apiKey,
    model:
      normalizeImageModel(
        await getRuntimeSettingString("PLATFORM_IMAGE_MODEL")
      ) || DEFAULT_IMAGE_MODEL,
  };
}

export async function getUserApiConfig(
  userId: string
): Promise<ApiConfig | null> {
  const plan = await getUserPlan(userId);
  if (!canUseCustomApi(plan.plan)) {
    return null;
  }

  const config = await db
    .select()
    .from(userApiConfig)
    .where(eq(userApiConfig.userId, userId))
    .limit(1);

  const row = config[0];
  if (!row?.isActive || !row.baseUrl || !row.apiKey) {
    return null;
  }

  const result: ApiConfig = { baseUrl: row.baseUrl, apiKey: row.apiKey };
  const normalizedModel = normalizeImageModel(row.model);
  if (normalizedModel) result.model = normalizedModel;
  if (row.useStream) result.useStream = true;
  result.contentSafetyEnabled = true;
  result.backend = { type: "user-api" };
  return result;
}

export async function getEffectiveConfig(
  userConfig: ApiConfig | null,
  options?: {
    userId?: string;
    apiKeyId?: string;
    requestKind?: ImageBackendRequestKind;
  }
): Promise<{
  config: ApiConfig;
  useCredits: boolean;
}> {
  if (userConfig) {
    return { config: userConfig, useCredits: false };
  }
  if (options?.userId && options.requestKind) {
    let poolConfig: Awaited<ReturnType<typeof resolveImageBackendPoolConfig>>;
    try {
      poolConfig = await resolveImageBackendPoolConfig({
        userId: options.userId,
        apiKeyId: options.apiKeyId,
        requestKind: options.requestKind,
      });
    } catch (error) {
      if (error instanceof ImageBackendPoolUnavailableError) {
        throw error;
      }
      throw error;
    }
    if (poolConfig) {
      return { config: poolConfig.config, useCredits: true };
    }
  }
  const platformConfig = await getPlatformConfig();
  return {
    config: {
      ...platformConfig,
      backend: { type: "platform", requestKind: options?.requestKind },
    },
    useCredits: true,
  };
}

export async function generateImage(
  config: ApiConfig,
  params: GenerateImageParams,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  if (config.backend?.reportResult) {
    return retryPoolBackendResult(config, (candidate) =>
      generateImage(candidate, params, callbacks)
    );
  }

  const model = getModel(config, params.model);
  if (isPoolAccountBackend(config, "web")) {
    return generateImageWithChatGptWeb(config, {
      ...params,
      model,
      gptModel: params.gptModel,
    });
  }
  if (isResponsesBackend(config)) {
    try {
      const response = await fetch(
        `${stripTrailingSlash(config.baseUrl)}/responses`,
        {
          method: "POST",
          headers: getHeaders(config, {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          }),
          body: JSON.stringify(
            buildResponsesImageGenerationRequest(config, {
              ...params,
              model,
              gptModel:
                params.gptModel ||
                (await getDefaultImageGptModel(config, {
                  allowGpt55: true,
                })),
            })
          ),
        }
      );
      return applyPromptOptimizationResultVisibility(
        await parseResponsesResponse(response, callbacks)
      );
    } catch (error) {
      logImageRequestError(error, {
        operation: "generate",
        baseUrl: config.baseUrl,
        path: "/responses",
        model,
        useStream: config.useStream,
      });
      return {
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  try {
    const prompt = getEffectivePrompt(params);
    const size = params.size || DEFAULT_IMAGE_SIZE;
    const dimensions = parseImageSize(size);
    const response = await fetch(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: getHeaders(config, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        model,
        prompt,
        n: params.n || 1,
        size,
        ...(dimensions
          ? { width: dimensions.width, height: dimensions.height }
          : {}),
        ...(normalizeQuality(params.quality)
          ? { quality: normalizeQuality(params.quality) }
          : {}),
        ...(normalizeModeration(params.moderation)
          ? { moderation: normalizeModeration(params.moderation) }
          : {}),
        ...(config.useStream ? { stream: true, partial_images: 2 } : {}),
        response_format: "b64_json",
      }),
    });

    return applyPromptOptimizationResultVisibility(
      await parseImageResponse(response, callbacks)
    );
  } catch (error) {
    logImageRequestError(error, {
      operation: "generate",
      baseUrl: config.baseUrl,
      path: "/images/generations",
      model,
      useStream: config.useStream,
    });
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

export async function editImage(
  config: ApiConfig,
  params: EditImageParams,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  if (config.backend?.reportResult) {
    return retryPoolBackendResult(config, (candidate) =>
      editImage(candidate, params, callbacks)
    );
  }

  const model = getModel(config, params.model);
  if (isPoolAccountBackend(config, "web")) {
    return editImageWithChatGptWeb(config, {
      ...params,
      model,
      gptModel: params.gptModel,
    });
  }
  if (isResponsesBackend(config)) {
    try {
      const response = await fetch(
        `${stripTrailingSlash(config.baseUrl)}/responses`,
        {
          method: "POST",
          headers: getHeaders(config, {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          }),
          body: JSON.stringify(
            buildResponsesImageEditRequest(config, {
              ...params,
              model,
              gptModel:
                params.gptModel ||
                (await getDefaultImageGptModel(config, {
                  allowGpt55: true,
                })),
            })
          ),
        }
      );
      return applyPromptOptimizationResultVisibility(
        await parseResponsesResponse(response, callbacks)
      );
    } catch (error) {
      logImageRequestError(error, {
        operation: "edit",
        baseUrl: config.baseUrl,
        path: "/responses",
        model,
        useStream: config.useStream,
      });
      return {
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  try {
    const prompt = getEffectivePrompt(params);
    const formData = new FormData();
    appendImageParams(formData, config, {
      prompt,
      model,
      n: params.n,
      size: params.size,
      quality: params.quality,
      moderation: params.moderation,
      promptOptimization: params.promptOptimization,
    });

    for (const image of params.images) {
      formData.append(
        params.images.length === 1 ? "image" : "image[]",
        new Blob([toBlobPart(image.data)], { type: image.type }),
        image.name
      );
    }

    if (params.mask) {
      formData.append(
        "mask",
        new Blob([toBlobPart(params.mask.data)], { type: params.mask.type }),
        params.mask.name
      );
    }

    const response = await fetch(`${config.baseUrl}/images/edits`, {
      method: "POST",
      headers: getHeaders(config, {}),
      body: formData,
    });

    return applyPromptOptimizationResultVisibility(
      await parseImageResponse(response, callbacks)
    );
  } catch (error) {
    logImageRequestError(error, {
      operation: "edit",
      baseUrl: config.baseUrl,
      path: "/images/edits",
      model,
      useStream: config.useStream,
    });
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

export async function generateChatImage(
  config: ApiConfig,
  params: ChatImageParams,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  if (config.backend?.reportResult) {
    return retryPoolBackendResult(config, (candidate) =>
      generateChatImage(candidate, params, callbacks)
    );
  }

  const model = await getResponsesModel(config, params.model, {
    allowGpt55: params.allowGpt55,
  });
  if (isPoolAccountBackend(config, "web")) {
    const webParams = {
      prompt: params.prompt,
      apiPrompt: params.apiPrompt,
      promptOptimization: params.promptOptimization,
      size: params.size,
      model: params.imageModel || DEFAULT_IMAGE_MODEL,
      gptModel: model,
      thinking: params.thinking,
      quality: params.quality,
      n: params.n,
      moderation: params.moderation,
    };
    if (params.images?.length) {
      return editImageWithChatGptWeb(config, {
        ...webParams,
        images: params.images,
      });
    }
    return generateImageWithChatGptWeb(config, webParams);
  }
  try {
    const prompt = getEffectivePrompt(params);
    const size = params.size || DEFAULT_IMAGE_SIZE;
    const input = buildResponsesInput(prompt, params.images, params.history);
    const instructions =
      params.promptOptimization === false
        ? ORIGINAL_PROMPT_RESPONSES_IMAGE_INSTRUCTIONS
        : DEFAULT_RESPONSES_IMAGE_INSTRUCTIONS;
    const tool: {
      type: "image_generation";
      action: "auto";
      model?: string;
      size?: string;
      quality?: ImageQuality;
      moderation?: ImageModeration;
    } = {
      type: "image_generation",
      action: "auto",
    };

    const toolModel = getImageModel(params.imageModel);
    if (toolModel) {
      tool.model = toolModel;
    }
    if (size && size !== "auto") {
      tool.size = size;
    }
    const quality = normalizeQuality(params.quality);
    if (quality) tool.quality = quality;
    const moderation = normalizeModeration(params.moderation);
    if (moderation) tool.moderation = moderation;

    const thinking = normalizeThinking(params.thinking);
    const reasoning: ReasoningConfig | undefined = thinking
      ? { effort: thinking, summary: "concise" }
      : undefined;

    const requestBody =
      params.rawResponsesBody && typeof params.rawResponsesBody === "object"
        ? {
            ...(params.rawResponsesBody as Record<string, unknown>),
            store: false,
            instructions:
              typeof (params.rawResponsesBody as Record<string, unknown>)
                .instructions === "string" &&
              (params.rawResponsesBody as Record<string, unknown>).instructions
                ? (params.rawResponsesBody as Record<string, unknown>)
                    .instructions
                : instructions,
            ...(params.stream || config.useStream ? { stream: true } : {}),
          }
        : {
            model,
            input,
            tools: [tool],
            instructions,
            store: false,
            ...(reasoning ? { reasoning } : {}),
            ...(params.stream || config.useStream ? { stream: true } : {}),
          };

    const response = await fetch(
      `${stripTrailingSlash(config.baseUrl)}/responses`,
      {
        method: "POST",
        headers: getHeaders(config, {
          "Content-Type": "application/json",
          Accept:
            params.stream || config.useStream
              ? "text/event-stream"
              : "application/json",
        }),
        body: JSON.stringify(requestBody),
      }
    );

    return applyPromptOptimizationResultVisibility(
      await parseResponsesResponse(response, callbacks)
    );
  } catch (error) {
    logImageRequestError(error, {
      operation: "chat",
      baseUrl: config.baseUrl,
      path: "/responses",
      model,
      useStream: config.useStream,
    });
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
