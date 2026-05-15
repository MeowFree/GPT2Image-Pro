import { db } from "@repo/database";
import { userApiConfig } from "@repo/database/schema";
import { logError } from "@repo/shared/logger";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import {
  canUseCustomApi,
  GPT54_CHAT_MODEL,
  GPT55_CHAT_MODEL,
} from "@repo/shared/config/subscription-plan";
import { eq } from "drizzle-orm";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  normalizeImageModel,
  parseImageSize,
} from "./resolution";
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
  return (
    normalizeImageModel(model) ||
    normalizeImageModel(config.model) ||
    DEFAULT_IMAGE_MODEL
  );
}

function isImageOnlyModel(model: string) {
  return model.toLowerCase().startsWith("gpt-image-");
}

function normalizeResponsesModel(
  model: string,
  options?: { allowGpt55?: boolean },
  explicit = false
) {
  const requested = model.trim();
  if (!requested || isImageOnlyModel(requested)) return null;

  if (requested === GPT55_CHAT_MODEL && !options?.allowGpt55) {
    throw new Error("GPT-5.5 chat model requires Ultra plan.");
  }

  if (requested === GPT54_CHAT_MODEL || requested === GPT55_CHAT_MODEL) {
    return requested;
  }

  if (explicit) {
    throw new Error("Unsupported chat model. Use GPT-5.4 or GPT-5.5.");
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

function getApiError(errorData: unknown, fallback: string) {
  if (
    errorData &&
    typeof errorData === "object" &&
    "error" in errorData &&
    errorData.error &&
    typeof errorData.error === "object" &&
    "message" in errorData.error &&
    typeof errorData.error.message === "string"
  ) {
    return errorData.error.message;
  }

  if (
    errorData &&
    typeof errorData === "object" &&
    "message" in errorData &&
    typeof errorData.message === "string"
  ) {
    return errorData.message;
  }

  return fallback;
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

  if (
    config.supportsPromptOptimizationControl &&
    params.promptOptimization === false
  ) {
    formData.append("prompt_optimization", "false");
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
  if (image.revised_prompt) result.revisedPrompt = image.revised_prompt;
  return result;
}

function getPayloadError(payload: ImageResponsePayload): string | null {
  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (payload.error?.message) {
    return payload.error.message;
  }

  if (payload.type === "upstream_error" && payload.message) {
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
    revisedPrompt,
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

  if (eventName === "response.failed" || eventName === "error") {
    const error = payload.error;
    return getApiError(
      error && typeof error === "object" ? { error } : payload,
      "Responses API stream failed"
    );
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
        revisedPrompt: item.revised_prompt,
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
    const text = await response.text();
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

async function parseResponsesResponse(
  response: Response,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    let errorData: unknown = {};
    try {
      errorData = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      errorData = rawBody;
    }
    return {
      error: getApiError(
        errorData,
        rawBody.trim().startsWith("<")
          ? "API returned an HTML page instead of a Responses API response. Check that the API base URL points to an OpenAI-compatible /v1 endpoint."
          : `API error: ${response.status}`
      ),
    };
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return parseResponsesEventStreamResponse(response, callbacks);
  }

  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    return {
      error: text.trim().startsWith("<")
        ? "API returned an HTML page instead of a Responses API response. Check that the API base URL points to an OpenAI-compatible /v1 endpoint."
        : "API returned a non-JSON response.",
    };
  }

  const data = (await response.json()) as ResponsesPayload;
  const result = parseResponsesOutput(data.output);

  return (
    result || { error: getPayloadError(data) || "API returned no image data" }
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
  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    let errorData: unknown = {};
    try {
      errorData = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      errorData = rawBody;
    }
    return {
      error: getApiError(
        errorData,
        rawBody.trim().startsWith("<")
          ? "API returned an HTML page instead of an Images API response. Check that the API base URL points to an OpenAI-compatible /v1 endpoint."
          : `API error: ${response.status}`
      ),
    };
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return parseEventStreamResponse(response, callbacks);
  }

  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    return {
      error: text.trim().startsWith("<")
        ? "API returned an HTML page instead of an Images API response. Check that the API base URL points to an OpenAI-compatible /v1 endpoint."
        : "API returned a non-JSON response.",
    };
  }

  const data = (await response.json()) as ImageResponsePayload;
  const result = extractImageFromPayload(data);

  if (!result) {
    return { error: "API returned no image data" };
  }

  return result;
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
    supportsPromptOptimizationControl: true,
    model:
      normalizeImageModel(await getRuntimeSettingString("PLATFORM_IMAGE_MODEL")) ||
      DEFAULT_IMAGE_MODEL,
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
  return result;
}

export async function getEffectiveConfig(userConfig: ApiConfig | null): Promise<{
  config: ApiConfig;
  useCredits: boolean;
}> {
  if (userConfig) {
    return { config: userConfig, useCredits: false };
  }
  return { config: await getPlatformConfig(), useCredits: true };
}

export async function generateImage(
  config: ApiConfig,
  params: GenerateImageParams,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  const model = getModel(config, params.model);
  try {
    const prompt =
      params.promptOptimization === false
        ? params.prompt
        : params.apiPrompt || params.prompt;
    const size = params.size || DEFAULT_IMAGE_SIZE;
    const dimensions = parseImageSize(size);
    const response = await fetch(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
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
        ...(config.supportsPromptOptimizationControl &&
        params.promptOptimization === false
          ? { prompt_optimization: false }
          : {}),
        ...(config.useStream ? { stream: true, partial_images: 2 } : {}),
        response_format: "b64_json",
      }),
    });

    return await parseImageResponse(response, callbacks);
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
  const model = getModel(config, params.model);
  try {
    const prompt =
      params.promptOptimization === false
        ? params.prompt
        : params.apiPrompt || params.prompt;
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
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: formData,
    });

    return await parseImageResponse(response, callbacks);
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
  const model = await getResponsesModel(config, params.model, {
    allowGpt55: params.allowGpt55,
  });
  try {
    const prompt =
      params.promptOptimization === false
        ? params.prompt
        : params.apiPrompt || params.prompt;
    const size = params.size || DEFAULT_IMAGE_SIZE;
    const input = buildResponsesInput(prompt, params.images, params.history);
    const instructions =
      params.promptOptimization === false
        ? "Use the user's original image prompt exactly as written when calling the image_generation tool. Do not rewrite, expand, translate, polish, or optimize the latest user prompt before image generation."
        : undefined;
    const tool: {
      type: "image_generation";
      action: "auto";
      size?: string;
    } = {
      type: "image_generation",
      action: "auto",
    };

    if (size && size !== "auto") {
      tool.size = size;
    }

    const thinking = normalizeThinking(params.thinking);
    const reasoning: ReasoningConfig | undefined = thinking
      ? { effort: thinking, summary: "concise" }
      : undefined;

    const response = await fetch(
      `${stripTrailingSlash(config.baseUrl)}/responses`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          input,
          tools: [tool],
          ...(instructions ? { instructions } : {}),
          ...(reasoning ? { reasoning } : {}),
          ...(params.stream || config.useStream ? { stream: true } : {}),
        }),
      }
    );

    return await parseResponsesResponse(response, callbacks);
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
