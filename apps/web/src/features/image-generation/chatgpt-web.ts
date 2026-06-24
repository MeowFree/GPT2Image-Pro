import { createHash, randomUUID } from "node:crypto";
import { logError } from "@repo/shared/logger";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { parseImageSize } from "./resolution";
import {
  downloadWebHistoryImageReference,
  getLatestWebHistoryImageReference,
} from "./web-history-references";
import type {
  ApiConfig,
  ChatGptWebConversationState,
  ChatHistoryMessage,
  EditImageParams,
  GenerateImageParams,
  GenerateImageResult,
  ImageInputFile,
  ResponsesInputFile,
  ThinkingLevel,
} from "./types";

const CHATGPT_BASE_URL = "https://chatgpt.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const DEFAULT_CLIENT_VERSION = "prod-be885abbfcfe7b1f511e88b3003d9ee44757fbad";
const DEFAULT_CLIENT_BUILD_NUMBER = "5955942";
const DEFAULT_POW_SCRIPT = "https://chatgpt.com/backend-api/sentinel/sdk.js";
const IMAGE_POLL_TIMEOUT_MS = 120_000;
const IMAGE_POLL_INTERVAL_MS = 4_000;
const WEB_PROXY_REQUEST_TIMEOUT_MS = 310_000;

type ChatRequirements = {
  token: string;
  proofToken?: string;
  turnstileToken?: string;
  soToken?: string;
};

type UploadedAttachment = {
  file_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  content_type: "image_asset_pointer" | "file_asset_pointer";
  width?: number;
  height?: number;
};

type WebSession = {
  deviceId: string;
  sessionId: string;
};

type PowResources = {
  scriptSources: string[];
  dataBuild: string;
};

export type ChatGptWebAccountInfo = {
  email: string | null;
  userId: string | null;
  type: string;
  quota: number;
  imageQuotaUnknown: boolean;
  limitsProgress: unknown[];
  defaultModelSlug: string | null;
  restoreAt: string | null;
  status: "active" | "limited";
};

const webSessionCache = new Map<string, WebSession>();

type WebProxyResponsePayload = {
  status: number;
  headers?: Record<string, string[]>;
  bodyBase64?: string;
};

type WebImageParams = (GenerateImageParams | EditImageParams) & {
  history?: ChatHistoryMessage[];
  files?: ResponsesInputFile[];
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Image generation timed out after 20 minutes");
  }
}

type WebContinuationState = ChatGptWebConversationState & {
  useNativeContinuation: boolean;
};

function getPrompt(params: WebImageParams) {
  if (params.promptOptimization === false) {
    return params.prompt;
  }
  return params.apiPrompt || params.prompt;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function aspectRatioFromSize(size?: string) {
  const normalized = size?.trim().toLowerCase();
  if (!normalized || normalized === "auto") return null;
  if (/^\d{1,3}:\d{1,3}$/.test(normalized)) return normalized;

  const dimensions = parseImageSize(normalized);
  if (!dimensions) return null;

  const divisor = gcd(dimensions.width, dimensions.height);
  return `${dimensions.width / divisor}:${dimensions.height / divisor}`;
}

function buildImageSizePrompt(size?: string) {
  const ratio = aspectRatioFromSize(size);
  if (!ratio) return null;

  const hints: Record<string, string> = {
    "1:1": "Output the image in a strict 1:1 square composition.",
    "16:9": "Output the image in a 16:9 landscape composition.",
    "9:16": "Output the image in a 9:16 portrait composition.",
    "4:3": "Output the image in a 4:3 composition.",
    "3:4": "Output the image in a 3:4 portrait composition.",
    "3:2": "Output the image in a 3:2 landscape composition.",
    "2:3": "Output the image in a 2:3 portrait composition.",
  };
  const hint = hints[ratio] || `Output the image with a ${ratio} aspect ratio.`;
  const normalized = size?.trim();
  if (!normalized || normalized === ratio) return hint;
  return `${hint} Target size requested by the API is ${normalized}.`;
}

function applyImageSizePrompt(prompt: string, size?: string) {
  const hint = buildImageSizePrompt(size);
  if (!hint) return prompt;
  return `${prompt.trim()}\n\n${hint}`;
}

function lastWebConversationState(
  history: ChatHistoryMessage[] | undefined,
  accountId?: string
): WebContinuationState | null {
  for (let index = (history || []).length - 1; index >= 0; index--) {
    const message = history?.[index];
    if (!message || message.role !== "assistant" || message.error) continue;
    const variants = message.variants || [];
    const variant = variants[message.activeVariant || 0] || variants[0];
    const state = variant?.webConversation;
    if (!state?.conversationId || !state.parentMessageId) continue;
    const sameAccount =
      !accountId || !state.accountId || state.accountId === accountId;
    return {
      ...state,
      useNativeContinuation: sameAccount,
    };
  }
  return null;
}

function getWebSession(config: ApiConfig) {
  const key = config.backend?.id || config.apiKey.slice(0, 24);
  const cached = webSessionCache.get(key);
  if (cached) return cached;
  const session = {
    deviceId: randomUUID(),
    sessionId: randomUUID(),
  };
  webSessionCache.set(key, session);
  return session;
}

function getWebSessionKey(config: ApiConfig) {
  return config.backend?.id || config.apiKey.slice(0, 24) || "default";
}

function encodeBody(body: BodyInit | null | undefined) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body).toString("base64");
  if (body instanceof Uint8Array) return Buffer.from(body).toString("base64");
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString("base64");
  throw new Error(
    "ChatGPT Web proxy only supports string and binary request bodies"
  );
}

function decodeBody(bodyBase64: string | undefined) {
  if (!bodyBase64) return new Uint8Array();
  return Buffer.from(bodyBase64, "base64");
}

async function webErrorMessage(response: Response, context: string) {
  const text = await response.text().catch(() => "");
  const extracted = extractWebErrorPayloadMessage(text);
  const trimmed = (extracted || text).replace(/\s+/g, " ").trim();
  return `${context} failed: HTTP ${response.status}${
    trimmed ? ` ${trimmed.slice(0, 500)}` : ""
  }`;
}

function extractWebErrorPayloadMessage(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    const payload = JSON.parse(trimmed) as unknown;
    const message = webErrorPayloadMessage(payload);
    if (message) return message;
  } catch {
    /* fall back to raw text */
  }
  return "";
}

function webErrorPayloadMessage(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  for (const key of ["detail", "message", "error_description", "code"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const error = record.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const nested = webErrorPayloadMessage(error);
    if (nested) return nested;
  }
  // ChatGPT web 流式增量(o/v 操作)会把真实错误文案包在 v 里(如 {"o":"add","v":{...}});
  // 像 error 一样递归取出,避免上层兜底把原始 o/v 协议分片当错误回显给用户。
  const value = record.v;
  if (value && typeof value === "object") {
    const nested = webErrorPayloadMessage(value);
    if (nested) return nested;
  }
  return "";
}

function headersToObject(headers: HeadersInit | undefined) {
  const result: Record<string, string> = {};
  if (!headers) return result;
  const source = new Headers(headers);
  source.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function toResponseHeaders(headers: WebProxyResponsePayload["headers"]) {
  const result = new Headers();
  for (const [key, values] of Object.entries(headers || {})) {
    if (key.toLowerCase() === "content-encoding") continue;
    for (const value of values) {
      result.append(key, value);
    }
  }
  return result;
}

async function getWebProxyConfig() {
  const rawUrl =
    (await getRuntimeSettingString("CHATGPT_WEB_PROXY_URL")) ||
    process.env.CHATGPT_WEB_PROXY_URL?.trim();
  const url = rawUrl?.replace(/\/+$/, "");
  if (!url) return null;
  return {
    url,
    secret:
      (await getRuntimeSettingString("CHATGPT_WEB_PROXY_SECRET")) ||
      process.env.CHATGPT_WEB_PROXY_SECRET?.trim() ||
      "",
  };
}

async function fetchChatGptWeb(
  config: ApiConfig,
  urlPath: string,
  targetPath: string,
  init?: RequestInit,
  extraHeaders?: Record<string, string>
) {
  const headers = {
    ...headersToObject(init?.headers),
    ...(extraHeaders || {}),
  };
  const proxy = await getWebProxyConfig();
  if (!proxy) {
    return fetch(`${CHATGPT_BASE_URL}${urlPath}`, {
      ...init,
      headers,
    });
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (init?.signal?.aborted) {
    controller.abort();
  } else {
    init?.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timeout = setTimeout(() => {
    controller.abort();
  }, WEB_PROXY_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${proxy.url}/request`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(proxy.secret ? { "X-Proxy-Secret": proxy.secret } : {}),
      },
      body: JSON.stringify({
        sessionKey: getWebSessionKey(config),
        method: init?.method || "GET",
        urlPath,
        targetPath,
        headers,
        headerOrder: Object.keys(headers),
        bodyBase64: encodeBody(init?.body),
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `ChatGPT Web proxy failed: HTTP ${response.status}${text ? ` ${text.slice(0, 300)}` : ""}`
      );
    }
    const payload = (await response.json()) as WebProxyResponsePayload;
    return new Response(decodeBody(payload.bodyBase64), {
      status: payload.status,
      headers: toResponseHeaders(payload.headers),
    });
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function powResourcesFromHtml(html: string): PowResources {
  const scriptSources =
    [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((value): value is string => Boolean(value)) || [];
  const htmlMatch = html.match(/<html[^>]*data-build="([^"]*)"/);
  const scriptMatch = html.match(/\/c\/[^/]+\/_/);
  return {
    scriptSources: scriptSources.length ? scriptSources : [DEFAULT_POW_SCRIPT],
    dataBuild: htmlMatch?.[1] || scriptMatch?.[0] || "",
  };
}

function legacyParseTime() {
  const now = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    now.getUTCDay()
  ];
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][now.getUTCMonth()];
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${weekday} ${month} ${pad(now.getUTCDate())} ${now.getUTCFullYear()} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} GMT-0500 (Eastern Standard Time)`;
}

function powConfig(resources: PowResources) {
  const scriptSource =
    resources.scriptSources[
      Math.floor(Math.random() * resources.scriptSources.length)
    ] || DEFAULT_POW_SCRIPT;
  return [
    3000,
    legacyParseTime(),
    4294705152,
    0,
    USER_AGENT,
    scriptSource,
    resources.dataBuild,
    "en-US",
    "en-US,es-US,en,es",
    0,
    "webdriver-false",
    "location",
    "navigator",
    performance.now(),
    randomUUID(),
    "",
    16,
    Date.now() - performance.now(),
  ];
}

function solvePow(seed: string, difficulty: string, config: unknown[]) {
  const target = Buffer.from(difficulty, "hex");
  const diffLen = Math.floor(difficulty.length / 2);
  const seedBuffer = Buffer.from(seed);
  const static1 = `${JSON.stringify(config.slice(0, 3)).slice(0, -1)},`;
  const static2 = `,${JSON.stringify(config.slice(4, 9)).slice(1, -1)},`;
  const static3 = `,${JSON.stringify(config.slice(10)).slice(1)}`;
  for (let index = 0; index < 500_000; index++) {
    const encoded = Buffer.from(
      `${static1}${index}${static2}${index >> 1}${static3}`
    ).toString("base64");
    const digest = createHash("sha3-512")
      .update(Buffer.concat([seedBuffer, Buffer.from(encoded)]))
      .digest();
    if (digest.subarray(0, diffLen).compare(target) <= 0) {
      return { token: encoded, solved: true };
    }
  }
  return {
    token: `wQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D${Buffer.from(`"${seed}"`).toString("base64")}`,
    solved: false,
  };
}

function buildLegacyRequirementsToken(resources: PowResources) {
  const seed = String(Math.random());
  const { token } = solvePow(seed, "0fffff", powConfig(resources));
  return `gAAAAAC${token}`;
}

function buildProofToken(data: {
  seed?: string;
  difficulty?: string;
  resources: PowResources;
}) {
  if (!data.seed || !data.difficulty) return "";
  const { token, solved } = solvePow(
    data.seed,
    data.difficulty,
    powConfig(data.resources)
  );
  if (!solved) {
    throw new Error(
      `failed to solve proof token: difficulty=${data.difficulty}`
    );
  }
  return `gAAAAAB${token}`;
}

function getHeaders(
  config: ApiConfig,
  path: string,
  extra?: Record<string, string>
) {
  const session = getWebSession(config);
  return {
    "User-Agent": USER_AGENT,
    Origin: CHATGPT_BASE_URL,
    Referer: `${CHATGPT_BASE_URL}/`,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Priority: "u=1, i",
    "Sec-Ch-Ua":
      '"Microsoft Edge";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
    "Sec-Ch-Ua-Arch": '"x86"',
    "Sec-Ch-Ua-Bitness": '"64"',
    "Sec-Ch-Ua-Full-Version": '"143.0.3650.96"',
    "Sec-Ch-Ua-Full-Version-List":
      '"Microsoft Edge";v="143.0.3650.96", "Chromium";v="143.0.7499.147", "Not A(Brand";v="24.0.0.0"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Model": '""',
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Ch-Ua-Platform-Version": '"19.0.0"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "OAI-Device-Id": session.deviceId,
    "OAI-Session-Id": session.sessionId,
    "OAI-Language": "zh-CN",
    "OAI-Client-Version": DEFAULT_CLIENT_VERSION,
    "OAI-Client-Build-Number": DEFAULT_CLIENT_BUILD_NUMBER,
    "X-OpenAI-Target-Path": path,
    "X-OpenAI-Target-Route": path,
    Authorization: `Bearer ${config.apiKey}`,
    ...extra,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function numberOrZero(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function extractQuotaAndRestoreAt(limitsProgress: unknown[]) {
  for (const item of limitsProgress) {
    const row = asRecord(item);
    if (row.feature_name === "image_gen") {
      return {
        quota: numberOrZero(row.remaining),
        restoreAt: stringOrNull(row.reset_after),
        imageQuotaUnknown: false,
      };
    }
  }
  return { quota: 0, restoreAt: null, imageQuotaUnknown: true };
}

async function fetchWebJson<T>(
  config: ApiConfig,
  urlPath: string,
  targetPath: string,
  init?: RequestInit,
  extraHeaders?: Record<string, string>
) {
  const response = await fetchChatGptWeb(
    config,
    urlPath,
    targetPath,
    init,
    getHeaders(config, targetPath, {
      Accept: "application/json",
      ...(extraHeaders || {}),
    })
  );
  if (!response.ok) {
    const message = `${targetPath} failed: HTTP ${response.status}`;
    if (response.status === 401) {
      throw new Error(`invalid access token: ${message}`);
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function getChatGptWebAccountInfo(
  config: ApiConfig
): Promise<ChatGptWebAccountInfo> {
  const mePath = "/backend-api/me";
  const initPath = "/backend-api/conversation/init";
  const accountPath = "/backend-api/accounts/check/v4-2023-04-27";
  const [mePayload, initPayload, accountPayload] = await Promise.all([
    fetchWebJson<Record<string, unknown>>(config, mePath, mePath),
    fetchWebJson<Record<string, unknown>>(
      config,
      initPath,
      initPath,
      {
        method: "POST",
        body: JSON.stringify({
          gizmo_id: null,
          requested_default_model: null,
          conversation_id: null,
          timezone_offset_min: -480,
        }),
      },
      { "Content-Type": "application/json" }
    ),
    fetchWebJson<Record<string, unknown>>(
      config,
      `${accountPath}?timezone_offset_min=-480`,
      accountPath
    ),
  ]);

  const accounts = asRecord(accountPayload.accounts);
  const defaultAccount = asRecord(asRecord(accounts.default).account);
  const planType = String(defaultAccount.plan_type || "free");
  const limitsProgress = Array.isArray(initPayload.limits_progress)
    ? initPayload.limits_progress
    : [];
  const { quota, restoreAt, imageQuotaUnknown } =
    extractQuotaAndRestoreAt(limitsProgress);

  return {
    email: stringOrNull(mePayload.email),
    userId: stringOrNull(mePayload.id),
    type: planType,
    quota,
    imageQuotaUnknown,
    limitsProgress,
    defaultModelSlug: stringOrNull(initPayload.default_model_slug),
    restoreAt,
    status:
      imageQuotaUnknown && planType.toLowerCase() !== "free"
        ? "active"
        : quota === 0
          ? "limited"
          : "active",
  };
}

async function bootstrap(config: ApiConfig) {
  const response = await fetchChatGptWeb(config, "/", "/", {
    signal: config.signal,
    headers: getHeaders(config, "/", {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }),
  });
  if (!response.ok) {
    throw new Error(await webErrorMessage(response, "ChatGPT Web bootstrap"));
  }
  return powResourcesFromHtml(await response.text());
}

async function getChatRequirements(config: ApiConfig) {
  const resources = await bootstrap(config);
  const path = "/backend-api/sentinel/chat-requirements";
  const response = await fetchChatGptWeb(config, path, path, {
    method: "POST",
    signal: config.signal,
    headers: getHeaders(config, path, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify({ p: buildLegacyRequirementsToken(resources) }),
  });
  if (!response.ok) {
    throw new Error(
      await webErrorMessage(response, "ChatGPT Web requirements")
    );
  }
  const data = (await response.json()) as {
    token?: string;
    proof_token?: string;
    so_token?: string;
    proofofwork?: {
      required?: boolean;
      seed?: string;
      difficulty?: string;
    };
  };
  if (!data.token) {
    throw new Error("ChatGPT Web requirements response missing token");
  }
  return {
    token: data.token,
    proofToken:
      data.proof_token ||
      (data.proofofwork?.required
        ? buildProofToken({
            seed: data.proofofwork.seed,
            difficulty: data.proofofwork.difficulty,
            resources,
          })
        : undefined),
    soToken: data.so_token,
  } satisfies ChatRequirements;
}

function imageDimensions(buffer: Buffer) {
  if (
    buffer.length >= 24 &&
    buffer.readUInt32BE(0) === 0x89504e47 &&
    buffer.toString("ascii", 12, 16) === "IHDR"
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  if (buffer.length >= 10 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1] ?? 0;
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }
  return { width: 1024, height: 1024 };
}

async function uploadAttachment(
  config: ApiConfig,
  file: ImageInputFile | ResponsesInputFile,
  index: number,
  options?: { image?: boolean }
) {
  const isImage = Boolean(options?.image);
  const dimensions = isImage ? imageDimensions(file.data) : null;
  const path = "/backend-api/files";
  const fileName =
    file.name || (isImage ? `image_${index}.png` : `file_${index}`);
  const createResponse = await fetchChatGptWeb(config, path, path, {
    method: "POST",
    signal: config.signal,
    headers: getHeaders(config, path, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify({
      file_name: fileName,
      file_size: file.data.length,
      use_case: "multimodal",
      ...(dimensions
        ? {
            width: dimensions.width,
            height: dimensions.height,
          }
        : {}),
    }),
  });
  if (!createResponse.ok) {
    throw new Error(
      await webErrorMessage(createResponse, "ChatGPT Web file create")
    );
  }
  const uploadMeta = (await createResponse.json()) as {
    file_id: string;
    upload_url: string;
  };
  const uploadResponse = await fetch(uploadMeta.upload_url, {
    method: "PUT",
    signal: config.signal,
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "x-ms-blob-type": "BlockBlob",
      "x-ms-version": "2020-04-08",
      Origin: CHATGPT_BASE_URL,
      Referer: `${CHATGPT_BASE_URL}/`,
      "User-Agent": USER_AGENT,
    },
    body: new Uint8Array(file.data),
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `ChatGPT Web file upload failed: HTTP ${uploadResponse.status}`
    );
  }
  const uploadedPath = `/backend-api/files/${uploadMeta.file_id}/uploaded`;
  const uploadedResponse = await fetchChatGptWeb(
    config,
    uploadedPath,
    uploadedPath,
    {
      method: "POST",
      signal: config.signal,
      headers: getHeaders(config, uploadedPath, {
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      body: "{}",
    }
  );
  if (!uploadedResponse.ok) {
    throw new Error(
      await webErrorMessage(uploadedResponse, "ChatGPT Web file finalize")
    );
  }
  return {
    file_id: uploadMeta.file_id,
    file_name: fileName,
    file_size: file.data.length,
    mime_type: file.type || "application/octet-stream",
    content_type: isImage ? "image_asset_pointer" : "file_asset_pointer",
    ...(dimensions
      ? {
          width: dimensions.width,
          height: dimensions.height,
        }
      : {}),
  } satisfies UploadedAttachment;
}

const DEFAULT_WEB_GPT_MODEL_SLUG = "gpt-5-3";

function webGptModelSlug(gptModel?: string) {
  return gptModel?.trim() || DEFAULT_WEB_GPT_MODEL_SLUG;
}

function webThinkingValue(
  thinking: ThinkingLevel | undefined,
  promptOptimization?: boolean
) {
  if (promptOptimization === false) return "instant";
  if (thinking === "minimal") return "instant";
  if (thinking === "none") return "instant";
  if (thinking === "xhigh") return "high";
  return thinking || "low";
}

function imageHeaders(
  config: ApiConfig,
  path: string,
  requirements: ChatRequirements,
  conduitToken?: string
) {
  return getHeaders(config, path, {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "OpenAI-Sentinel-Chat-Requirements-Token": requirements.token,
    ...(requirements.proofToken
      ? { "OpenAI-Sentinel-Proof-Token": requirements.proofToken }
      : {}),
    ...(requirements.turnstileToken
      ? { "OpenAI-Sentinel-Turnstile-Token": requirements.turnstileToken }
      : {}),
    ...(requirements.soToken
      ? { "OpenAI-Sentinel-SO-Token": requirements.soToken }
      : {}),
    ...(conduitToken ? { "X-Conduit-Token": conduitToken } : {}),
    "X-Oai-Turn-Trace-Id": randomUUID(),
  });
}

async function prepareImageConversation(
  config: ApiConfig,
  prompt: string,
  requirements: ChatRequirements,
  options: {
    gptModel?: string;
    thinking?: ThinkingLevel;
    promptOptimization?: boolean;
    continuation?: WebContinuationState | null;
    requestMessageId: string;
  }
) {
  const path = "/backend-api/f/conversation/prepare";
  const response = await fetchChatGptWeb(config, path, path, {
    method: "POST",
    signal: config.signal,
    headers: imageHeaders(config, path, requirements),
    body: JSON.stringify({
      action: "next",
      fork_from_shared_post: false,
      ...(options.continuation?.useNativeContinuation
        ? { conversation_id: options.continuation.conversationId }
        : {}),
      parent_message_id: options.continuation?.useNativeContinuation
        ? options.continuation.parentMessageId
        : randomUUID(),
      model: webGptModelSlug(options.gptModel),
      paragen_thinking_level: webThinkingValue(
        options.thinking,
        options.promptOptimization
      ),
      paragen_cot_summary_display_override: "allow",
      force_parallel_switch:
        options.promptOptimization === false ? "instant" : "auto",
      client_prepare_state: "success",
      timezone_offset_min: -480,
      timezone: "Asia/Shanghai",
      conversation_mode: { kind: "primary_assistant" },
      system_hints: ["picture_v2"],
      partial_query: {
        id: options.requestMessageId,
        author: { role: "user" },
        content: { content_type: "text", parts: [prompt] },
      },
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: { app_name: "chatgpt.com" },
    }),
  });
  if (!response.ok) {
    throw new Error(await webErrorMessage(response, "ChatGPT Web prepare"));
  }
  const data = (await response.json()) as { conduit_token?: string };
  return data.conduit_token || "";
}

function buildMessage(
  prompt: string,
  references: UploadedAttachment[],
  messageId: string
) {
  const parts = references.map((item) => ({
    content_type: item.content_type,
    asset_pointer: `file-service://${item.file_id}`,
    ...(item.width && item.height
      ? {
          width: item.width,
          height: item.height,
        }
      : {}),
    size_bytes: item.file_size,
    name: item.file_name,
    mime_type: item.mime_type,
  })) as Array<Record<string, unknown> | string>;
  parts.push(prompt);
  return {
    id: messageId,
    author: { role: "user" },
    create_time: Date.now() / 1000,
    content: references.length
      ? { content_type: "multimodal_text", parts }
      : { content_type: "text", parts: [prompt] },
    metadata: {
      system_hints: ["picture_v2"],
      serialization_metadata: { custom_symbol_offsets: [] },
      ...(references.length
        ? {
            attachments: references.map((item) => ({
              id: item.file_id,
              mimeType: item.mime_type,
              name: item.file_name,
              size: item.file_size,
              ...(item.width && item.height
                ? {
                    width: item.width,
                    height: item.height,
                  }
                : {}),
            })),
          }
        : {}),
    },
  };
}

async function startImageGeneration(
  config: ApiConfig,
  prompt: string,
  requirements: ChatRequirements,
  conduitToken: string,
  options: {
    gptModel?: string;
    thinking?: ThinkingLevel;
    promptOptimization?: boolean;
    continuation?: WebContinuationState | null;
    requestMessageId: string;
  },
  references: UploadedAttachment[]
) {
  const path = "/backend-api/f/conversation";
  const response = await fetchChatGptWeb(config, path, path, {
    method: "POST",
    signal: config.signal,
    headers: imageHeaders(config, path, requirements, conduitToken),
    body: JSON.stringify({
      action: "next",
      messages: [buildMessage(prompt, references, options.requestMessageId)],
      ...(options.continuation?.useNativeContinuation
        ? { conversation_id: options.continuation.conversationId }
        : {}),
      parent_message_id: options.continuation?.useNativeContinuation
        ? options.continuation.parentMessageId
        : randomUUID(),
      model: webGptModelSlug(options.gptModel),
      client_prepare_state: "sent",
      timezone_offset_min: -480,
      timezone: "Asia/Shanghai",
      conversation_mode: { kind: "primary_assistant" },
      enable_message_followups: true,
      system_hints: ["picture_v2"],
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: {
        is_dark_mode: false,
        time_since_loaded: 1200,
        page_height: 1072,
        page_width: 1724,
        pixel_ratio: 1.2,
        screen_height: 1440,
        screen_width: 2560,
        app_name: "chatgpt.com",
      },
      paragen_cot_summary_display_override: "allow",
      paragen_thinking_level: webThinkingValue(
        options.thinking,
        options.promptOptimization
      ),
      force_parallel_switch:
        options.promptOptimization === false ? "instant" : "auto",
    }),
  });
  if (!response.ok) {
    throw new Error(
      await webErrorMessage(response, "ChatGPT Web image request")
    );
  }
  return response;
}

async function readSseText(response: Response) {
  return response.text();
}

function extractConversationId(text: string) {
  const matches = [...text.matchAll(/"conversation_id"\s*:\s*"([^"]+)"/g)];
  return matches.at(-1)?.[1] || "";
}

function messageIdFromValue(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string") return record.id;
  const message = record.message;
  if (message && typeof message === "object") {
    const id = (message as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  return "";
}

function metadataString(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === "string"
    ? (value[key] as string)
    : "";
}

function messageMetadataFromValue(value: unknown) {
  if (!isRecord(value)) return {};
  if (isRecord(value.metadata)) return value.metadata;
  if (isRecord(value.message) && isRecord(value.message.metadata)) {
    return value.message.metadata;
  }
  return {};
}

function selectedImageMessageIdFromValue(value: unknown) {
  return metadataString(
    messageMetadataFromValue(value),
    "selected_image_message_id"
  );
}

function extractLastMessageId(text: string) {
  let messageId = "";
  const normalized = text.replace(/\r\n/g, "\n");
  for (const block of normalized.split("\n\n")) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]" || data === "v1") continue;
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    if (!payload || typeof payload !== "object") continue;
    const record = payload as Record<string, unknown>;
    const directId = messageIdFromValue(record);
    if (directId) messageId = directId;
    const valueId = messageIdFromValue(record.v);
    if (valueId) messageId = valueId;
    if (Array.isArray(record.v)) {
      for (const item of record.v) {
        const patchId = messageIdFromValue(
          item && typeof item === "object"
            ? (item as Record<string, unknown>).v
            : undefined
        );
        if (patchId) messageId = patchId;
      }
    }
  }
  return messageId;
}

function extractSelectionMessageId(text: string) {
  let selectionMessageId = "";
  const normalized = text.replace(/\r\n/g, "\n");
  for (const block of normalized.split("\n\n")) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]" || data === "v1") continue;
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    if (!isRecord(payload)) continue;
    const directSelected = selectedImageMessageIdFromValue(payload);
    const directId = messageIdFromValue(payload);
    if (directSelected && directId) selectionMessageId = directId;
    const valueSelected = selectedImageMessageIdFromValue(payload.v);
    const valueId = messageIdFromValue(payload.v);
    if (valueSelected && valueId) selectionMessageId = valueId;
    if (Array.isArray(payload.v)) {
      for (const item of payload.v) {
        const value = isRecord(item) ? item.v : undefined;
        const patchSelected = selectedImageMessageIdFromValue(value);
        const patchId = messageIdFromValue(value);
        if (patchSelected && patchId) selectionMessageId = patchId;
      }
    }
  }
  return selectionMessageId;
}

function extractImageIds(text: string) {
  const fileIds = new Set<string>();
  const sedimentIds = new Set<string>();
  for (const match of text.matchAll(/file-service:\/\/([A-Za-z0-9_-]+)/g)) {
    const id = match[1];
    if (id && id !== "file_upload") fileIds.add(id);
  }
  for (const match of text.matchAll(/sediment:\/\/([A-Za-z0-9_-]+)/g)) {
    if (match[1]) sedimentIds.add(match[1]);
  }
  return { fileIds: [...fileIds], sedimentIds: [...sedimentIds] };
}

type WebImageCandidate = {
  fileIds: string[];
  sedimentIds: string[];
  messageId?: string;
  groupId?: string;
  generationIndex?: number;
};

type WebImageIds = ReturnType<typeof extractImageIds>;

function emptyImageIds(): WebImageIds {
  return { fileIds: [], sedimentIds: [] };
}

function hasImageIds(ids: WebImageIds) {
  return ids.fileIds.length > 0 || ids.sedimentIds.length > 0;
}

function imageIdsFromCandidate(candidate: WebImageCandidate): WebImageIds {
  return {
    fileIds: candidate.fileIds,
    sedimentIds: candidate.sedimentIds,
  };
}

function mergeImageCandidates(candidates: WebImageCandidate[]) {
  const byKey = new Map<string, WebImageCandidate>();
  for (const candidate of candidates) {
    const ids = imageIdsFromCandidate(candidate);
    if (!hasImageIds(ids)) continue;
    const key =
      candidate.messageId ||
      `${candidate.fileIds.join(",")}|${candidate.sedimentIds.join(",")}`;
    const previous = byKey.get(key);
    byKey.set(key, {
      fileIds: dedupeStrings([
        ...(previous?.fileIds || []),
        ...candidate.fileIds,
      ]),
      sedimentIds: dedupeStrings([
        ...(previous?.sedimentIds || []),
        ...candidate.sedimentIds,
      ]),
      messageId: candidate.messageId || previous?.messageId,
      groupId: candidate.groupId || previous?.groupId,
      generationIndex: candidate.generationIndex ?? previous?.generationIndex,
    });
  }
  return [...byKey.values()].sort((left, right) => {
    const leftIndex = left.generationIndex ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = right.generationIndex ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return 0;
  });
}

function dedupeStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function mergeImageIds(...items: WebImageIds[]) {
  return {
    fileIds: dedupeStrings(items.flatMap((item) => item.fileIds)),
    sedimentIds: dedupeStrings(items.flatMap((item) => item.sedimentIds)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getConversationMapping(data: unknown) {
  if (!isRecord(data) || !isRecord(data.mapping)) return null;
  return data.mapping;
}

function conversationNodeParentId(node: unknown) {
  if (!isRecord(node)) return "";
  if (typeof node.parent === "string") return node.parent;
  if (typeof node.parent_id === "string") return node.parent_id;
  const message = node.message;
  if (isRecord(message) && isRecord(message.metadata)) {
    const parentId = message.metadata.parent_id;
    if (typeof parentId === "string") return parentId;
  }
  return "";
}

function conversationNodeId(node: unknown, fallbackId = "") {
  if (!isRecord(node)) return fallbackId;
  if (isRecord(node.message) && typeof node.message.id === "string") {
    return node.message.id;
  }
  if (typeof node.id === "string") return node.id;
  return fallbackId;
}

function conversationNodeCreateTime(node: unknown) {
  if (!isRecord(node)) return null;
  const direct = Number(node.create_time);
  if (Number.isFinite(direct)) return direct;
  if (isRecord(node.message)) {
    const messageCreateTime = Number(node.message.create_time);
    if (Number.isFinite(messageCreateTime)) return messageCreateTime;
  }
  return null;
}

function directConversationChildren(
  mapping: Record<string, unknown>,
  parentId: string
) {
  const ids = new Set<string>();
  const parentNode = mapping[parentId];
  if (isRecord(parentNode) && Array.isArray(parentNode.children)) {
    for (const child of parentNode.children) {
      if (typeof child === "string") ids.add(child);
    }
  }
  for (const [id, node] of Object.entries(mapping)) {
    if (conversationNodeParentId(node) === parentId) ids.add(id);
  }
  return [...ids];
}

function descendantConversationNodes(
  mapping: Record<string, unknown>,
  parentId: string
) {
  const nodes: Array<{ id: string; node: unknown }> = [];
  const queue = directConversationChildren(mapping, parentId);
  const seen = new Set<string>([parentId]);
  while (queue.length) {
    const id = queue.shift() || "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = mapping[id];
    if (!node) continue;
    nodes.push({ id, node });
    queue.push(...directConversationChildren(mapping, id));
  }
  return nodes;
}

function findConversationNode(
  mapping: Record<string, unknown>,
  messageId: string
) {
  if (!messageId) return null;
  if (mapping[messageId]) {
    return { id: messageId, node: mapping[messageId] };
  }
  for (const [id, node] of Object.entries(mapping)) {
    if (conversationNodeId(node, id) === messageId) return { id, node };
  }
  return null;
}

function conversationNodesAfterCreateTime(
  mapping: Record<string, unknown>,
  requestMessageId: string
) {
  const request = findConversationNode(mapping, requestMessageId);
  const requestCreateTime = conversationNodeCreateTime(request?.node);
  if (requestCreateTime === null) return [];

  return Object.entries(mapping)
    .filter(([id, node]) => {
      const nodeId = conversationNodeId(node, id);
      if (request && id === request.id) return false;
      if (nodeId === requestMessageId) return false;
      const createTime = conversationNodeCreateTime(node);
      return createTime !== null && createTime >= requestCreateTime;
    })
    .sort(([, left], [, right]) => {
      const leftTime = conversationNodeCreateTime(left) ?? 0;
      const rightTime = conversationNodeCreateTime(right) ?? 0;
      return leftTime - rightTime;
    })
    .map(([id, node]) => ({ id, node }));
}

function mergeConversationNodes(
  ...lists: Array<Array<{ id: string; node: unknown }>>
) {
  const merged: Array<{ id: string; node: unknown }> = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const item of list) {
      const id = conversationNodeId(item.node, item.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(item);
    }
  }
  return merged;
}

function conversationNodesAfterMessage(
  conversationText: string,
  requestMessageId: string
) {
  if (!conversationText || !requestMessageId) return [];
  let data: unknown;
  try {
    data = JSON.parse(conversationText);
  } catch {
    return [];
  }
  const mapping = getConversationMapping(data);
  if (!mapping) return [];

  const currentNode =
    isRecord(data) && typeof data.current_node === "string"
      ? data.current_node
      : "";
  const chain: Array<{ id: string; node: unknown }> = [];
  const seen = new Set<string>();
  let cursor = currentNode;
  let reachedRequest = false;
  while (cursor && !seen.has(cursor)) {
    if (cursor === requestMessageId) {
      reachedRequest = true;
      break;
    }
    seen.add(cursor);
    const node = mapping[cursor];
    if (!node) break;
    chain.push({ id: cursor, node });
    cursor = conversationNodeParentId(node);
  }
  const request = findConversationNode(mapping, requestMessageId);
  const descendantNodes = descendantConversationNodes(
    mapping,
    request?.id || requestMessageId
  );
  const temporalNodes = conversationNodesAfterCreateTime(
    mapping,
    requestMessageId
  );

  return mergeConversationNodes(
    reachedRequest ? chain.reverse() : [],
    descendantNodes,
    temporalNodes
  );
}

function scopedConversationTextAfterMessage(
  conversationText: string,
  requestMessageId: string
) {
  return conversationNodesAfterMessage(conversationText, requestMessageId)
    .map(({ node }) => JSON.stringify(node))
    .join("\n");
}

function imageIdsFromJson(value: unknown): WebImageIds {
  return extractImageIds(JSON.stringify(value));
}

function imageCandidateFromConversationNode(
  id: string,
  node: unknown
): WebImageCandidate | null {
  const ids = imageIdsFromJson(node);
  if (!hasImageIds(ids)) return null;
  const metadata = messageMetadataFromValue(node);
  const generationIndex = Number(metadata.generation_index);
  return {
    ...ids,
    messageId: conversationNodeId(node, id),
    groupId: metadataString(metadata, "image_gen_group_id"),
    generationIndex: Number.isFinite(generationIndex)
      ? generationIndex
      : undefined,
  };
}

function imageCandidatesAfterMessage(
  conversationText: string,
  requestMessageId: string
) {
  return mergeImageCandidates(
    conversationNodesAfterMessage(conversationText, requestMessageId).flatMap(
      ({ id, node }) => {
        const candidate = imageCandidateFromConversationNode(id, node);
        return candidate ? [candidate] : [];
      }
    )
  );
}

function imageSelectionAfterMessage(
  conversationText: string,
  requestMessageId: string
) {
  for (const { id, node } of conversationNodesAfterMessage(
    conversationText,
    requestMessageId
  )) {
    const selectedImageMessageId = selectedImageMessageIdFromValue(node);
    const messageId = conversationNodeId(node, id);
    if (selectedImageMessageId && messageId) {
      return { messageId, selectedImageMessageId };
    }
  }
  return { messageId: "", selectedImageMessageId: "" };
}

function latestConversationMessageIdAfter(
  conversationText: string,
  requestMessageId: string
) {
  const nodes = conversationNodesAfterMessage(
    conversationText,
    requestMessageId
  );
  const latest = nodes.at(-1);
  return latest ? conversationNodeId(latest.node, latest.id) : "";
}

/**
 * 从 ChatGPT web 流式增量(o/v 操作)里抽出"系统错误"消息(content_type=system_error)。
 *
 * WHY:ChatGPT 无法调用画图工具时不会返回图片,而是塞一条 author.role="tool"、
 * content.content_type="system_error" 的消息(典型 name=ChatGPTAgentToolRateLimitException,
 * 即 image_gen.text2im 工具被账号级限流)。若不在此抽出,下游只会看到 "no image output",
 * 既无法归类为限流(短冷却 + 换号重试),也丢失可读原因与 SLA 可观测性。
 * 返回 name + text 拼接;name 一定在首个 add 分片里,即使 text 后续才 append 也够归类。
 */
function extractWebSystemError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const content = record.content;
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (c.content_type === "system_error") {
      const name = typeof c.name === "string" ? c.name : "";
      const text =
        typeof c.text === "string"
          ? c.text
          : Array.isArray(c.parts)
            ? c.parts
                .filter((part): part is string => typeof part === "string")
                .join(" ")
            : "";
      const combined = `${name} ${text}`.replace(/\s+/g, " ").trim();
      if (combined) return combined.slice(0, 500);
    }
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      const nested = extractWebSystemError(value);
      if (nested) return nested;
    }
  }
  return "";
}

function extractWebStreamError(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  for (const block of normalized.split("\n\n")) {
    if (!block.trim()) continue;
    let eventName = "";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const separatorIndex = line.indexOf(":");
      const field =
        separatorIndex === -1 ? line : line.slice(0, separatorIndex);
      const rawValue =
        separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
      if (field === "event") eventName = value;
      if (field === "data") dataLines.push(value);
    }
    const data = dataLines.join("\n").trim();
    if (!data || data === "[DONE]") continue;
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      payload = null;
    }
    // 系统错误(工具限流等)优先抽出:它代表本次确定性失败,且要让下游按限流归类,
    // 不能落到 "no image output" 兜底。
    const systemError = payload ? extractWebSystemError(payload) : "";
    if (systemError) return systemError;
    const message = payload ? webErrorPayloadMessage(payload) : "";
    const code =
      typeof payload?.code === "string"
        ? payload.code
        : payload?.error &&
            typeof payload.error === "object" &&
            "code" in payload.error &&
            typeof (payload.error as { code?: unknown }).code === "string"
          ? (payload.error as { code: string }).code
          : "";
    if (
      eventName.toLowerCase().includes("error") ||
      String(payload?.type || "")
        .toLowerCase()
        .includes("error") ||
      /usage limit|usage_limit|rate limit|rate_limit|too many requests|quota|limit has been reached|limit_reached|billing_hard_limit/i.test(
        `${message} ${code} ${data}`
      )
    ) {
      // 抽到可读字段才返回;否则绝不回显原始 o/v 协议分片(那会把
      // {"o":"add","v":{...}} 整段甩给用户)。落到下方按全文抽取限流/配额关键词短语。
      if (message || code) return message || code;
    }
  }
  const match = text.match(
    /(usage limit[^"\n]*|usage_limit[^"\n]*|limit has been reached[^"\n]*|limit_reached[^"\n]*|rate limit[^"\n]*|rate_limit[^"\n]*|too many requests[^"\n]*|(?:the )?quota (?:has been )?exceeded[^"\n]*|billing_hard_limit[^"\n]*)/i
  );
  return match?.[1] || "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getConversationText(
  config: ApiConfig,
  conversationId: string,
  signal?: AbortSignal
) {
  const path = `/backend-api/conversation/${conversationId}`;
  const response = await fetchChatGptWeb(config, path, path, {
    signal,
    headers: getHeaders(config, path, { Accept: "application/json" }),
  });
  if (!response.ok) {
    throw new Error(await webErrorMessage(response, "ChatGPT Web conversation"));
  }
  return JSON.stringify(await response.json());
}

function latestConversationMessageId(text: string) {
  if (!text) return "";
  try {
    const data = JSON.parse(text) as { current_node?: unknown };
    if (typeof data.current_node === "string") return data.current_node;
  } catch {
    /* fall back to scanning below */
  }
  const idMatches = [...text.matchAll(/"id"\s*:\s*"([^"]+)"/g)];
  return idMatches.at(-1)?.[1] || "";
}

async function pollImageIds(
  config: ApiConfig,
  conversationId: string,
  requestMessageId?: string,
  signal?: AbortSignal
) {
  const deadline = Date.now() + IMAGE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const text = await getConversationText(config, conversationId, signal);
    const scopedText = requestMessageId
      ? scopedConversationTextAfterMessage(text, requestMessageId)
      : text;
    const ids = extractImageIds(scopedText);
    if (hasImageIds(ids)) {
      return {
        ids,
        parentMessageId: requestMessageId
          ? latestConversationMessageIdAfter(text, requestMessageId)
          : latestConversationMessageId(text),
      };
    }
    await sleep(IMAGE_POLL_INTERVAL_MS);
  }
  return { ids: emptyImageIds(), parentMessageId: "" };
}

async function pollImageCandidates(
  config: ApiConfig,
  conversationId: string,
  requestMessageId: string,
  signal?: AbortSignal
) {
  const deadline = Date.now() + IMAGE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const text = await getConversationText(config, conversationId, signal);
    const candidates = imageCandidatesAfterMessage(text, requestMessageId);
    if (candidates.length) {
      const selection = imageSelectionAfterMessage(text, requestMessageId);
      return {
        candidates,
        selectionMessageId: selection.messageId,
        selectedImageMessageId: selection.selectedImageMessageId,
        parentMessageId: latestConversationMessageIdAfter(
          text,
          requestMessageId
        ),
      };
    }
    await sleep(IMAGE_POLL_INTERVAL_MS);
  }
  return { candidates: [], parentMessageId: "" };
}

async function getDownloadUrl(
  config: ApiConfig,
  path: string,
  signal?: AbortSignal
) {
  const response = await fetchChatGptWeb(config, path, path, {
    signal,
    headers: getHeaders(config, path, { Accept: "application/json" }),
  });
  if (!response.ok) {
    throw new Error(await webErrorMessage(response, "ChatGPT Web image lookup"));
  }
  const data = (await response.json()) as {
    download_url?: string;
    url?: string;
  };
  return data.download_url || data.url || "";
}

async function resolveImageUrls(
  config: ApiConfig,
  conversationId: string,
  ids: WebImageIds,
  requestMessageId?: string,
  signal?: AbortSignal
) {
  const polled =
    conversationId && requestMessageId
      ? await pollImageIds(config, conversationId, requestMessageId, signal)
      : null;
  const scopedHasIds = hasImageIds(polled?.ids || emptyImageIds());
  const shouldPollUnscoped =
    conversationId && !requestMessageId && !hasImageIds(ids) && !scopedHasIds;
  const unscopedPolled =
    !polled && shouldPollUnscoped
      ? await pollImageIds(config, conversationId, undefined, signal)
      : null;
  const resolvedIds = scopedHasIds
    ? mergeImageIds(polled?.ids || emptyImageIds(), ids)
    : hasImageIds(unscopedPolled?.ids || emptyImageIds())
      ? unscopedPolled?.ids || ids
      : ids;
  const urls: string[] = [];
  for (const fileId of resolvedIds.fileIds) {
    const url = await getDownloadUrl(
      config,
      `/backend-api/files/${fileId}/download`,
      signal
    );
    if (url) urls.push(url);
  }
  const uniqueUrls = dedupeStrings(urls);
  if (urls.length || !conversationId) {
    return {
      urls: uniqueUrls,
      parentMessageId:
        polled?.parentMessageId || unscopedPolled?.parentMessageId || "",
    };
  }
  for (const sedimentId of resolvedIds.sedimentIds) {
    const url = await getDownloadUrl(
      config,
      `/backend-api/conversation/${conversationId}/attachment/${sedimentId}/download`,
      signal
    );
    if (url) urls.push(url);
  }
  return {
    urls: dedupeStrings(urls),
    parentMessageId:
      polled?.parentMessageId || unscopedPolled?.parentMessageId || "",
  };
}

async function resolveImageCandidateUrls(
  config: ApiConfig,
  conversationId: string,
  streamIds: WebImageIds,
  requestMessageId?: string,
  signal?: AbortSignal
) {
  const polled =
    conversationId && requestMessageId
      ? await pollImageCandidates(
          config,
          conversationId,
          requestMessageId,
          signal
        )
      : null;
  const candidates = polled?.candidates.length
    ? polled.candidates
    : hasImageIds(streamIds)
      ? [{ ...streamIds }]
      : [];
  const outputs: Array<{
    url: string;
    messageId?: string;
    groupId?: string;
    generationIndex?: number;
  }> = [];

  for (const candidate of mergeImageCandidates(candidates)) {
    const urls: string[] = [];
    for (const fileId of candidate.fileIds) {
      const url = await getDownloadUrl(
        config,
        `/backend-api/files/${fileId}/download`,
        signal
      );
      if (url) urls.push(url);
    }
    for (const sedimentId of candidate.sedimentIds) {
      const url = await getDownloadUrl(
        config,
        `/backend-api/conversation/${conversationId}/attachment/${sedimentId}/download`,
        signal
      );
      if (url) urls.push(url);
    }
    for (const url of dedupeStrings(urls)) {
      outputs.push({
        url,
        messageId: candidate.messageId,
        groupId: candidate.groupId,
        generationIndex: candidate.generationIndex,
      });
    }
  }

  if (!outputs.length) {
    const fallback = await resolveImageUrls(
      config,
      conversationId,
      streamIds,
      requestMessageId,
      signal
    );
    for (const url of fallback.urls) outputs.push({ url });
    return {
      outputs,
      selectionMessageId: polled?.selectionMessageId || "",
      selectedImageMessageId: polled?.selectedImageMessageId || "",
      parentMessageId: fallback.parentMessageId,
    };
  }

  return {
    outputs,
    selectionMessageId: polled?.selectionMessageId || "",
    selectedImageMessageId: polled?.selectedImageMessageId || "",
    parentMessageId: polled?.parentMessageId || "",
  };
}

async function downloadImage(
  config: ApiConfig,
  url: string,
  signal?: AbortSignal
) {
  const response = await fetch(url, {
    signal,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "User-Agent": USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(
      `ChatGPT Web image download failed: HTTP ${response.status}`
    );
  }
  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

async function downloadImageOutputs(
  config: ApiConfig,
  images: Array<{
    url: string;
    messageId?: string;
    groupId?: string;
    generationIndex?: number;
  }>,
  signal?: AbortSignal
) {
  const outputs: NonNullable<GenerateImageResult["imageOutputs"]> = [];
  const seenUrls = new Set<string>();
  for (const image of images) {
    if (!image.url || seenUrls.has(image.url)) continue;
    seenUrls.add(image.url);
    try {
      outputs.push({
        imageBase64: await downloadImage(config, image.url, signal),
        webImageMessageId: image.messageId,
        webImageGroupId: image.groupId,
        index: outputs.length,
        outputRole: images.length > 1 ? "choice" : "final",
      });
    } catch (error) {
      logError(error, {
        source: "chatgpt-web-image-download",
        backendId: config.backend?.id,
      });
    }
  }
  return outputs;
}

// 在飞「续接对话」占用集合:同一 ChatGPT 会话同一时刻只允许一个请求续接。并发的同提示
// 请求(读到同一旧会话状态)只放行第一个续接,其余强制开新对话,避免同时从同一节点分叉、
// 产出几乎一样的图。进程内即可:线上正常流量全打主副本(3308),备副本仅 failover 启用。
const inflightWebContinuations = new Set<string>();

async function runWebImage(
  config: ApiConfig,
  params: WebImageParams,
  images: ImageInputFile[]
): Promise<GenerateImageResult> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 20 * 60 * 1000);
  // 本次若成功占用某会话续接,记下其 id,在 finally 释放。
  let claimedWebConversationId: string | null = null;
  try {
    const configWithSignal = { ...config, signal: abortController.signal };
    const requestMessageId = randomUUID();
    let continuation = lastWebConversationState(
      params.history,
      config.backend?.id
    );
    // 并发互斥:该会话已被在飞请求占用则本次改开新对话(continuation=null);后续逻辑
    // (含重新附带历史参考图)沿用既有的 null 分支,故新对话仍会带上 @图 参考图。
    if (continuation?.useNativeContinuation && continuation.conversationId) {
      if (inflightWebContinuations.has(continuation.conversationId)) {
        continuation = null;
      } else {
        inflightWebContinuations.add(continuation.conversationId);
        claimedWebConversationId = continuation.conversationId;
      }
    }
    const historyReference = continuation?.useNativeContinuation
      ? null
      : getLatestWebHistoryImageReference(params.history);
    const prompt = applyImageSizePrompt(getPrompt(params), params.size);
    const historyImage = historyReference
      ? await downloadWebHistoryImageReference(historyReference, {
          signal: abortController.signal,
        })
      : null;
    const references = [
      ...(await Promise.all(
        images.map((image, index) =>
          uploadAttachment(configWithSignal, image, index + 1, {
            image: true,
          })
        )
      )),
      ...(historyImage
        ? [
            await uploadAttachment(
              configWithSignal,
              historyImage,
              images.length + 1,
              { image: true }
            ),
          ]
        : []),
      ...(await Promise.all(
        (params.files || []).map((file, index) =>
          uploadAttachment(
            configWithSignal,
            file,
            images.length + (historyImage ? 1 : 0) + index + 1
          )
        )
      )),
    ];
    const requirements = await getChatRequirements(configWithSignal);
    const conduitToken = await prepareImageConversation(
      configWithSignal,
      prompt,
      requirements,
      {
        gptModel: params.gptModel,
        thinking: params.thinking,
        promptOptimization: params.promptOptimization,
        continuation,
        requestMessageId,
      }
    );
    const response = await startImageGeneration(
      configWithSignal,
      prompt,
      requirements,
      conduitToken,
      {
        gptModel: params.gptModel,
        thinking: params.thinking,
        promptOptimization: params.promptOptimization,
        continuation,
        requestMessageId,
      },
      references
    );
    const text = await readSseText(response);
    throwIfAborted(abortController.signal);
    const streamError = extractWebStreamError(text);
    if (streamError) {
      return { error: streamError };
    }
    const conversationId = extractConversationId(text);
    let parentMessageId = extractLastMessageId(text);
    const selectionMessageIdFromStream = extractSelectionMessageId(text);
    const ids = extractImageIds(text);
    const resolved = await resolveImageCandidateUrls(
      configWithSignal,
      conversationId,
      ids,
      requestMessageId,
      abortController.signal
    );
    const candidateImages = resolved.outputs;
    parentMessageId = resolved.parentMessageId || parentMessageId;
    if (conversationId && !parentMessageId) {
      parentMessageId = latestConversationMessageId(
        await getConversationText(
          configWithSignal,
          conversationId,
          abortController.signal
        )
      );
    }
    if (!candidateImages[0]?.url) {
      return { error: "ChatGPT Web backend returned no image output" };
    }
    const imageOutputs = await downloadImageOutputs(
      configWithSignal,
      candidateImages,
      abortController.signal
    );
    if (!imageOutputs[0]?.imageBase64) {
      return { error: "ChatGPT Web backend returned no downloadable image" };
    }
    const selectionMessageId =
      selectionMessageIdFromStream || resolved.selectionMessageId || "";
    const selectedImageMessageId =
      resolved.selectedImageMessageId || imageOutputs[0].webImageMessageId;
    return {
      imageBase64: imageOutputs[0].imageBase64,
      imageOutputs,
      imageOutputCount: imageOutputs.length,
      ...(conversationId && parentMessageId
        ? {
            webConversation: {
              conversationId,
              parentMessageId,
              accountId: config.backend?.id,
              apiKeyId: config.backend?.apiKeyId,
              selectionMessageId,
              selectedImageMessageId,
            },
          }
        : {}),
    };
  } catch (error) {
    logError(error, {
      source: "chatgpt-web-image",
      backendId: config.backend?.id,
      requestKind: config.backend?.requestKind,
    });
    return {
      error:
        error instanceof Error ? error.message : "ChatGPT Web image failed",
    };
  } finally {
    clearTimeout(timeout);
    if (claimedWebConversationId) {
      inflightWebContinuations.delete(claimedWebConversationId);
    }
  }
}

export async function generateImageWithChatGptWeb(
  config: ApiConfig,
  params: GenerateImageParams
) {
  return runWebImage(config, params, []);
}

export async function editImageWithChatGptWeb(
  config: ApiConfig,
  params: EditImageParams
) {
  return runWebImage(config, params, params.images);
}

export async function selectChatGptWebImageCandidate(params: {
  config: ApiConfig;
  conversationId: string;
  messageId: string;
  selectedImageMessageId: string;
}) {
  const path = "/backend-api/image-gen/message-select";
  const response = await fetchChatGptWeb(params.config, path, path, {
    method: "POST",
    signal: params.config.signal,
    headers: getHeaders(params.config, path, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify({
      message_id: params.messageId,
      selected_image_message_id: params.selectedImageMessageId,
      conversation_id: params.conversationId,
    }),
  });
  if (!response.ok) {
    throw new Error(
      await webErrorMessage(response, "ChatGPT Web image select")
    );
  }
  return true;
}

export const __testing__ = {
  extractWebErrorPayloadMessage,
  extractWebStreamError,
  extractWebSystemError,
  imageCandidatesAfterMessage,
  imageSelectionAfterMessage,
  conversationNodesAfterMessage,
  extractImageIds,
  extractSelectionMessageId,
  scopedConversationTextAfterMessage,
};
