import { eq } from "drizzle-orm";
import { db } from "@repo/database";
import { userApiConfig } from "@repo/database/schema";
import type {
  ApiConfig,
  GenerateImageParams,
  GenerateImageResult,
} from "./types";

function getPlatformConfig(): ApiConfig {
  const baseUrl = process.env.PLATFORM_API_BASE_URL;
  const apiKey = process.env.PLATFORM_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("Platform API configuration is missing");
  }
  return {
    baseUrl,
    apiKey,
    model: process.env.PLATFORM_IMAGE_MODEL || "gpt-image-1",
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
  if (row.model) result.model = row.model;
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
    const response = await fetch(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model || config.model || "gpt-image-1",
        prompt: params.prompt,
        n: params.n || 1,
        size: params.size || "1024x1024",
        response_format: "b64_json",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        error:
          (errorData as Record<string, Record<string, string>>)?.error
            ?.message || `API error: ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    };
    const image = data.data?.[0];

    const result: GenerateImageResult = {};
    if (image?.b64_json) result.imageBase64 = image.b64_json;
    if (image?.url) result.imageUrl = image.url;
    if (image?.revised_prompt) result.revisedPrompt = image.revised_prompt;
    return result;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
