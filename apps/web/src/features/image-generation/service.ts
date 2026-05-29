import { db } from "@repo/database";
import { userApiConfig } from "@repo/database/schema";
import {
  GPT52_CHAT_MODEL,
  GPT54_CHAT_MODEL,
  GPT54_MINI_CHAT_MODEL,
  GPT55_CHAT_MODEL,
  RESPONSES_IMAGE_MODELS,
} from "@repo/shared/config/subscription-plan";
import { logError, logWarn } from "@repo/shared/logger";
import { canUsePlanCapability } from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import {
  getRuntimeSettingBoolean,
  getRuntimeSettingNumber,
  getRuntimeSettingString,
} from "@repo/shared/system-settings";
import { eq } from "drizzle-orm";
import {
  acquireImageBackendInflight,
  ImageBackendPoolUnavailableError,
  isImageBackendSwitchableError,
  releaseImageBackendInflight,
  reportImageBackendResult,
  resolveImageBackendPoolConfig,
} from "@/features/image-backend-pool/service";
import { imageBackendApiUsesResponsesEndpoint } from "@/features/image-backend-pool/api-interface-mode";
import type {
  ImageBackendAccountBackend,
  ImageBackendPreferenceMode,
  ImageBackendRequestKind,
} from "@/features/image-backend-pool/types";
import {
  DEFAULT_AGENT_IMAGE_ROUNDS,
  DEFAULT_RESPONSES_IMAGE_INSTRUCTIONS,
  ORIGINAL_PROMPT_RESPONSES_IMAGE_INSTRUCTIONS,
  AGENT_CONTINUE_INSTRUCTIONS,
  createDefaultAgentAdditionalTools,
} from "./agent-tools";
import {
  editImageWithChatGptWeb,
  generateImageWithChatGptWeb,
} from "./chatgpt-web";
import {
  normalizeImageBackground,
  normalizeOutputCompression,
  normalizeOutputFormat,
} from "./output-format";
import {
  AUTO_IMAGE_SIZE,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  getImageModel,
  isImageModel,
  normalizeImageModel,
  parseImageSize,
} from "./resolution";
import { getCodexRetryAfterSeconds } from "./retry-metadata";
import {
  buildResponsesImageEditRequest,
  buildResponsesImageGenerationRequest,
} from "./responses-image";
import { extractResponsesImageCallBase64 } from "./responses-output";
import {
  normalizeResponsesImageRequestBody,
  type ResponsesStreamRequestBody,
} from "./responses-request-normalizer";
import {
  buildAgentContinuationInput,
  buildContinueGenerationFunctionCallItems,
  buildCurrentResponsesContent,
  buildGeneratedImageReferenceInstruction,
  buildResponsesInput,
  buildPreviousResponseFallbackRequestBody,
  buildResponsesStoreFalseFallbackRequestBody,
  getContinueGenerationFunctionCalls,
  getNextAssistantImageRoundIndex,
  isPreviousResponseStateError,
  isResponsesStoreUnsupportedError,
  resolveResponsesNativeState,
  resolvePromptImageReferences,
  shouldEnableResponsesPreviousResponse,
  type ResponsesRequestInputItem,
  withResponsesImageReferenceInstructions,
} from "./responses-native-state";
import type {
  ApiConfig,
  ChatImageParams,
  EditImageParams,
  GenerateImageParams,
  GenerateImageResult,
  AgentRunEvent,
  AgentRunEventStatus,
  ImageInputFile,
  ImageGenerationCallbacks,
  ImageModeration,
  ImageOutputFormat,
  ImageQuality,
  PartialImageResult,
  ThinkingLevel,
} from "./types";
import { extractResponsesTokenUsage } from "./responses-usage";

const VALID_QUALITIES = new Set<ImageQuality>([
  "auto",
  "low",
  "medium",
  "high",
]);
const VALID_MODERATION = new Set<ImageModeration>(["auto", "low"]);
const DEFAULT_RESPONSES_MODEL = GPT54_CHAT_MODEL;
const DEFAULT_CHAT_RESPONSES_IMAGE_INSTRUCTIONS =
  "You are a multimodal chat assistant. Use image_generation when the user asks for an image, edit, or visual output. Keep replies concise and preserve the conversation context.";
const ORIGINAL_PROMPT_CHAT_RESPONSES_IMAGE_INSTRUCTIONS =
  "You are a multimodal chat assistant. When calling image_generation, use the user's original image prompt exactly as written. Do not rewrite, expand, translate, polish, or optimize the latest user prompt before image generation.";

type ImageOutput = {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
  index?: number;
};

type ImageResponsePayload = {
  type?: string;
  data?: ImageOutput[];
  b64_json?: string;
  partial_image_b64?: string;
  url?: string;
  revised_prompt?: string;
  index?: number;
  partial_image_index?: number;
  error?: { message?: string } | string;
  message?: string;
};

type ResponsesOutputItem = {
  type?: string;
  id?: string;
  item_id?: string;
  output_item_id?: string;
  status?: string;
  role?: string;
  name?: string;
  action?: unknown;
  arguments?: string;
  call_id?: string;
  query?: string;
  results?: unknown;
  result?:
    | string
    | {
        b64_json?: unknown;
        base64?: unknown;
        image?: unknown;
        data?: unknown;
      };
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
  id?: string;
  output?: ResponsesOutputItem[];
  error?: { message?: string } | string;
  message?: string;
  usage?: unknown;
};

type ResponsesResultWithOutput = GenerateImageResult & {
  responseId?: string;
  outputItems?: ResponsesOutputItem[];
  responsesStoreDisabledFallback?: boolean;
};

type ReasoningConfig = {
  effort: ThinkingLevel;
  summary?: "concise";
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

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

function isPoolApiResponsesBackend(config: ApiConfig) {
  return (
    config.backend?.type === "pool-api" &&
    imageBackendApiUsesResponsesEndpoint(
      config.backend.apiInterfaceMode,
      config.backend.requestKind,
      config.backend.apiForceResponsesEndpoint
    )
  );
}

export async function getResponsesModel(
  config: ApiConfig,
  model?: string,
  options?: { allowGpt55?: boolean }
) {
  const requested = model?.trim();
  const poolApiResponsesBackend = isPoolApiResponsesBackend(config);
  if (requested) {
    if (poolApiResponsesBackend) {
      if (!isImageModel(requested)) return requested;
      const configured = config.model?.trim();
      if (configured && !isImageModel(configured)) return configured;
    } else {
      const normalized = normalizeResponsesModel(requested, options, true);
      if (normalized) return normalized;
    }
  }

  const configured = config.model?.trim();
  if (
    configured &&
    poolApiResponsesBackend &&
    !isImageModel(configured)
  ) {
    return configured;
  }

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
  if (
    config.backend?.type !== "pool-account" &&
    !isPoolApiResponsesBackend(config)
  ) {
    return undefined;
  }
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

function withRetryMetadata<T extends GenerateImageResult>(
  result: T,
  metadata: { upstreamResetAt?: string; retryAfterSeconds?: number }
): T {
  if (!metadata.upstreamResetAt && !metadata.retryAfterSeconds) return result;
  return {
    ...result,
    upstreamResetAt: result.upstreamResetAt || metadata.upstreamResetAt,
    retryAfterSeconds: result.retryAfterSeconds ?? metadata.retryAfterSeconds,
  } as T;
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
  apiName: "Images API" | "Responses API",
  response?: Response
) {
  const trimmedBody = truncateResponseBody(rawBody);
  const statusText = response
    ? `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`
    : null;
  const contentType = response?.headers.get("content-type") || "";
  const context = [statusText, contentType ? `content-type=${contentType}` : ""]
    .filter(Boolean)
    .join(", ");
  const suffix = context ? ` (${context})` : "";
  if (trimmedBody.startsWith("<")) {
    return `API returned an HTML page instead of a ${apiName} response${suffix}. Check that the API base URL points to an OpenAI-compatible /v1 endpoint.`;
  }
  if (!trimmedBody)
    return `API returned an empty non-JSON ${apiName} response${suffix}.`;
  return `API returned a non-JSON ${apiName} response${suffix}: ${trimmedBody}`;
}

function looksLikeEventStreamText(text: string) {
  return /(?:^|\n)(?:event|data):/.test(text.replace(/\r\n/g, "\n"));
}

function tryParseJsonPayloadError(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }
  return getPayloadError(safeParseJson(trimmed));
}

function withStreamJsonErrorFallback<T extends { error?: string }>(
  result: T,
  rawText: string
): T {
  if (result.error !== "API returned no image data") return result;
  const jsonError = tryParseJsonPayloadError(rawText);
  return jsonError ? ({ ...result, error: jsonError } as T) : result;
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
    thinking === "minimal" ||
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
  if (isPoolAccountBackend(config, "responses")) return true;
  return isPoolApiResponsesBackend(config);
}

function isResponsesImageToolChoiceMismatch(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    Boolean(normalized) &&
    (normalized.includes("tool_choice") ||
      normalized.includes("tool choice")) &&
    normalized.includes("image_generation") &&
    normalized.includes("not found")
  );
}

async function postResponsesImageRequest(
  config: ApiConfig,
  requestBody: unknown,
  params: {
    signal?: AbortSignal;
  },
  callbacks?: ImageGenerationCallbacks
) {
  const response = await fetch(
    `${stripTrailingSlash(config.baseUrl)}/responses`,
    {
      method: "POST",
      signal: params.signal,
      cache: "no-store",
      headers: getHeaders(config, {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
      }),
      body: JSON.stringify(requestBody),
    }
  );
  return await parseResponsesResponse(response, callbacks, {
    preferEventStream: true,
  });
}

async function postResponsesImageRequestWithToolChoiceFallback(
  config: ApiConfig,
  requestBody: Record<string, unknown>,
  params: {
    signal?: AbortSignal;
  },
  callbacks?: ImageGenerationCallbacks
) {
  const result = await postResponsesImageRequest(
    config,
    requestBody,
    params,
    callbacks
  );
  if (!isResponsesImageToolChoiceMismatch(result.error)) {
    return result;
  }

  const fallbackBody = { ...requestBody };
  delete fallbackBody.tool_choice;
  return await postResponsesImageRequest(
    config,
    fallbackBody,
    params,
    callbacks
  );
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
    return outcome.switchable;
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

function getStickyBackendMember(config: ApiConfig) {
  const backend = config.backend;
  if (
    !backend?.id ||
    (backend.type !== "pool-api" && backend.type !== "pool-account")
  ) {
    return undefined;
  }
  return {
    type: backend.type === "pool-api" ? ("api" as const) : ("account" as const),
    id: backend.id,
    groupId: backend.groupId,
    accountBackend: backend.accountBackend,
  };
}

function attachStickyBackendMember(
  config: ApiConfig,
  result: GenerateImageResult
): GenerateImageResult {
  if (result.error) return result;
  const backendMember = getStickyBackendMember(config);
  if (!backendMember) return result;
  return {
    ...result,
    backendMember,
  };
}

function attachResponsesPreviousResponseState(
  config: ApiConfig,
  result: ResponsesResultWithOutput,
  enabled: boolean
): ResponsesResultWithOutput {
  const { responsesStoreDisabledFallback, ...publicResult } = result;
  if (
    !enabled ||
    responsesStoreDisabledFallback ||
    publicResult.error ||
    !publicResult.responseId
  ) {
    return publicResult;
  }
  const backendMember = getStickyBackendMember(config);
  if (!backendMember || backendMember.accountBackend !== "responses") {
    return publicResult;
  }
  return {
    ...publicResult,
    responsesPreviousResponse: {
      responseId: publicResult.responseId,
      backendMember,
      store: true,
      createdAt: new Date().toISOString(),
    },
  };
}

async function fetchResponsesWithPreviousResponseFallback(
  config: ApiConfig,
  requestBody: ResponsesStreamRequestBody,
  fallbackInput: ResponsesRequestInputItem[],
  options: {
    signal?: AbortSignal;
    stream: boolean;
    previousResponseUsed: boolean;
  },
  callbacks?: ImageGenerationCallbacks
) {
  const result = await fetchResponses(
    config,
    requestBody,
    {
      signal: options.signal,
      stream: options.stream,
    },
    callbacks
  );
  if (result.error && isResponsesStoreUnsupportedError(result.error)) {
    const fallbackResult = await fetchResponses(
      config,
      {
        ...buildResponsesStoreFalseFallbackRequestBody(requestBody),
        input: fallbackInput,
      },
      {
        signal: options.signal,
        stream: options.stream,
      },
      callbacks
    );
    return {
      ...fallbackResult,
      responsesStoreDisabledFallback: true,
    };
  }
  if (
    !options.previousResponseUsed ||
    !result.error ||
    !isPreviousResponseStateError(result.error)
  ) {
    return result;
  }
  const previousResponseFallbackBody = buildPreviousResponseFallbackRequestBody(
    requestBody,
    fallbackInput
  );
  const previousResponseFallbackResult = await fetchResponses(
    config,
    previousResponseFallbackBody,
    {
      signal: options.signal,
      stream: options.stream,
    },
    callbacks
  );
  if (
    previousResponseFallbackResult.error &&
    isResponsesStoreUnsupportedError(previousResponseFallbackResult.error)
  ) {
    const storeFalseResult = await fetchResponses(
      config,
      buildResponsesStoreFalseFallbackRequestBody(previousResponseFallbackBody),
      {
        signal: options.signal,
        stream: options.stream,
      },
      callbacks
    );
    return {
      ...storeFalseResult,
      responsesStoreDisabledFallback: true,
    };
  }
  return previousResponseFallbackResult;
}

async function retryPoolBackendResult(
  config: ApiConfig,
  run: (candidate: ApiConfig) => Promise<GenerateImageResult>,
  options?: {
    mixWebFirst?: boolean;
    accountBackendPreference?: ImageBackendAccountBackend;
    accountBackendPreferenceMode?: ImageBackendPreferenceMode;
  }
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
  let accountBackendPreference: ImageBackendAccountBackend | undefined =
    options?.accountBackendPreference ||
    (options?.mixWebFirst ? "web" : undefined);
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
      !(shouldRetry || isImageBackendSwitchableError(result.error))
    ) {
      return attachStickyBackendMember(candidate, result);
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
        accountBackendPreference,
        accountBackendPreferenceMode: options?.accountBackendPreferenceMode,
      });
    } catch (error) {
      if (error instanceof ImageBackendPoolUnavailableError) {
        if (
          accountBackendPreference === "web" &&
          !options?.accountBackendPreference
        ) {
          logWarn("混合分组 1K Web 优先阶段已无可用账号，切换 Codex", {
            attempt,
            requestKind,
            excludedCount: excluded.size,
            lastError: result.error,
          });
          accountBackendPreference = "responses";
          try {
            next = await resolveImageBackendPoolConfig({
              userId: config.backend.userId,
              apiKeyId: config.backend.apiKeyId,
              requestKind,
              excludedMemberKeys: Array.from(excluded),
              accountBackendPreference,
              accountBackendPreferenceMode:
                options?.accountBackendPreferenceMode,
            });
          } catch (fallbackError) {
            if (fallbackError instanceof ImageBackendPoolUnavailableError) {
              logWarn("生图后端没有可切换的账号池成员", {
                attempt,
                requestKind,
                excludedCount: excluded.size,
                lastError: result.error,
              });
              break;
            }
            throw fallbackError;
          }
        } else {
          logWarn("生图后端没有可切换的账号池成员", {
            attempt,
            requestKind,
            excludedCount: excluded.size,
            lastError: result.error,
          });
          break;
        }
      } else {
        throw error;
      }
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

  if (lastResult) return lastResult;
  return attachStickyBackendMember(
    config,
    await run(withoutPoolBackendReport(config))
  );
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

type ChatCompletionImageItem = {
  url?: unknown;
  b64_json?: unknown;
  revised_prompt?: unknown;
  generation_id?: unknown;
  generationId?: unknown;
};

function imageInputToDataUrl(image: ImageInputFile) {
  if (image.url) return image.url;
  return `data:${image.type || "image/png"};base64,${image.data.toString(
    "base64"
  )}`;
}

function buildChatCompletionContent(text?: string, images?: ImageInputFile[]) {
  const parts: Array<Record<string, unknown>> = [];
  if (text?.trim()) {
    parts.push({ type: "text", text: text.trim() });
  }
  for (const image of images || []) {
    parts.push({
      type: "image_url",
      image_url: { url: imageInputToDataUrl(image) },
    });
  }
  if (parts.length === 1 && parts[0]?.type === "text") {
    return parts[0].text as string;
  }
  return parts;
}

function buildChatCompletionsMessages(params: ChatImageParams) {
  const messages: Array<Record<string, unknown>> = [];
  if (params.apiPrompt?.trim()) {
    messages.push({ role: "system", content: params.apiPrompt.trim() });
  }
  for (const item of params.history || []) {
    const historyImages = (item.imageUrls || []).map((url, index) => ({
      data: Buffer.alloc(0),
      name: `history-image-${index + 1}.png`,
      type: "image/png",
      url,
    }));
    messages.push({
      role: item.role,
      content: buildChatCompletionContent(item.text, historyImages),
    });
  }
  messages.push({
    role: "user",
    content: buildChatCompletionContent(getEffectivePrompt(params), params.images),
  });
  return messages;
}

function extractChatCompletionText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      isPlainRecord(part) && typeof part.text === "string" ? part.text : ""
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractChatCompletionImages(payload: unknown): ChatCompletionImageItem[] {
  const images: ChatCompletionImageItem[] = [];
  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (isPlainRecord(item) && (item.url || item.b64_json)) {
        images.push(item);
      }
    }
  };

  if (isPlainRecord(payload)) {
    collect(payload.images);
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const choice of choices) {
      if (!isPlainRecord(choice)) continue;
      collect(choice.images);
      if (isPlainRecord(choice.message)) collect(choice.message.images);
    }
  }
  return images;
}

function chatCompletionPayloadToResult(
  payload: Record<string, unknown>
): GenerateImageResult {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices.find(isPlainRecord);
  const message = isPlainRecord(firstChoice?.message)
    ? firstChoice.message
    : undefined;
  const text = extractChatCompletionText(message?.content);
  const images = extractChatCompletionImages(payload);
  const imageOutputs = images.map((image, index) => ({
    imageBase64:
      typeof image.b64_json === "string" ? image.b64_json : undefined,
    imageUrl: typeof image.url === "string" ? image.url : undefined,
    revisedPrompt:
      typeof image.revised_prompt === "string" ? image.revised_prompt : undefined,
    generationId:
      typeof image.generation_id === "string"
        ? image.generation_id
        : typeof image.generationId === "string"
          ? image.generationId
          : undefined,
    index,
  }));
  const firstImage = imageOutputs.find((item) => item.imageBase64 || item.imageUrl);

  return {
    responseText: text || undefined,
    model: typeof payload.model === "string" ? payload.model : undefined,
    imageBase64: firstImage?.imageBase64,
    imageUrl: firstImage?.imageUrl,
    revisedPrompt: firstImage?.revisedPrompt,
    imageOutputs: imageOutputs.length ? imageOutputs : undefined,
    imageOutputCount: imageOutputs.length || undefined,
    generationId: firstImage?.generationId,
  };
}

async function parseChatCompletionsResponse(
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

  const parseSseText = async (text: string) => {
    let responseText = "";
    let finalPayload: Record<string, unknown> | null = null;
    const parseBlock = async (block: string) => {
      const dataLines = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
      if (!dataLines.length) return null;
      const data = dataLines.join("\n").trim();
      if (!data || data === "[DONE]") return null;
      const payload = safeParseJson(data);
      if (!isPlainRecord(payload)) return null;
      const apiError = getPayloadError(payload);
      if (apiError) return apiError;
      finalPayload = payload;
      const choices = Array.isArray(payload.choices) ? payload.choices : [];
      const choice = choices.find(isPlainRecord);
      const delta = isPlainRecord(choice?.delta) ? choice.delta : undefined;
      const deltaText = extractChatCompletionText(delta?.content);
      if (deltaText) {
        responseText += deltaText;
        await callbacks?.onTextDelta?.(deltaText);
      }
      return null;
    };

    for (const block of text.replace(/\r\n/g, "\n").split("\n\n")) {
      const error = await parseBlock(block);
      if (error) return { error, ...responseRetryMetadata };
    }
    if (finalPayload) {
      const result = chatCompletionPayloadToResult(finalPayload);
      return {
        ...result,
        responseText: result.responseText || responseText || undefined,
        ...responseRetryMetadata,
      };
    }
    const jsonError = tryParseJsonPayloadError(text);
    return {
      error: jsonError || "API returned no image data",
      ...responseRetryMetadata,
    };
  };

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream") && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let rawText = "";
    let buffer = "";
    let responseText = "";
    let finalPayload: Record<string, unknown> | null = null;
    while (true) {
      const { value, done } = await reader.read();
      const chunk = decoder.decode(value, { stream: !done });
      rawText += chunk;
      buffer += chunk;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const dataLines = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());
        if (!dataLines.length) continue;
        const data = dataLines.join("\n").trim();
        if (!data || data === "[DONE]") continue;
        const payload = safeParseJson(data);
        if (!isPlainRecord(payload)) continue;
        const apiError = getPayloadError(payload);
        if (apiError) {
          await reader.cancel().catch(() => undefined);
          return { error: apiError, ...responseRetryMetadata };
        }
        finalPayload = payload;
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const choice = choices.find(isPlainRecord);
        const delta = isPlainRecord(choice?.delta) ? choice.delta : undefined;
        const deltaText = extractChatCompletionText(delta?.content);
        if (deltaText) {
          responseText += deltaText;
          await callbacks?.onTextDelta?.(deltaText);
        }
      }
      if (done) break;
    }
    if (buffer.trim()) {
      return await parseSseText(`${rawText}\n\n${buffer}`);
    }
    if (finalPayload) {
      const result = chatCompletionPayloadToResult(finalPayload);
      return {
        ...result,
        responseText: result.responseText || responseText || undefined,
        ...responseRetryMetadata,
      };
    }
    const jsonError = tryParseJsonPayloadError(rawText);
    return {
      error: jsonError || "API returned no image data",
      ...responseRetryMetadata,
    };
  }

  const text = await response.text().catch(() => "");
  if (looksLikeEventStreamText(text)) {
    return await parseSseText(text);
  }

  const payload = safeParseJson(text);
  if (!isPlainRecord(payload)) {
    return {
      error: getNonJsonErrorMessage(text, "Responses API", response),
      ...responseRetryMetadata,
    };
  }
  const apiError = getPayloadError(payload);
  if (apiError) return { error: apiError, ...responseRetryMetadata };
  return { ...chatCompletionPayloadToResult(payload), ...responseRetryMetadata };
}

async function generateChatImageWithChatCompletions(
  config: ApiConfig,
  params: ChatImageParams,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  const model = params.model || config.model || GPT54_CHAT_MODEL;
  const stream = Boolean(params.stream || config.useStream);
  const rawBody =
    params.rawChatCompletionsBody && isPlainRecord(params.rawChatCompletionsBody)
      ? params.rawChatCompletionsBody
      : null;
  const body = {
    ...(rawBody || {}),
    model,
    messages: rawBody?.messages || buildChatCompletionsMessages(params),
    ...(stream ? { stream: true } : {}),
  };
  delete (body as Record<string, unknown>).size;
  delete (body as Record<string, unknown>).quality;
  delete (body as Record<string, unknown>).moderation;
  delete (body as Record<string, unknown>).output_format;
  delete (body as Record<string, unknown>).output_compression;

  try {
    const response = await fetch(`${stripTrailingSlash(config.baseUrl)}/chat/completions`, {
      method: "POST",
      signal: params.signal,
      cache: stream ? "no-store" : "default",
      headers: getHeaders(config, {
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
        ...(stream
          ? {
              "Accept-Encoding": "identity",
              "Cache-Control": "no-cache",
            }
          : {}),
      }),
      body: JSON.stringify(body),
    });
    return await parseChatCompletionsResponse(response, callbacks);
  } catch (error) {
    logImageRequestError(error, {
      operation: "chat",
      baseUrl: config.baseUrl,
      path: "/chat/completions",
      model,
      useStream: stream,
    });
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

function stripToolTypes(
  body: ResponsesStreamRequestBody,
  blockedTypes: Set<string>
) {
  const tools = Array.isArray(body.tools)
    ? body.tools.filter(
        (tool) =>
          !(
            isPlainRecord(tool) &&
            typeof tool.type === "string" &&
            (blockedTypes.has(tool.type) ||
              (tool.type === "function" &&
                typeof tool.name === "string" &&
                blockedTypes.has(tool.name)))
          )
      )
    : body.tools;
  return {
    ...body,
    tools,
  };
}

async function fetchAgentResponsesAttempt(params: {
  config: ApiConfig;
  requestBody: ResponsesStreamRequestBody;
  signal?: AbortSignal;
  stream: boolean;
  callbacks?: ImageGenerationCallbacks;
  storeFalseFallbackInput?: ResponsesRequestInputItem[];
  onStoreDisabledFallback?: () => void;
}) {
  let requestBody = params.requestBody;
  let result = await fetchResponses(
    params.config,
    requestBody,
    {
      signal: params.signal,
      stream: params.stream,
    },
    params.callbacks
  );

  if (
    requestBody.store !== false &&
    result.error &&
    isResponsesStoreUnsupportedError(result.error)
  ) {
    requestBody = {
      ...buildResponsesStoreFalseFallbackRequestBody(requestBody),
      ...(params.storeFalseFallbackInput
        ? { input: params.storeFalseFallbackInput }
        : {}),
    };
    params.onStoreDisabledFallback?.();
    await emitAgentDecision(params.callbacks, {
      status: "completed",
      title: "Agent 上下文重试",
      detail: "上游要求关闭 Responses store，已改用手动历史重试",
    });
    result = await fetchResponses(
      params.config,
      requestBody,
      {
        signal: params.signal,
        stream: params.stream,
      },
      params.callbacks
    );
    result = {
      ...result,
      responsesStoreDisabledFallback: true,
    };
  }

  return { requestBody, result };
}

async function fetchAgentRoundResponses(params: {
  config: ApiConfig;
  requestBody: ResponsesStreamRequestBody;
  signal?: AbortSignal;
  stream: boolean;
  callbacks?: ImageGenerationCallbacks;
  storeFalseFallbackInput?: ResponsesRequestInputItem[];
  onStoreDisabledFallback?: () => void;
}) {
  let { requestBody, result } = await fetchAgentResponsesAttempt(params);

  const unsupportedTools = getUnsupportedToolTypes(result);
  if (unsupportedTools.size > 0) {
    await emitAgentProgress(params.callbacks, {
      kind: "tool",
      status: "completed",
      title: "工具兼容性调整",
      detail: `已移除 ${Array.from(unsupportedTools).join(", ")} 后重试`,
      timestamp: new Date().toISOString(),
      toolType: "agent_tool_compat",
    });
    ({ requestBody, result } = await fetchAgentResponsesAttempt({
      ...params,
      requestBody: stripToolTypes(requestBody, unsupportedTools),
    }));

    const secondUnsupportedTools = getUnsupportedToolTypes(result);
    if (secondUnsupportedTools.size > 0) {
      await emitAgentProgress(params.callbacks, {
        kind: "tool",
        status: "completed",
        title: "工具兼容性调整",
        detail: "扩展工具仍不可用，已切换为仅保留图片生成工具重试",
        timestamp: new Date().toISOString(),
        toolType: "agent_tool_compat",
      });
      ({ result } = await fetchAgentResponsesAttempt({
        ...params,
        requestBody: stripToolTypes(
          requestBody,
          new Set(["web_search", "code_interpreter", "function"])
        ),
      }));
    }
  }

  return result;
}

function shouldRetryAgentRoundWithManualHistory(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return Boolean(
    normalized &&
      (isPreviousResponseStateError(error || undefined) ||
        isResponsesStoreUnsupportedError(error || undefined) ||
        normalized.includes("empty non-json") ||
        normalized.includes("empty response") ||
        normalized.includes("http 200 ok"))
  );
}

function getUnsupportedToolTypes(result: GenerateImageResult) {
  if (!result.error) return new Set<string>();
  const message = result.error.toLowerCase();
  const looksUnsupported =
    message.includes("unsupported") ||
    message.includes("not supported") ||
    message.includes("invalid") ||
    message.includes("unknown") ||
    message.includes("unrecognized") ||
    message.includes("not available");
  if (!looksUnsupported) return new Set<string>();
  const types = new Set<string>();
  if (message.includes("web_search")) types.add("web_search");
  if (message.includes("code_interpreter")) types.add("code_interpreter");
  if (message.includes("function") || message.includes("continue_generation")) {
    types.add("function");
  }
  return types;
}

function hasAgentImage(result: GenerateImageResult) {
  return Boolean(
    result.imageBase64 ||
      result.imageUrl ||
      result.imageOutputs?.some((item) => item.imageBase64 || item.imageUrl)
  );
}

async function getAgentMaxRounds() {
  return Math.max(
    1,
    Math.min(
      8,
      Math.floor(
        await getRuntimeSettingNumber(
          "IMAGE_AGENT_MAX_ROUNDS",
          DEFAULT_AGENT_IMAGE_ROUNDS,
          { positive: true }
        )
      )
    )
  );
}

function normalizeAgentMaxRounds(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(1, Math.min(8, Math.floor(numeric)));
}

async function getAgentForceMaxRounds() {
  return await getRuntimeSettingBoolean("IMAGE_AGENT_FORCE_MAX_ROUNDS", false);
}

async function fetchResponses(
  config: ApiConfig,
  requestBody: ResponsesStreamRequestBody,
  options: {
    signal?: AbortSignal;
    stream: boolean;
  },
  callbacks?: ImageGenerationCallbacks
): Promise<ResponsesResultWithOutput> {
  const response = await fetch(
    `${stripTrailingSlash(config.baseUrl)}/responses`,
    {
      method: "POST",
      signal: options.signal,
      cache: options.stream ? "no-store" : "default",
      headers: getHeaders(config, {
        "Content-Type": "application/json",
        Accept: options.stream ? "text/event-stream" : "application/json",
        ...(options.stream
          ? {
              "Accept-Encoding": "identity",
              "Cache-Control": "no-cache",
            }
          : {}),
      }),
      body: JSON.stringify(requestBody),
    }
  );

  return await parseResponsesResponse(response, callbacks, {
    preferEventStream: options.stream,
  });
}

function getEffectivePrompt(params: {
  prompt: string;
  apiPrompt?: string;
  fileContext?: string;
  promptOptimization?: boolean;
}) {
  const prompt =
    params.promptOptimization === false
      ? params.prompt
      : params.apiPrompt || params.prompt;
  return params.fileContext ? `${prompt}\n\n${params.fileContext}` : prompt;
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
    outputFormat?: ImageOutputFormat;
    outputCompression?: number;
    background?: string;
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

  const outputFormat = normalizeOutputFormat(params.outputFormat);
  if (outputFormat) {
    formData.append("output_format", outputFormat);
  }

  const outputCompression = normalizeOutputCompression(
    params.outputCompression
  );
  if (outputCompression !== undefined) {
    formData.append("output_compression", String(outputCompression));
  }

  const background = normalizeImageBackground(params.background);
  if (background) {
    formData.append("background", background);
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
  if (image.b64_json || image.url) result.imageOutputCount = 1;
  if (image.revised_prompt) {
    result.upstreamRevisedPrompt = image.revised_prompt;
  }
  if (image.b64_json || image.url) {
    result.imageOutputs = [
      {
        imageBase64: image.b64_json,
        imageUrl: image.url,
        upstreamRevisedPrompt: image.revised_prompt,
        index: typeof image.index === "number" ? image.index : 0,
      },
    ];
  }
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
  const imageBase64 = payload.b64_json || payload.partial_image_b64;
  if (!imageBase64 && !payload.url) {
    return null;
  }

  const result: PartialImageResult = {};
  if (imageBase64) result.imageBase64 = imageBase64;
  if (payload.url) result.imageUrl = payload.url;
  if (typeof payload.index === "number") result.index = payload.index;
  if (typeof payload.partial_image_index === "number") {
    result.partialImageIndex = payload.partial_image_index;
  }
  return result;
}

function parseResponsesOutput(
  output: ResponsesOutputItem[] | undefined
): ResponsesResultWithOutput | null {
  let imageBase64: string | undefined;
  let revisedPrompt: string | undefined;
  let responseText: string | undefined;
  let responseThinking: string | undefined;
  let responseAgent: string | undefined;
  const agentEvents: AgentRunEvent[] = [];
  let imageOutputCount = 0;
  const imageOutputs: NonNullable<GenerateImageResult["imageOutputs"]> = [];

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

    const itemImageBase64 = extractResponsesImageCallBase64(item);
    if (item.type === "image_generation_call" && itemImageBase64) {
      imageBase64 = itemImageBase64;
      imageOutputCount += 1;
      if (item.revised_prompt) revisedPrompt = item.revised_prompt;
      imageOutputs.push({
        imageBase64: itemImageBase64,
        upstreamRevisedPrompt: item.revised_prompt,
        index: imageOutputCount - 1,
      });
      const event = toAgentRunEvent(item, { done: true });
      if (event) {
        event.title = "最终图片已生成";
        event.index = imageOutputCount - 1;
        event.partialImageIndex = imageOutputCount - 1;
        agentEvents.push(event);
      }
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

    const agentLine = describeResponsesToolItem(item, { done: true });
    if (agentLine) {
      responseAgent = responseAgent
        ? `${responseAgent}\n${agentLine}`
        : agentLine;
      const event = toAgentRunEvent(item, { done: true });
      if (event) agentEvents.push(event);
    }
  }

  if (!imageBase64 && !responseText && !responseThinking) return null;

  return {
    imageBase64,
    imageOutputs: imageOutputs.length ? imageOutputs : undefined,
    imageOutputCount: imageOutputCount || undefined,
    upstreamRevisedPrompt: revisedPrompt,
    responseText,
    responseThinking,
    responseAgent,
    agentEvents: agentEvents.length ? agentEvents : undefined,
    outputItems: output,
  };
}

function compactToolText(value: unknown, maxLength = 140) {
  if (typeof value !== "string") return undefined;
  const compacted = value.replace(/\s+/g, " ").trim();
  if (!compacted) return undefined;
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength - 3)}...`
    : compacted;
}

function compactToolJson(value: unknown, maxLength = 140) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return compactToolText(value, maxLength);
  try {
    return compactToolText(JSON.stringify(value), maxLength);
  } catch {
    return undefined;
  }
}

function describeWebSearchAction(action: unknown) {
  if (!isPlainRecord(action)) return undefined;
  const type = typeof action.type === "string" ? action.type : "";
  if (type === "search" && Array.isArray(action.queries)) {
    const queries = action.queries
      .filter((item): item is string => typeof item === "string")
      .slice(0, 2)
      .join("; ");
    return compactToolText(queries);
  }
  if (type === "open_page" && typeof action.url === "string") {
    return compactToolText(action.url);
  }
  return compactToolJson(action);
}

function describeResponsesToolItem(
  item: ResponsesOutputItem | undefined,
  options: { done?: boolean } = {}
) {
  if (!item?.type) return null;

  if (item.type === "image_generation_call") {
    return options.done
      ? `图片生成: ${item.status || (item.result ? "completed" : "finished")}`
      : "图片生成: started";
  }

  if (item.type === "web_search_call") {
    const detail =
      compactToolText(item.query) || describeWebSearchAction(item.action);
    const suffix = detail
      ? ` - ${detail}`
      : item.status
        ? ` - ${item.status}`
        : "";
    return `${options.done ? "联网搜索完成" : "联网搜索"}${suffix}`;
  }

  if (item.type === "function_call") {
    const name = item.name ? ` ${item.name}` : "";
    const args = compactToolText(item.arguments);
    return `调用工具${name}${args ? ` - ${args}` : ""}`;
  }

  if (item.type.endsWith("_call")) {
    const detail =
      compactToolText(item.query) ||
      compactToolText(item.name) ||
      compactToolJson(item.action) ||
      item.status;
    return `${options.done ? "工具完成" : "运行工具"}: ${item.type}${
      detail ? ` - ${detail}` : ""
    }`;
  }

  return null;
}

function getToolEventKind(item: ResponsesOutputItem): AgentRunEvent["kind"] {
  if (item.type === "web_search_call") return "web_search";
  if (item.type === "code_interpreter_call") return "code_interpreter";
  if (item.type === "image_generation_call") return "image_generation";
  return "tool";
}

function getToolEventTitle(
  item: ResponsesOutputItem,
  options: { done?: boolean; partial?: boolean } = {}
) {
  if (options.partial) return "中间图已生成";
  if (item.type === "web_search_call") {
    return options.done ? "联网搜索完成" : "联网搜索";
  }
  if (item.type === "code_interpreter_call") {
    return options.done ? "代码/文件分析完成" : "代码/文件分析";
  }
  if (item.type === "image_generation_call") {
    return options.done ? "图片生成完成" : "图片生成";
  }
  if (item.type === "function_call") {
    return item.name
      ? `${options.done ? "工具调用完成" : "调用工具"}: ${item.name}`
      : options.done
        ? "工具调用完成"
        : "调用工具";
  }
  return options.done ? "工具完成" : "运行工具";
}

function getToolEventDetail(item: ResponsesOutputItem) {
  if (item.type === "web_search_call") {
    return compactToolText(item.query) || describeWebSearchAction(item.action);
  }
  if (item.type === "function_call") {
    return compactToolText(item.arguments);
  }
  return (
    compactToolText(item.query) ||
    compactToolText(item.name) ||
    compactToolJson(item.action) ||
    item.status
  );
}

function toAgentRunEvent(
  item: ResponsesOutputItem | undefined,
  options: { done?: boolean } = {}
): AgentRunEvent | null {
  if (!item?.type) return null;
  if (item.type === "message" || item.type === "reasoning") return null;
  return {
    id: item.id || item.call_id,
    kind: getToolEventKind(item),
    status: options.done ? "completed" : "started",
    title: getToolEventTitle(item, options),
    detail: getToolEventDetail(item),
    timestamp: new Date().toISOString(),
    toolType: item.type,
  };
}

function getAgentEventKey(event: AgentRunEvent) {
  if (event.id) return `id:${event.id}`;
  if (event.kind === "image_partial") {
    return [
      event.kind,
      event.toolType || "",
      event.partialImageIndex ?? "",
      event.index ?? "",
    ].join("|");
  }
  return [
    event.kind,
    event.toolType || "",
    event.partialImageIndex ?? "",
    event.index ?? "",
    event.title,
  ].join("|");
}

function getResponseItemId(item: ResponsesOutputItem | undefined) {
  return item?.id || item?.call_id || item?.item_id || item?.output_item_id;
}

function getToolEventSignature(item: ResponsesOutputItem | undefined) {
  if (!item?.type) return "";
  return [
    item.type,
    compactToolText(item.query),
    compactToolText(item.name),
    compactToolText(item.arguments),
    compactToolJson(item.action),
    item.status,
  ].join("|");
}

function inferToolStatusFromEventName(eventName: string): AgentRunEventStatus {
  if (
    eventName.endsWith(".done") ||
    eventName.endsWith(".completed") ||
    eventName.endsWith(".succeeded")
  ) {
    return "completed";
  }
  if (eventName.endsWith(".failed") || eventName.endsWith(".error")) {
    return "failed";
  }
  if (
    eventName.endsWith(".in_progress") ||
    eventName.endsWith(".searching") ||
    eventName.endsWith(".delta")
  ) {
    return "running";
  }
  if (eventName.endsWith(".added") || eventName.endsWith(".created")) {
    return "started";
  }
  return "running";
}

function mergeResponseOutputItem(
  previous: ResponsesOutputItem | undefined,
  next: ResponsesOutputItem
): ResponsesOutputItem {
  return {
    ...(previous || {}),
    ...next,
    id: next.id ?? previous?.id,
    call_id: next.call_id ?? previous?.call_id,
    item_id: next.item_id ?? previous?.item_id,
    output_item_id: next.output_item_id ?? previous?.output_item_id,
    action: next.action ?? previous?.action,
    arguments:
      typeof previous?.arguments === "string" ||
      typeof next.arguments === "string"
        ? `${previous?.arguments || ""}${next.arguments || ""}`
        : undefined,
    query: next.query ?? previous?.query,
    results: next.results ?? previous?.results,
    result: next.result ?? previous?.result,
    revised_prompt: next.revised_prompt ?? previous?.revised_prompt,
    content: next.content ?? previous?.content,
    summary: next.summary ?? previous?.summary,
  };
}

function getStreamItem(
  state: EventStreamParseState,
  payload: Record<string, unknown>
) {
  const item = payload.item as ResponsesOutputItem | undefined;
  if (item?.type) return item;

  const itemId =
    typeof payload.item_id === "string"
      ? payload.item_id
      : typeof payload.output_item_id === "string"
        ? payload.output_item_id
        : typeof payload.id === "string"
          ? payload.id
          : typeof payload.call_id === "string"
            ? payload.call_id
            : undefined;
  if (!itemId) return undefined;
  return state.streamItems?.[itemId];
}

function updateStreamItem(
  state: EventStreamParseState,
  item: ResponsesOutputItem | undefined
) {
  if (!item?.type) return item;
  const itemId = getResponseItemId(item);
  if (!itemId) return item;
  state.streamItems = state.streamItems || {};
  const merged = mergeResponseOutputItem(state.streamItems[itemId], item);
  state.streamItems[itemId] = merged;
  return merged;
}

function getStreamDeltaItem(
  state: EventStreamParseState,
  payload: Record<string, unknown>
) {
  const previous = getStreamItem(state, payload);
  const delta = isPlainRecord(payload.delta)
    ? (payload.delta as ResponsesOutputItem)
    : undefined;
  const argumentsDelta =
    typeof payload.delta === "string" ? payload.delta : undefined;
  if (!previous && !delta?.type && argumentsDelta === undefined) {
    return undefined;
  }
  const deltaItem: ResponsesOutputItem = {
    ...(delta || {}),
    id: previous?.id || delta?.id,
    call_id: previous?.call_id || delta?.call_id,
    item_id: previous?.item_id || delta?.item_id,
    output_item_id: previous?.output_item_id || delta?.output_item_id,
    type: previous?.type || delta?.type,
    name:
      previous?.name ||
      delta?.name ||
      (typeof payload.name === "string" ? payload.name : undefined),
    arguments: argumentsDelta,
  };
  return updateStreamItem(state, deltaItem);
}

function mergeAgentEvents(
  ...groups: Array<AgentRunEvent[] | undefined>
): AgentRunEvent[] | undefined {
  const merged: AgentRunEvent[] = [];
  const seen = new Map<string, number>();
  for (const events of groups) {
    for (const event of events || []) {
      const key = getAgentEventKey(event);
      const existingIndex = seen.get(key);
      if (existingIndex === undefined) {
        seen.set(key, merged.length);
        merged.push(event);
        continue;
      }
      merged[existingIndex] = { ...merged[existingIndex], ...event };
    }
  }
  return merged.length ? merged : undefined;
}

function mergeGenerateImageResults(
  results: ResponsesResultWithOutput[]
): ResponsesResultWithOutput {
  const last = results[results.length - 1];
  if (!last) return { error: "API returned no image data" };

  const imageOutputs: NonNullable<GenerateImageResult["imageOutputs"]> = [];
  const outputItems: ResponsesOutputItem[] = [];
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const agentParts: string[] = [];
  let imageBase64: string | undefined;
  let imageUrl: string | undefined;
  let revisedPrompt: string | undefined;
  let upstreamRevisedPrompt: string | undefined;

  for (const result of results) {
    if (result.responseText?.trim()) textParts.push(result.responseText.trim());
    if (result.responseThinking?.trim()) {
      thinkingParts.push(result.responseThinking.trim());
    }
    if (result.responseAgent?.trim()) {
      agentParts.push(result.responseAgent.trim());
    }
    if (result.outputItems?.length) outputItems.push(...result.outputItems);

    for (const output of result.imageOutputs || []) {
      if (!output.imageBase64 && !output.imageUrl) continue;
      const nextOutput = {
        ...output,
        index: imageOutputs.length,
      } satisfies NonNullable<GenerateImageResult["imageOutputs"]>[number];
      imageOutputs.push(nextOutput);
      if (output.imageBase64) imageBase64 = output.imageBase64;
      if (output.imageUrl) imageUrl = output.imageUrl;
      revisedPrompt = output.revisedPrompt || revisedPrompt;
      upstreamRevisedPrompt =
        output.upstreamRevisedPrompt || upstreamRevisedPrompt;
    }

    if (
      !result.imageOutputs?.length &&
      (result.imageBase64 || result.imageUrl)
    ) {
      imageOutputs.push({
        imageBase64: result.imageBase64,
        imageUrl: result.imageUrl,
        revisedPrompt: result.revisedPrompt,
        upstreamRevisedPrompt: result.upstreamRevisedPrompt,
        index: imageOutputs.length,
      });
      imageBase64 = result.imageBase64 || imageBase64;
      imageUrl = result.imageUrl || imageUrl;
      revisedPrompt = result.revisedPrompt || revisedPrompt;
      upstreamRevisedPrompt =
        result.upstreamRevisedPrompt || upstreamRevisedPrompt;
    }
  }

  return {
    ...last,
    responsesStoreDisabledFallback: results.some(
      (result) => result.responsesStoreDisabledFallback
    ),
    imageBase64,
    imageUrl,
    imageOutputs: imageOutputs.length
      ? imageOutputs.map((output, index) => ({
          ...output,
          outputRole:
            output.outputRole === "choice"
              ? "choice"
              : index === imageOutputs.length - 1
                ? "final"
                : output.outputRole || "agent_draft",
        }))
      : last.imageOutputs,
    imageOutputCount: imageOutputs.length || last.imageOutputCount,
    revisedPrompt: last.revisedPrompt || revisedPrompt,
    upstreamRevisedPrompt:
      last.upstreamRevisedPrompt || upstreamRevisedPrompt || revisedPrompt,
    responseText: textParts.length ? textParts.join("\n\n") : last.responseText,
    responseThinking: thinkingParts.length
      ? thinkingParts.join("\n\n")
      : last.responseThinking,
    responseAgent: agentParts.length
      ? agentParts.join("\n")
      : last.responseAgent,
    agentEvents: mergeAgentEvents(
      ...results.map((result) => result.agentEvents)
    ),
    agentRoundCount: results.length,
    outputItems: outputItems.length ? outputItems : last.outputItems,
  };
}

async function emitAgentEvent(
  callbacks: ImageGenerationCallbacks | undefined,
  event: AgentRunEvent
) {
  await callbacks?.onAgentEvent?.(event);
}

async function emitAgentProgress(
  callbacks: ImageGenerationCallbacks | undefined,
  event: AgentRunEvent
) {
  await callbacks?.onAgentDelta?.(
    `${event.title}${event.detail ? ` - ${event.detail}` : ""}\n`
  );
  await emitAgentEvent(callbacks, event);
}

async function emitAgentDecision(
  callbacks: ImageGenerationCallbacks | undefined,
  params: {
    status: AgentRunEventStatus;
    title: string;
    detail?: string;
  }
) {
  await emitAgentProgress(callbacks, {
    kind: "tool",
    status: params.status,
    title: params.title,
    detail: params.detail,
    timestamp: new Date().toISOString(),
    toolType: "agent_decision",
  });
}

async function emitAgentRoundRequestStatus(
  callbacks: ImageGenerationCallbacks | undefined,
  params: {
    round: number;
    status: AgentRunEventStatus;
    title?: string;
    detail?: string;
  }
) {
  await emitAgentProgress(callbacks, {
    id: `agent-round-${params.round}-upstream`,
    kind: "tool",
    status: params.status,
    title: params.title || "等待 Codex/Responses 上游响应",
    detail: params.detail,
    timestamp: new Date().toISOString(),
    toolType: "agent_round_request",
  });
}

function createAgentRoundRequestTracker(
  callbacks: ImageGenerationCallbacks | undefined,
  round: number
) {
  const startedAt = Date.now();
  let stopped = false;
  let settled = false;
  let interval: ReturnType<typeof setInterval> | undefined;

  const emitStatus = async (
    status: AgentRunEventStatus,
    detail: string,
    options: { rawLog?: boolean } = {}
  ) => {
    const event: AgentRunEvent = {
      id: `agent-round-${round}-upstream`,
      kind: "tool",
      status,
      title: "等待 Codex/Responses 上游响应",
      detail,
      timestamp: new Date().toISOString(),
      toolType: "agent_round_request",
    };
    if (options.rawLog) {
      await emitAgentProgress(callbacks, event);
      return;
    }
    await emitAgentEvent(callbacks, event);
  };

  if (callbacks) {
    interval = setInterval(() => {
      if (stopped || settled) return;
      const elapsedSeconds = Math.max(
        5,
        Math.floor((Date.now() - startedAt) / 1000)
      );
      void emitStatus(
        "running",
        `模型仍在处理，已等待 ${elapsedSeconds} 秒`
      ).catch((error) => {
        logWarn("Agent round heartbeat failed", { error });
      });
    }, 5_000);
  }

  const stopTimer = () => {
    stopped = true;
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
  };

  const markReceived = async () => {
    if (settled) return;
    settled = true;
    stopTimer();
    await emitStatus("completed", "已收到上游流式响应，正在继续处理");
  };

  const noteStillWaiting = async (detail: string) => {
    if (settled) return;
    await emitStatus("running", detail);
  };

  const finish = async (params: { error?: string }) => {
    stopTimer();
    if (params.error) {
      settled = true;
      await emitStatus("failed", params.error, { rawLog: true });
      return;
    }
    if (!settled) {
      settled = true;
      await emitStatus("completed", "上游响应已返回，正在整理本轮结果", {
        rawLog: true,
      });
    }
  };

  const wrapCallbacks = (): ImageGenerationCallbacks | undefined => {
    if (!callbacks) return undefined;
    return {
      ...callbacks,
      onPartialImage: async (image) => {
        await markReceived();
        await callbacks.onPartialImage?.(image);
      },
      onTextDelta: async (delta) => {
        await markReceived();
        await callbacks.onTextDelta?.(delta);
      },
      onThinkingDelta: async (delta) => {
        await markReceived();
        await callbacks.onThinkingDelta?.(delta);
      },
      onAgentDelta: async (delta) => {
        await callbacks.onAgentDelta?.(delta);
      },
      onAgentEvent: async (event) => {
        if (event.toolType === "responses_stream_event") {
          await noteStillWaiting(
            event.detail
              ? `已收到上游事件：${event.detail}`
              : "已收到上游流式事件，等待可展示的工具结果"
          );
        } else if (event.toolType === "agent_tool_compat") {
          await noteStillWaiting("已调整工具配置，正在重试上游请求");
        } else if (event.toolType !== "agent_round_request") {
          await markReceived();
        }
        await callbacks.onAgentEvent?.(event);
      },
    };
  };

  return {
    finish,
    wrapCallbacks,
  };
}

async function recordAgentEvent(
  state: EventStreamParseState,
  callbacks: ImageGenerationCallbacks | undefined,
  event: AgentRunEvent
) {
  state.agentEvents = [...(state.agentEvents || []), event];
  await emitAgentEvent(callbacks, event);
}

function shouldReportResponsesToolItem(
  eventName: string,
  item: ResponsesOutputItem | undefined
) {
  if (!item?.type) return false;
  if (item.type === "message" || item.type === "reasoning") return false;
  if (
    item.type === "image_generation_call" &&
    eventName === "response.output_item.done"
  ) {
    return true;
  }
  return item.type.endsWith("_call");
}

function extractStreamItemId(payload: Record<string, unknown>) {
  return (
    (typeof payload.item_id === "string" && payload.item_id) ||
    (typeof payload.output_item_id === "string" && payload.output_item_id) ||
    (typeof payload.id === "string" && payload.id) ||
    (typeof payload.call_id === "string" && payload.call_id) ||
    undefined
  );
}

function eventNameToFallbackToolType(eventName: string) {
  if (eventName.includes("web_search_call")) return "web_search_call";
  if (eventName.includes("code_interpreter_call")) {
    return "code_interpreter_call";
  }
  if (eventName.includes("image_generation_call")) {
    return "image_generation_call";
  }
  if (eventName.includes("function_call")) return "function_call";
  return undefined;
}

function getFallbackToolEventKey(
  eventName: string,
  payload: Record<string, unknown>
) {
  const fallbackType = eventNameToFallbackToolType(eventName);
  if (!fallbackType) return undefined;
  const action = isPlainRecord(payload.action) ? payload.action : undefined;
  const detail =
    compactToolText(typeof payload.query === "string" ? payload.query : "") ||
    describeWebSearchAction(action) ||
    compactToolText(typeof payload.name === "string" ? payload.name : "") ||
    compactToolText(typeof payload.item_id === "string" ? payload.item_id : "") ||
    compactToolText(
      typeof payload.output_item_id === "string" ? payload.output_item_id : ""
    ) ||
    fallbackType;
  return `${fallbackType}:${detail || "active"}`;
}

function getStreamToolItem(
  state: EventStreamParseState,
  eventName: string,
  payload: Record<string, unknown>
) {
  const item =
    getStreamItem(state, payload) ||
    (payload.item as ResponsesOutputItem | undefined);
  if (item?.type) return updateStreamItem(state, item);

  const itemId = extractStreamItemId(payload);
  const fallbackType = eventNameToFallbackToolType(eventName);
  const fallbackKey = itemId || getFallbackToolEventKey(eventName, payload);
  if (!fallbackKey || !fallbackType) return undefined;
  return updateStreamItem(state, {
    id: fallbackKey,
    call_id: fallbackKey,
    item_id: fallbackKey,
    output_item_id: fallbackKey,
    type: fallbackType,
    status: typeof payload.status === "string" ? payload.status : undefined,
    query: typeof payload.query === "string" ? payload.query : undefined,
    action: isPlainRecord(payload.action) ? payload.action : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
  });
}

async function reportResponsesToolEvent(
  state: EventStreamParseState,
  callbacks: ImageGenerationCallbacks | undefined,
  item: ResponsesOutputItem | undefined,
  status: AgentRunEventStatus
) {
  if (
    !item?.type ||
    !shouldReportResponsesToolItem("response.output_item.added", item)
  ) {
    return;
  }
  const itemId = getResponseItemId(item);
  if (itemId) {
    state.emittedToolEvents = state.emittedToolEvents || {};
    const signature = `${status}:${getToolEventSignature(item)}`;
    const previousSignature = state.emittedToolEvents[itemId];
    if (previousSignature === signature) return;
    state.emittedToolEvents[itemId] = signature;
  }

  const done = status === "completed";
  const displayItem: ResponsesOutputItem = {
    ...item,
    status: done
      ? "completed"
      : status === "running"
        ? item.status || "in_progress"
        : status,
  };
  const line = describeResponsesToolItem(displayItem, { done });
  if (line) {
    await callbacks?.onAgentDelta?.(`${line}\n`);
    state.responseAgent = `${state.responseAgent || ""}${line}\n`;
  }
  const event = toAgentRunEvent(displayItem, { done });
  if (event) {
    event.status = status;
    await recordAgentEvent(state, callbacks, event);
  }
}

function isResponsesPartialImageEvent(
  eventName: string,
  payload: Record<string, unknown>
) {
  return (
    eventName.includes("partial_image") ||
    (typeof payload.type === "string" && payload.type.includes("partial_image"))
  );
}

function shouldSurfaceRawResponsesStreamEvent(eventName: string) {
  if (!eventName) return false;
  if (eventName === "response.completed" || eventName === "response.failed") {
    return true;
  }
  return (
    eventName.includes("web_search_call") ||
    eventName.includes("image_generation_call") ||
    eventName.includes("code_interpreter_call") ||
    eventName.includes("function_call") ||
    eventName.includes("output_item") ||
    eventName.includes("output_text") ||
    eventName.includes("reasoning")
  );
}

async function surfaceRawResponsesStreamEvent(
  eventName: string,
  state: EventStreamParseState,
  callbacks?: ImageGenerationCallbacks
) {
  if (!state.debugRawStreamEvents) return;
  if (!callbacks || !shouldSurfaceRawResponsesStreamEvent(eventName)) return;
  state.emittedRawStreamEvents = state.emittedRawStreamEvents || {};
  const previous = state.emittedRawStreamEvents[eventName];
  if (previous) return;
  state.emittedRawStreamEvents[eventName] = true;
  await callbacks.onAgentDelta?.(`上游事件: ${eventName}\n`);
  await emitAgentEvent(callbacks, {
    id: `raw-upstream-${eventName}`,
    kind: "tool",
    status: inferToolStatusFromEventName(eventName),
    title: "收到上游流式事件",
    detail: eventName,
    timestamp: new Date().toISOString(),
    toolType: "responses_stream_event",
  });
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
  const streamEventName =
    eventName || (typeof payload.type === "string" ? payload.type : "");
  await surfaceRawResponsesStreamEvent(streamEventName, state, callbacks);

  if (
    streamEventName === "response.failed" ||
    streamEventName === "error" ||
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

  if (streamEventName === "response.output_item.done") {
    const item = updateStreamItem(
      state,
      payload.item as ResponsesOutputItem | undefined
    );
    await reportResponsesToolEvent(state, callbacks, item, "completed");
    const itemImageBase64 = extractResponsesImageCallBase64(item);
    if (item?.type === "image_generation_call" && itemImageBase64) {
      const imageOutputCount =
        (state.fallbackResult?.imageOutputCount || 0) + 1;
      const imageOutput = {
        imageBase64: itemImageBase64,
        upstreamRevisedPrompt: item.revised_prompt,
        index: imageOutputCount - 1,
        outputRole: "agent_draft" as const,
      };
      const partialImage = {
        imageBase64: itemImageBase64,
        partialImageIndex: imageOutput.index,
        final: true,
      };
      await recordAgentEvent(state, callbacks, {
        id: item.id,
        kind: "image_generation",
        status: "completed",
        title: "最终图片已生成",
        index: imageOutput.index,
        partialImageIndex: imageOutput.index,
        timestamp: new Date().toISOString(),
        toolType: item.type,
      });
      await callbacks?.onPartialImage?.(partialImage);
      state.fallbackResult = {
        ...(state.fallbackResult || {}),
        imageBase64: itemImageBase64,
        imageOutputs: [
          ...(state.fallbackResult?.imageOutputs || []),
          imageOutput,
        ],
        imageOutputCount,
        upstreamRevisedPrompt: item.revised_prompt,
        responseAgent:
          state.fallbackResult?.responseAgent || state.responseAgent,
      };
    }
    return null;
  }

  if (streamEventName === "response.output_item.added") {
    const item = updateStreamItem(
      state,
      payload.item as ResponsesOutputItem | undefined
    );
    await reportResponsesToolEvent(state, callbacks, item, "started");
    return null;
  }

  const fallbackToolType = isResponsesPartialImageEvent(streamEventName, payload)
    ? undefined
    : eventNameToFallbackToolType(streamEventName);
  if (fallbackToolType) {
    const item =
      getStreamDeltaItem(state, payload) ||
      getStreamToolItem(state, streamEventName, payload);
    await reportResponsesToolEvent(
      state,
      callbacks,
      item,
      inferToolStatusFromEventName(streamEventName)
    );
    return null;
  }

  if (
    streamEventName === "response.output_item.in_progress" ||
    streamEventName === "response.web_search_call.in_progress" ||
    streamEventName === "response.code_interpreter_call.in_progress" ||
    streamEventName === "response.image_generation_call.in_progress"
  ) {
    const item = getStreamToolItem(state, streamEventName, payload);
    await reportResponsesToolEvent(state, callbacks, item, "running");
    return null;
  }

  if (
    streamEventName === "response.output_item.delta" ||
    streamEventName === "response.web_search_call.searching" ||
    streamEventName === "response.web_search_call.in_progress" ||
    streamEventName === "response.code_interpreter_call.code.delta" ||
    streamEventName === "response.function_call_arguments.delta"
  ) {
    const item =
      getStreamDeltaItem(state, payload) ||
      getStreamToolItem(state, streamEventName, payload);
    await reportResponsesToolEvent(state, callbacks, item, "running");
    return null;
  }

  if (isResponsesPartialImageEvent(streamEventName, payload)) {
    const partialImage = extractPartialImage(payload as ImageResponsePayload);
    if (partialImage) {
      await recordAgentEvent(state, callbacks, {
        kind: "image_partial",
        status: "completed",
        title: "流式预览已生成",
        imageBase64: partialImage.imageBase64,
        imageUrl: partialImage.imageUrl,
        index: partialImage.index,
        partialImageIndex: partialImage.partialImageIndex,
        timestamp: new Date().toISOString(),
        toolType:
          typeof payload.type === "string"
            ? payload.type
            : streamEventName || undefined,
      });
      await callbacks?.onPartialImage?.(partialImage);
    }
    return null;
  }

  if (streamEventName === "response.output_text.delta") {
    const delta = payload.delta;
    if (typeof delta === "string" && delta) {
      await callbacks?.onTextDelta?.(delta);
      state.fallbackResult = {
        ...(state.fallbackResult || {}),
        responseText: `${state.fallbackResult?.responseText || ""}${delta}`,
        responseAgent:
          state.fallbackResult?.responseAgent || state.responseAgent,
      };
    }
    return null;
  }

  if (streamEventName === "response.reasoning_summary_text.delta") {
    const delta = payload.delta;
    if (typeof delta === "string" && delta) {
      await callbacks?.onThinkingDelta?.(delta);
      state.fallbackResult = {
        ...(state.fallbackResult || {}),
        responseThinking: `${state.fallbackResult?.responseThinking || ""}${delta}`,
        responseAgent:
          state.fallbackResult?.responseAgent || state.responseAgent,
      };
    }
    return null;
  }

  if (streamEventName === "response.completed") {
    const completedPayload = extractResponseCompletedPayload(
      payload as ResponsesPayload | { response?: ResponsesPayload }
    );
    const result = parseResponsesOutput(completedPayload.output);
    if (result) {
      state.completedResult = {
        ...result,
        responseId: completedPayload.id,
        outputItems: completedPayload.output,
        responsesUsage: extractResponsesTokenUsage(completedPayload),
        imageOutputs: result.imageOutputs || state.fallbackResult?.imageOutputs,
        imageOutputCount: Math.max(
          result.imageOutputCount || 0,
          state.fallbackResult?.imageOutputCount || 0
        ),
        responseAgent: state.responseAgent || result.responseAgent,
        agentEvents: mergeAgentEvents(state.agentEvents, result.agentEvents),
      };
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
): Promise<ResponsesResultWithOutput> {
  if (!response.body) {
    return parseResponsesEventStreamText(await response.text(), callbacks);
  }

  const state: EventStreamParseState = {
    completedResult: null,
    fallbackResult: null,
    debugRawStreamEvents:
      Boolean(callbacks) && process.env.IMAGE_AGENT_DEBUG_STREAM_EVENTS === "true",
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";

  while (true) {
    const { value, done } = await reader.read();
    const chunk = decoder.decode(value, { stream: !done });
    rawText += chunk;
    buffer += chunk;
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

  return withStreamJsonErrorFallback(finishEventStream(state), rawText);
}

async function parseResponsesEventStreamText(
  text: string,
  callbacks?: ImageGenerationCallbacks
): Promise<ResponsesResultWithOutput> {
  const jsonError = tryParseJsonPayloadError(text);
  if (jsonError) return { error: jsonError };

  const state: EventStreamParseState = {
    completedResult: null,
    fallbackResult: null,
    debugRawStreamEvents:
      Boolean(callbacks) && process.env.IMAGE_AGENT_DEBUG_STREAM_EVENTS === "true",
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
  callbacks?: ImageGenerationCallbacks,
  options: { preferEventStream?: boolean } = {}
): Promise<ResponsesResultWithOutput> {
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

  if (options.preferEventStream && !contentType.includes("application/json")) {
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
      error: getNonJsonErrorMessage(text, "Responses API", response),
      ...responseRetryMetadata,
    };
  }

  const data = (await response.json()) as ResponsesPayload;
  const result = parseResponsesOutput(data.output);

  return withRetryMetadata(
    result
      ? {
          ...result,
          responseId: data.id,
          outputItems: data.output,
          responsesUsage: extractResponsesTokenUsage(data),
        }
      : { error: getPayloadError(data) || "API returned no image data" },
    { ...responseRetryMetadata, ...extractPayloadRetryMetadata(data) }
  );
}

type EventStreamParseState = {
  completedResult: ResponsesResultWithOutput | null;
  fallbackResult: ResponsesResultWithOutput | null;
  responseAgent?: string;
  agentEvents?: AgentRunEvent[];
  streamItems?: Record<string, ResponsesOutputItem>;
  emittedToolEvents?: Record<string, string>;
  emittedRawStreamEvents?: Record<string, true>;
  debugRawStreamEvents?: boolean;
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

function finishEventStream(
  state: EventStreamParseState
): ResponsesResultWithOutput {
  const result = state.completedResult || state.fallbackResult;
  if (result) {
    return {
      ...result,
      responseAgent: result.responseAgent || state.responseAgent,
      agentEvents: mergeAgentEvents(state.agentEvents, result.agentEvents),
    };
  }

  return { error: "API returned no image data" };
}

async function parseEventStreamText(
  text: string,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  const jsonError = tryParseJsonPayloadError(text);
  if (jsonError) return { error: jsonError };

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
  let rawText = "";

  while (true) {
    const { value, done } = await reader.read();
    const chunk = decoder.decode(value, { stream: !done });
    rawText += chunk;
    buffer += chunk;
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

  return withStreamJsonErrorFallback(finishEventStream(state), rawText);
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
    if (looksLikeEventStreamText(text)) {
      return withRetryMetadata(
        await parseEventStreamText(text, callbacks),
        responseRetryMetadata
      );
    }
    return {
      error: getNonJsonErrorMessage(text, "Images API", response),
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

export async function getUserApiConfig(
  userId: string
): Promise<ApiConfig | null> {
  const plan = await getUserPlan(userId);
  if (!(await canUsePlanCapability(plan.plan, "customApi.configure"))) {
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
  result.backend = {
    type: "user-api",
    chatCompletionsUpstreamMode: row.chatCompletionsUpstreamMode as
      | "responses"
      | "chat_completions",
  };
  return result;
}

export async function getEffectiveConfig(
  userConfig: ApiConfig | null,
  options?: {
    userId?: string;
    apiKeyId?: string;
    requestKind?: ImageBackendRequestKind;
    preferredMemberId?: string;
    accountBackendPreference?: ImageBackendAccountBackend;
    accountBackendPreferenceMode?: ImageBackendPreferenceMode;
    ignoreUserConfig?: boolean;
  }
): Promise<{
  config: ApiConfig;
  useCredits: boolean;
}> {
  if (userConfig && !options?.ignoreUserConfig) {
    return { config: userConfig, useCredits: false };
  }
  if (options?.userId && options.requestKind) {
    let poolConfig: Awaited<ReturnType<typeof resolveImageBackendPoolConfig>>;
    try {
      poolConfig = await resolveImageBackendPoolConfig({
        userId: options.userId,
        apiKeyId: options.apiKeyId,
        requestKind: options.requestKind,
        preferredMemberId: options.preferredMemberId,
        accountBackendPreference: options.accountBackendPreference,
        accountBackendPreferenceMode: options.accountBackendPreferenceMode,
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
  throw new ImageBackendPoolUnavailableError(
    "没有可用的默认生图后端，请在账号池中配置默认分组和 API/账号"
  );
}

export async function generateImage(
  config: ApiConfig,
  params: GenerateImageParams,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  if (config.backend?.reportResult) {
    return retryPoolBackendResult(
      config,
      (candidate) => generateImage(candidate, params, callbacks),
      {
        mixWebFirst: params.mixWebFirst,
        accountBackendPreference: params.requiresResponsesBackend
          ? "responses"
          : params.forceWebBackend
            ? "web"
            : undefined,
        accountBackendPreferenceMode: params.forceWebBackend
          ? "mixed-only"
          : undefined,
      }
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
      return applyPromptOptimizationResultVisibility(
        await postResponsesImageRequestWithToolChoiceFallback(
          config,
          buildResponsesImageGenerationRequest(config, {
            ...params,
            model,
            gptModel:
              params.gptModel ||
              (await getDefaultImageGptModel(config, {
                allowGpt55: true,
              })),
          }),
          { signal: params.signal },
          callbacks
        )
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
    const background = normalizeImageBackground(params.background);
    const response = await fetch(`${config.baseUrl}/images/generations`, {
      method: "POST",
      signal: params.signal,
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
        ...(normalizeOutputFormat(params.outputFormat)
          ? { output_format: normalizeOutputFormat(params.outputFormat) }
          : {}),
        ...(normalizeOutputCompression(params.outputCompression) !== undefined
          ? {
              output_compression: normalizeOutputCompression(
                params.outputCompression
              ),
            }
          : {}),
        ...(background ? { background } : {}),
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
    return retryPoolBackendResult(
      config,
      (candidate) => editImage(candidate, params, callbacks),
      {
        mixWebFirst: params.mixWebFirst,
        accountBackendPreference: params.requiresResponsesBackend
          ? "responses"
          : params.forceWebBackend
            ? "web"
            : undefined,
        accountBackendPreferenceMode: params.forceWebBackend
          ? "mixed-only"
          : undefined,
      }
    );
  }

  const model = getModel(config, params.model);
  const editPromptRefs = resolvePromptImageReferences({
    prompt: getEffectivePrompt(params),
    images: params.images,
  });
  const effectiveEditPrompt = editPromptRefs.prompt.replace(
    /current-reference-/g,
    "edit-reference-"
  );
  const paramsWithResolvedPrompt: EditImageParams = {
    ...params,
    prompt: effectiveEditPrompt,
    apiPrompt: effectiveEditPrompt,
  };
  if (isPoolAccountBackend(config, "web")) {
    return editImageWithChatGptWeb(config, {
      ...paramsWithResolvedPrompt,
      model,
      gptModel: params.gptModel,
    });
  }
  if (isResponsesBackend(config)) {
    try {
      return applyPromptOptimizationResultVisibility(
        await postResponsesImageRequestWithToolChoiceFallback(
          config,
          buildResponsesImageEditRequest(config, {
            ...paramsWithResolvedPrompt,
            model,
            gptModel:
              params.gptModel ||
              (await getDefaultImageGptModel(config, {
                allowGpt55: true,
              })),
          }),
          { signal: params.signal },
          callbacks
        )
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
    const prompt = effectiveEditPrompt;
    const formData = new FormData();
    appendImageParams(formData, config, {
      prompt,
      model,
      n: params.n,
      size: params.size,
      quality: params.quality,
      moderation: params.moderation,
      outputFormat: params.outputFormat,
      outputCompression: params.outputCompression,
      background: params.background,
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
      signal: params.signal,
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
    return retryPoolBackendResult(
      config,
      (candidate) => generateChatImage(candidate, params, callbacks),
      {
        mixWebFirst: params.mixWebFirst,
        accountBackendPreference: params.requiresResponsesBackend
          ? "responses"
          : undefined,
      }
    );
  }

  const model = await getResponsesModel(config, params.model, {
    allowGpt55: params.allowGpt55,
  });
  if (isPoolAccountBackend(config, "web")) {
    const webPrompt =
      params.fileContext && params.promptOptimization === false
        ? `${params.prompt}\n\n${params.fileContext}`
        : params.prompt;
    const webApiPrompt = params.fileContext
      ? `${params.apiPrompt || params.prompt}\n\n${params.fileContext}`
      : params.apiPrompt;
    const webParams = {
      prompt: webPrompt,
      apiPrompt: webApiPrompt,
      promptOptimization: params.promptOptimization,
      history: params.history,
      size: params.size,
      model: params.imageModel || DEFAULT_IMAGE_MODEL,
      gptModel: model,
      thinking: params.thinking,
      quality: params.quality,
      n: params.n,
      moderation: params.moderation,
      outputFormat: params.outputFormat,
      outputCompression: params.outputCompression,
      background: params.background,
      files: params.files,
    };
    if (params.images?.length) {
      return editImageWithChatGptWeb(config, {
        ...webParams,
        images: params.images,
      });
    }
    return generateImageWithChatGptWeb(config, webParams);
  }
  if (
    config.backend?.chatCompletionsUpstreamMode === "chat_completions" &&
    !params.agentMode &&
    !params.rawResponsesBody
  ) {
    return await generateChatImageWithChatCompletions(
      config,
      params,
      callbacks
    );
  }
  try {
    const currentBackendMember = getStickyBackendMember(config);
    const promptRefs = resolvePromptImageReferences({
      prompt: getEffectivePrompt(params),
      images: params.images,
      history: params.history,
      currentBackendMember,
    });
    const prompt = promptRefs.prompt;
    const size = params.size || DEFAULT_IMAGE_SIZE;
    const responsesPreviousResponseEnabled =
      shouldEnableResponsesPreviousResponse({
        settingEnabled: await getRuntimeSettingBoolean(
          "IMAGE_RESPONSES_PREVIOUS_RESPONSE_ENABLED",
          false
        ),
        rawResponsesBody: params.rawResponsesBody,
        currentBackendMember,
        files: params.files,
      });
    const { previousState: previousResponsesState, canUsePreviousResponseId } =
      resolveResponsesNativeState({
        enabled: responsesPreviousResponseEnabled,
        currentBackendMember,
        history: params.history,
      });
    const responseImageRoundIndex = getNextAssistantImageRoundIndex(
      params.history
    );
    const generatedImageReferenceInstruction =
      buildGeneratedImageReferenceInstruction({
        roundIndex: responseImageRoundIndex,
      });
    const manualHistoryInput = buildResponsesInput(
      prompt,
      params.images,
      params.files,
      params.history,
      {
        extraCurrentImageReferences: promptRefs.historyImageReferences,
        generatedImageReferenceInstruction,
        currentBackendMember,
      }
    );
    const input = canUsePreviousResponseId
      ? [
          {
            role: "user" as const,
            content: buildCurrentResponsesContent(
              prompt,
              params.images,
              params.files,
              {
                extraImageReferences: promptRefs.historyImageReferences,
                includeExtraImageEntities: false,
                generatedImageReferenceInstruction,
              }
            ),
          },
        ]
      : manualHistoryInput;
    const baseInstructions =
      params.promptOptimization === false
        ? params.agentMode
          ? ORIGINAL_PROMPT_RESPONSES_IMAGE_INSTRUCTIONS
          : ORIGINAL_PROMPT_CHAT_RESPONSES_IMAGE_INSTRUCTIONS
        : params.agentMode
          ? DEFAULT_RESPONSES_IMAGE_INSTRUCTIONS
          : DEFAULT_CHAT_RESPONSES_IMAGE_INSTRUCTIONS;
    const instructions =
      withResponsesImageReferenceInstructions(baseInstructions);
    const tool: {
      type: "image_generation";
      action: "auto";
      model?: string;
      partial_images?: number;
      size?: string;
      quality?: ImageQuality;
      moderation?: ImageModeration;
      output_format?: ImageOutputFormat;
      output_compression?: number;
      background?: string;
    } = {
      type: "image_generation",
      action: "auto",
      partial_images: 2,
    };

    const toolModel = getImageModel(params.imageModel) || DEFAULT_IMAGE_MODEL;
    if (toolModel) {
      tool.model = toolModel;
    }
    if (size && size !== AUTO_IMAGE_SIZE) {
      tool.size = size;
    }
    const quality = normalizeQuality(params.quality);
    if (quality) tool.quality = quality;
    const moderation = normalizeModeration(params.moderation);
    if (moderation) tool.moderation = moderation;
    const outputFormat = normalizeOutputFormat(params.outputFormat);
    if (outputFormat) tool.output_format = outputFormat;
    const outputCompression = normalizeOutputCompression(
      params.outputCompression
    );
    if (outputCompression !== undefined) {
      tool.output_compression = outputCompression;
    }
    const background = normalizeImageBackground(params.background);
    if (background) tool.background = background;

    const thinking = normalizeThinking(params.thinking);
    const reasoning: ReasoningConfig | undefined = thinking
      ? { effort: thinking, summary: "concise" }
      : undefined;

    const stream = Boolean(params.stream || config.useStream);
    const defaultAdditionalTools = params.agentMode
      ? createDefaultAgentAdditionalTools()
      : [];
    const requestBody: ResponsesStreamRequestBody =
      params.rawResponsesBody && isPlainRecord(params.rawResponsesBody)
        ? normalizeResponsesImageRequestBody(params.rawResponsesBody, {
            fallbackTool: tool,
            additionalTools: defaultAdditionalTools,
            instructions,
            stream,
          })
        : {
            model,
            input,
            tools: [tool, ...defaultAdditionalTools],
            instructions,
            store: responsesPreviousResponseEnabled,
            ...(canUsePreviousResponseId
              ? { previous_response_id: previousResponsesState?.responseId }
              : {}),
            ...(reasoning ? { reasoning } : {}),
            ...(stream ? { stream: true } : {}),
          };

    let result: ResponsesResultWithOutput | undefined;
    if (params.agentMode && !params.rawResponsesBody) {
      const maxRounds =
        normalizeAgentMaxRounds(params.agentMaxRounds) ||
        (await getAgentMaxRounds());
      const forceMaxRounds =
        params.agentForceMaxRounds ?? (await getAgentForceMaxRounds());
      const roundResults: ResponsesResultWithOutput[] = [];
      let nextInput = input;
      let agentPreviousResponseEnabled = responsesPreviousResponseEnabled;
      let agentPreviousResponseId = canUsePreviousResponseId
        ? previousResponsesState?.responseId
        : undefined;
      const disableAgentNativeState = () => {
        agentPreviousResponseEnabled = false;
        agentPreviousResponseId = undefined;
      };

      for (let round = 1; round <= maxRounds; round += 1) {
        const roundRequestBody: ResponsesStreamRequestBody = {
          ...requestBody,
          input: nextInput,
          store: agentPreviousResponseEnabled,
          previous_response_id: agentPreviousResponseEnabled
            ? agentPreviousResponseId
            : undefined,
          instructions:
            round === 1
              ? requestBody.instructions
              : `${requestBody.instructions || instructions}\n\n${AGENT_CONTINUE_INSTRUCTIONS}`,
        };
        await emitAgentProgress(callbacks, {
          kind: "message",
          status: "started",
          title: `Agent 第 ${round} 轮开始`,
          detail:
            round === 1
              ? "分析请求并按需调用工具"
              : "根据上一版结果继续判断是否迭代",
          timestamp: new Date().toISOString(),
        });

        await emitAgentRoundRequestStatus(callbacks, {
          round,
          status: "running",
          detail: "已发送请求，等待模型返回工具调用、文本或图片",
        });
        const roundRequestTracker = createAgentRoundRequestTracker(
          callbacks,
          round
        );
        const roundCallbacks = roundRequestTracker.wrapCallbacks();
        let roundResult: ResponsesResultWithOutput;
        try {
          roundResult = await fetchAgentRoundResponses({
            config,
            requestBody: roundRequestBody,
            signal: params.signal,
            stream,
            callbacks: roundCallbacks,
            storeFalseFallbackInput: manualHistoryInput,
            onStoreDisabledFallback: disableAgentNativeState,
          });
          if (
            round === 1 &&
            roundResult.error &&
            (canUsePreviousResponseId &&
              isPreviousResponseStateError(roundResult.error))
          ) {
            agentPreviousResponseId = undefined;
            roundResult = await fetchAgentRoundResponses({
              config,
              requestBody: {
                ...roundRequestBody,
                input: manualHistoryInput,
                previous_response_id: undefined,
              },
              signal: params.signal,
              stream,
              callbacks: roundCallbacks,
              storeFalseFallbackInput: manualHistoryInput,
              onStoreDisabledFallback: disableAgentNativeState,
            });
          }
          if (
            round === 1 &&
            agentPreviousResponseEnabled &&
            roundResult.error &&
            isResponsesStoreUnsupportedError(roundResult.error)
          ) {
            disableAgentNativeState();
            roundResult = await fetchAgentRoundResponses({
              config,
              requestBody: {
                ...roundRequestBody,
                input: manualHistoryInput,
                previous_response_id: undefined,
                store: false,
              },
              signal: params.signal,
              stream,
              callbacks: roundCallbacks,
              storeFalseFallbackInput: manualHistoryInput,
              onStoreDisabledFallback: disableAgentNativeState,
            });
          }
          if (
            round > 1 &&
            agentPreviousResponseEnabled &&
            roundResult.error &&
            shouldRetryAgentRoundWithManualHistory(roundResult.error)
          ) {
            await emitAgentDecision(callbacks, {
              status: "completed",
              title: "Agent 上下文重试",
              detail:
                "上游原生会话状态返回异常，已改用手动历史和上一版图片重试当前轮",
            });
            disableAgentNativeState();
            roundResult = await fetchAgentRoundResponses({
              config,
              requestBody: {
                ...roundRequestBody,
                input: buildAgentContinuationInput({
                  baseInput: input,
                  previousResult: mergeGenerateImageResults(roundResults),
                  currentRound: round - 1,
                  maxRounds,
                  outputFormat,
                  historyRoundIndex: responseImageRoundIndex,
                  includeImageEntities: true,
                }),
                previous_response_id: undefined,
                store: false,
              },
              signal: params.signal,
              stream,
              callbacks: roundCallbacks,
              onStoreDisabledFallback: disableAgentNativeState,
            });
          }
        } catch (error) {
          roundResult = {
            error:
              error instanceof Error ? error.message : "Unknown error occurred",
          };
        }
        await roundRequestTracker.finish({ error: roundResult.error });
        roundResults.push(roundResult);
        if (roundResult.responsesStoreDisabledFallback) {
          disableAgentNativeState();
        }
        if (
          agentPreviousResponseEnabled &&
          !roundResult.responsesStoreDisabledFallback &&
          roundResult.responseId
        ) {
          agentPreviousResponseId = roundResult.responseId;
        }

        if (roundResult.error) {
          if (roundResults.slice(0, -1).some(hasAgentImage)) {
            await reportPoolBackendResult(config, {
              error: roundResult.error,
              upstreamResetAt: roundResult.upstreamResetAt,
              retryAfterSeconds: roundResult.retryAfterSeconds,
            });
            await emitAgentProgress(callbacks, {
              kind: "message",
              status: "failed",
              title: `Agent 第 ${round} 轮停止`,
              detail: `后续迭代失败，已保留上一版图片：${roundResult.error}`,
              timestamp: new Date().toISOString(),
            });
            result = {
              ...mergeGenerateImageResults(roundResults.slice(0, -1)),
              partialAgentError: roundResult.error,
            };
            break;
          }
          result = mergeGenerateImageResults(roundResults);
          break;
        }

        await emitAgentProgress(callbacks, {
          kind: "message",
          status: "completed",
          title: `Agent 第 ${round} 轮完成`,
          detail: hasAgentImage(roundResult)
            ? "已生成图片，正在判断是否继续"
            : "未生成图片，继续推动执行",
          timestamp: new Date().toISOString(),
        });

        const continueCalls = getContinueGenerationFunctionCalls(
          roundResult.outputItems
        );
        const continueFunctionCallItems =
          buildContinueGenerationFunctionCallItems({
            outputItems: roundResult.outputItems,
            includeFunctionCallInputs: !agentPreviousResponseEnabled,
          });
        const continueReason = continueCalls
          .map((call) => call.reason)
          .find((reason): reason is string => Boolean(reason));
        const shouldForceContinue = forceMaxRounds && round < maxRounds;
        if (continueCalls.length > 0) {
          await emitAgentProgress(callbacks, {
            kind: "tool",
            status: "completed",
            title: "Agent 请求继续",
            detail: continueReason,
            timestamp: new Date().toISOString(),
            toolType: "continue_generation",
          });
        } else if (forceMaxRounds) {
          await emitAgentDecision(callbacks, {
            status: "completed",
            title: shouldForceContinue ? "Agent 强制继续" : "Agent 强制轮数完成",
            detail: shouldForceContinue
              ? `系统已开启强制迭代，将继续执行第 ${round + 1} 轮`
              : `已完成强制迭代轮数 ${maxRounds}`,
          });
        }

        if (round >= maxRounds) {
          if (continueCalls.length > 0) {
            await emitAgentDecision(callbacks, {
              status: "completed",
              title: "Agent 最大轮数完成",
              detail: `模型请求继续，但已达到最大轮数 ${maxRounds}`,
            });
          }
          result = mergeGenerateImageResults(roundResults);
          break;
        }

        if (hasAgentImage(roundResult)) {
          if (continueCalls.length === 0 && !shouldForceContinue) {
            await emitAgentDecision(callbacks, {
              status: "completed",
              title: "Agent 自检完成",
              detail: "模型未请求继续，已停止迭代",
            });
            result = mergeGenerateImageResults(roundResults);
            break;
          }
          nextInput = buildAgentContinuationInput({
            baseInput: agentPreviousResponseEnabled ? [] : input,
            previousResult: mergeGenerateImageResults(roundResults),
            currentRound: round,
            maxRounds,
            outputFormat,
            historyRoundIndex: responseImageRoundIndex,
            includeImageEntities: !agentPreviousResponseEnabled,
            functionCallItems: continueFunctionCallItems,
          });
          continue;
        }

        if (
          roundResults.some(hasAgentImage) &&
          continueCalls.length === 0 &&
          !shouldForceContinue
        ) {
          await emitAgentDecision(callbacks, {
            status: "completed",
            title: "Agent 自检完成",
            detail: "模型未请求继续，已停止迭代",
          });
          result = mergeGenerateImageResults(roundResults);
          break;
        }

        const textOnly = Boolean(
          roundResult.responseText?.trim() || roundResult.responseAgent?.trim()
        );
        if (!textOnly) {
          result = mergeGenerateImageResults(roundResults);
          break;
        }

        nextInput = buildAgentContinuationInput({
          baseInput: agentPreviousResponseEnabled ? [] : input,
          previousResult: mergeGenerateImageResults(roundResults),
          currentRound: round,
          maxRounds,
          outputFormat,
          historyRoundIndex: responseImageRoundIndex,
          includeImageEntities: !agentPreviousResponseEnabled,
          functionCallItems: continueFunctionCallItems,
        });
      }

      if (!result) {
        result = mergeGenerateImageResults(roundResults);
      }
      const completedRounds =
        result.agentRoundCount ||
        roundResults.filter((item) => !item.error).length;
      const finalAgentEvent: AgentRunEvent = {
        kind: "message",
        status: result.error ? "failed" : "completed",
        title: result.error ? "Agent 执行失败" : "Agent 执行完成",
        detail: result.error
          ? result.error
          : `已完成 ${completedRounds || roundResults.length} 轮 Agent 执行`,
        timestamp: new Date().toISOString(),
      };
      await emitAgentProgress(callbacks, finalAgentEvent);
      result = {
        ...result,
        agentEvents: mergeAgentEvents(result.agentEvents, [finalAgentEvent]),
      };
    } else {
      result = await fetchResponsesWithPreviousResponseFallback(
        config,
        requestBody,
        manualHistoryInput,
        {
          signal: params.signal,
          stream,
          previousResponseUsed: canUsePreviousResponseId,
        },
        callbacks
      );
    }

    if (!result) {
      result = { error: "API returned no image data" };
    }

    if (params.agentMode && params.rawResponsesBody) {
      const unsupportedTools = getUnsupportedToolTypes(result);
      if (unsupportedTools.size > 0) {
        result = await fetchAgentRoundResponses({
          config,
          requestBody,
          signal: params.signal,
          stream,
          callbacks,
        });
      }
    }

    return applyPromptOptimizationResultVisibility(
      attachResponsesPreviousResponseState(
        config,
        result,
        responsesPreviousResponseEnabled
      )
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
