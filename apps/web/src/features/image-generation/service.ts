import { db } from "@repo/database";
import { userApiConfig } from "@repo/database/schema";
import { logError } from "@repo/shared/logger";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { eq } from "drizzle-orm";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  normalizeImageModel,
  parseImageSize,
} from "./resolution";
import type {
  ApiConfig,
  ChatImageParams,
  EditImageParams,
  GenerateImageParams,
  GenerateImageResult,
  ImageGenerationCallbacks,
  ImageInputFile,
  ImageModeration,
  ImageQuality,
  PartialImageResult,
} from "./types";

const VALID_QUALITIES = new Set<ImageQuality>([
  "auto",
  "low",
  "medium",
  "high",
]);
const VALID_MODERATION = new Set<ImageModeration>(["auto", "low"]);
const DEFAULT_RESPONSES_MODEL = "gpt-5.4";

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
  | { type: "input_image"; image_url: string };

type ResponsesRequestMessage = {
  role: "user";
  content: ResponsesRequestContent[];
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

export function getResponsesModel(config: ApiConfig, model?: string) {
  const requested = (model || config.model || "").trim();
  if (requested && !isImageOnlyModel(requested)) {
    return requested;
  }

  return (
    process.env.PLATFORM_RESPONSES_MODEL?.trim() ||
    process.env.PLATFORM_CHAT_MODEL?.trim() ||
    DEFAULT_RESPONSES_MODEL
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

  for (const item of output || []) {
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

  if (!imageBase64) return null;

  return {
    imageBase64,
    revisedPrompt,
    responseText,
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

  if (!result) {
    return {
      error: getPayloadError(data) || "API returned no image data",
    };
  }

  return result;
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

function getPlatformConfig(): ApiConfig {
  const baseUrl = process.env.PLATFORM_API_BASE_URL;
  const apiKey = process.env.PLATFORM_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("Platform API configuration is missing");
  }
  return {
    baseUrl,
    apiKey,
    model:
      normalizeImageModel(process.env.PLATFORM_IMAGE_MODEL) ||
      DEFAULT_IMAGE_MODEL,
  };
}

export async function getUserApiConfig(
  userId: string
): Promise<ApiConfig | null> {
  const plan = await getUserPlan(userId);
  if (!plan.hasActiveSubscription) {
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

export function getEffectiveConfig(userConfig: ApiConfig | null): {
  config: ApiConfig;
  useCredits: boolean;
} {
  if (userConfig) {
    return { config: userConfig, useCredits: false };
  }
  return { config: getPlatformConfig(), useCredits: true };
}

export async function generateImage(
  config: ApiConfig,
  params: GenerateImageParams,
  callbacks?: ImageGenerationCallbacks
): Promise<GenerateImageResult> {
  const model = getModel(config, params.model);
  try {
    const prompt = params.apiPrompt || params.prompt;
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
    const formData = new FormData();
    appendImageParams(formData, config, {
      prompt: params.apiPrompt || params.prompt,
      model,
      n: params.n,
      size: params.size,
      quality: params.quality,
      moderation: params.moderation,
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
  const model = getResponsesModel(config, params.model);
  try {
    const prompt = params.apiPrompt || params.prompt;
    const size = params.size || DEFAULT_IMAGE_SIZE;
    const content: ResponsesRequestContent[] = [
      { type: "input_text", text: prompt },
      ...(params.images || []).map((image) => ({
        type: "input_image" as const,
        image_url: getDataUrl(image),
      })),
    ];
    const input: ResponsesRequestMessage[] = [{ role: "user", content }];
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
          ...(config.useStream ? { stream: true } : {}),
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
