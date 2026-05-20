import { createHash, randomUUID } from "node:crypto";
import { logError } from "@repo/shared/logger";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import type {
  ApiConfig,
  EditImageParams,
  GenerateImageParams,
  GenerateImageResult,
  ImageInputFile,
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

type UploadedImage = {
  file_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  width: number;
  height: number;
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

function getPrompt(params: GenerateImageParams | EditImageParams) {
  if (params.promptOptimization === false) {
    return params.prompt;
  }
  return params.apiPrompt || params.prompt;
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
  const trimmed = text.replace(/\s+/g, " ").trim();
  return `${context} failed: HTTP ${response.status}${
    trimmed ? ` ${trimmed.slice(0, 500)}` : ""
  }`;
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

async function uploadImage(
  config: ApiConfig,
  image: ImageInputFile,
  index: number
) {
  const dimensions = imageDimensions(image.data);
  const path = "/backend-api/files";
  const fileName = image.name || `image_${index}.png`;
  const createResponse = await fetchChatGptWeb(config, path, path, {
    method: "POST",
    headers: getHeaders(config, path, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify({
      file_name: fileName,
      file_size: image.data.length,
      use_case: "multimodal",
      width: dimensions.width,
      height: dimensions.height,
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
    headers: {
      "Content-Type": image.type || "image/png",
      "x-ms-blob-type": "BlockBlob",
      "x-ms-version": "2020-04-08",
      Origin: CHATGPT_BASE_URL,
      Referer: `${CHATGPT_BASE_URL}/`,
      "User-Agent": USER_AGENT,
    },
    body: new Uint8Array(image.data),
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
    file_size: image.data.length,
    mime_type: image.type || "image/png",
    width: dimensions.width,
    height: dimensions.height,
  } satisfies UploadedImage;
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
  }
) {
  const path = "/backend-api/f/conversation/prepare";
  const response = await fetchChatGptWeb(config, path, path, {
    method: "POST",
    headers: imageHeaders(config, path, requirements),
    body: JSON.stringify({
      action: "next",
      fork_from_shared_post: false,
      parent_message_id: randomUUID(),
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
        id: randomUUID(),
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

function buildMessage(prompt: string, references: UploadedImage[]) {
  const parts = references.map((item) => ({
    content_type: "image_asset_pointer",
    asset_pointer: `file-service://${item.file_id}`,
    width: item.width,
    height: item.height,
    size_bytes: item.file_size,
  })) as Array<Record<string, unknown> | string>;
  parts.push(prompt);
  return {
    id: randomUUID(),
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
              width: item.width,
              height: item.height,
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
  },
  references: UploadedImage[]
) {
  const path = "/backend-api/f/conversation";
  const response = await fetchChatGptWeb(config, path, path, {
    method: "POST",
    headers: imageHeaders(config, path, requirements, conduitToken),
    body: JSON.stringify({
      action: "next",
      messages: [buildMessage(prompt, references)],
      parent_message_id: randomUUID(),
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
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.error === "string"
          ? payload.error
          : payload?.error &&
              typeof payload.error === "object" &&
              "message" in payload.error &&
              typeof (payload.error as { message?: unknown }).message ===
                "string"
            ? (payload.error as { message: string }).message
            : "";
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
      return message || code || data.replace(/\s+/g, " ").slice(0, 500);
    }
  }
  const match = text.match(
    /(usage limit[^"\n]*|usage_limit[^"\n]*|limit has been reached[^"\n]*|limit_reached[^"\n]*|rate limit[^"\n]*|rate_limit[^"\n]*|too many requests[^"\n]*|quota exceeded[^"\n]*|billing_hard_limit[^"\n]*)/i
  );
  return match?.[1] || "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getConversationText(config: ApiConfig, conversationId: string) {
  const path = `/backend-api/conversation/${conversationId}`;
  const response = await fetchChatGptWeb(config, path, path, {
    headers: getHeaders(config, path, { Accept: "application/json" }),
  });
  if (!response.ok) return "";
  return JSON.stringify(await response.json());
}

async function pollImageIds(config: ApiConfig, conversationId: string) {
  const deadline = Date.now() + IMAGE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const text = await getConversationText(config, conversationId);
    const ids = extractImageIds(text);
    if (ids.fileIds.length || ids.sedimentIds.length) {
      return ids;
    }
    await sleep(IMAGE_POLL_INTERVAL_MS);
  }
  return { fileIds: [], sedimentIds: [] };
}

async function getDownloadUrl(config: ApiConfig, path: string) {
  const response = await fetchChatGptWeb(config, path, path, {
    headers: getHeaders(config, path, { Accept: "application/json" }),
  });
  if (!response.ok) return "";
  const data = (await response.json()) as {
    download_url?: string;
    url?: string;
  };
  return data.download_url || data.url || "";
}

async function resolveImageUrls(
  config: ApiConfig,
  conversationId: string,
  ids: ReturnType<typeof extractImageIds>
) {
  const resolvedIds =
    conversationId && !ids.fileIds.length && !ids.sedimentIds.length
      ? await pollImageIds(config, conversationId)
      : ids;
  const urls: string[] = [];
  for (const fileId of resolvedIds.fileIds) {
    const url = await getDownloadUrl(
      config,
      `/backend-api/files/${fileId}/download`
    );
    if (url) urls.push(url);
  }
  if (urls.length || !conversationId) return urls;
  for (const sedimentId of resolvedIds.sedimentIds) {
    const url = await getDownloadUrl(
      config,
      `/backend-api/conversation/${conversationId}/attachment/${sedimentId}/download`
    );
    if (url) urls.push(url);
  }
  return urls;
}

async function downloadImage(config: ApiConfig, url: string) {
  const response = await fetch(url, {
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

async function runWebImage(
  config: ApiConfig,
  params: GenerateImageParams | EditImageParams,
  images: ImageInputFile[]
): Promise<GenerateImageResult> {
  try {
    const prompt = getPrompt(params);
    const references = await Promise.all(
      images.map((image, index) => uploadImage(config, image, index + 1))
    );
    const requirements = await getChatRequirements(config);
    const conduitToken = await prepareImageConversation(
      config,
      prompt,
      requirements,
      {
        gptModel: params.gptModel,
        thinking: params.thinking,
        promptOptimization: params.promptOptimization,
      }
    );
    const response = await startImageGeneration(
      config,
      prompt,
      requirements,
      conduitToken,
      {
        gptModel: params.gptModel,
        thinking: params.thinking,
        promptOptimization: params.promptOptimization,
      },
      references
    );
    const text = await readSseText(response);
    const streamError = extractWebStreamError(text);
    if (streamError) {
      return { error: streamError };
    }
    const conversationId = extractConversationId(text);
    const ids = extractImageIds(text);
    const urls = await resolveImageUrls(config, conversationId, ids);
    if (!urls[0]) {
      return { error: "ChatGPT Web backend returned no image output" };
    }
    return { imageBase64: await downloadImage(config, urls[0]) };
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
