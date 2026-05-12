import { db } from "@repo/database";
import { userApiConfig } from "@repo/database/schema";
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

  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  };
  const image = data.data?.[0];

  if (!image?.b64_json && !image?.url) {
    return { error: "API returned no image data" };
  }

  const result: GenerateImageResult = {};
  if (image.b64_json) result.imageBase64 = image.b64_json;
  if (image.url) result.imageUrl = image.url;
  if (image.revised_prompt) result.revisedPrompt = image.revised_prompt;
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
      size: params.size || DEFAULT_IMAGE_SIZE,
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
