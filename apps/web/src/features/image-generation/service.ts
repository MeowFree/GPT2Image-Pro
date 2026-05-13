import { db } from "@repo/database";
import { userApiConfig } from "@repo/database/schema";
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
  EditImageParams,
  GenerateImageParams,
  GenerateImageResult,
  ImageQuality,
} from "./types";

const VALID_QUALITIES = new Set<ImageQuality>([
  "auto",
  "low",
  "medium",
  "high",
]);

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
  error?: { message?: string } | string;
  message?: string;
};

function getModel(config: ApiConfig, model?: string) {
  return (
    normalizeImageModel(model) ||
    normalizeImageModel(config.model) ||
    DEFAULT_IMAGE_MODEL
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

function toBlobPart(buffer: Buffer): BlobPart {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
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

  if (config.useStream) {
    formData.append("stream", "true");
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

function parseEventStream(text: string): GenerateImageResult {
  let currentEvent = "";
  const dataLines: string[] = [];
  let completedResult: GenerateImageResult | null = null;
  let fallbackResult: GenerateImageResult | null = null;

  const processEvent = (eventName: string, lines: string[]) => {
    if (lines.length === 0) return null;

    const data = lines.join("\n").trim();
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

    const result = extractImageFromPayload(payload);
    if (!result) return null;

    if (
      eventName === "image_generation.completed" ||
      payload.type === "image_generation.completed"
    ) {
      completedResult = result;
    } else if (!fallbackResult) {
      fallbackResult = result;
    }

    return null;
  };

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    if (line === "") {
      const error = processEvent(currentEvent, dataLines);
      if (error) return { error };
      currentEvent = "";
      dataLines.length = 0;
      continue;
    }

    if (line.startsWith(":")) continue;

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") {
      currentEvent = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  const error = processEvent(currentEvent, dataLines);
  if (error) return { error };

  const result = completedResult || fallbackResult;
  if (result) return result;

  return { error: "API returned no image data" };
}

async function parseImageResponse(
  response: Response
): Promise<GenerateImageResult> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    return {
      error: getApiError(errorData, `API error: ${response.status}`),
    };
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return parseEventStream(await response.text());
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
  params: GenerateImageParams
): Promise<GenerateImageResult> {
  try {
    const size = params.size || DEFAULT_IMAGE_SIZE;
    const dimensions = parseImageSize(size);
    const response = await fetch(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: getModel(config, params.model),
        prompt: params.prompt,
        n: params.n || 1,
        size,
        ...(dimensions
          ? { width: dimensions.width, height: dimensions.height }
          : {}),
        ...(normalizeQuality(params.quality)
          ? { quality: normalizeQuality(params.quality) }
          : {}),
        ...(config.useStream ? { stream: true } : {}),
        response_format: "b64_json",
      }),
    });

    return await parseImageResponse(response);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

export async function editImage(
  config: ApiConfig,
  params: EditImageParams
): Promise<GenerateImageResult> {
  try {
    const formData = new FormData();
    appendImageParams(formData, config, {
      prompt: params.prompt,
      model: params.model,
      n: params.n,
      size: params.size,
      quality: params.quality,
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

    return await parseImageResponse(response);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
