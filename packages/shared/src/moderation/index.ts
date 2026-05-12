import Green20220302, { MultiModalAgentRequest } from "@alicloud/green20220302";
import { Config as AliyunOpenApiConfig } from "@alicloud/openapi-client";
import OpenAI from "openai";
import { logError, logWarn } from "../logger";

type ModerationProvider = "aliyun" | "openai";
type ModerationDecision = "allow" | "block" | "skipped" | "error";
type ModerationMode = "text" | "image";

const ALIYUN_MAX_CONTENT_LENGTH = 2000;

export interface ModerationImageInput {
  data: Buffer;
  type: string;
  name?: string;
  url?: string;
}

export interface ModerateContentInput {
  prompt: string;
  images?: ModerationImageInput[];
  mode?: ModerationMode;
  userId?: string;
  generationId?: string;
}

export interface ModerationResult {
  decision: ModerationDecision;
  provider?: ModerationProvider;
  reason?: string;
  details?: unknown;
}

interface AliyunConfig {
  accessKeyId: string;
  accessKeySecret: string;
  regionId: string;
  endpoint?: string;
  textAppId?: string;
  imageAppId?: string;
}

function envFlag(name: string, fallback = false) {
  const value = process.env[name];
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function isModerationEnabled() {
  return envFlag("CONTENT_MODERATION_ENABLED", true);
}

function shouldFailClosed() {
  return envFlag("CONTENT_MODERATION_FAIL_CLOSED", false);
}

function getAliyunConfig(): AliyunConfig | null {
  const accessKeyId = envValue("ALIYUN_MODERATION_ACCESS_KEY_ID");
  const accessKeySecret = envValue("ALIYUN_MODERATION_ACCESS_KEY_SECRET");

  if (!accessKeyId || !accessKeySecret) {
    return null;
  }

  const config: AliyunConfig = {
    accessKeyId,
    accessKeySecret,
    regionId: envValue("ALIYUN_MODERATION_REGION_ID") || "cn-shanghai",
  };

  const endpoint = envValue("ALIYUN_MODERATION_ENDPOINT");
  if (endpoint) config.endpoint = endpoint;

  const textAppId =
    envValue("ALIYUN_MODERATION_TEXT_APP_ID") ||
    envValue("ALIYUN_MODERATION_APP_ID");
  if (textAppId) config.textAppId = textAppId;

  const imageAppId = envValue("ALIYUN_MODERATION_IMAGE_APP_ID");
  if (imageAppId) config.imageAppId = imageAppId;

  return config;
}

function getOpenAiApiKey() {
  return (
    envValue("OPENAI_MODERATION_API_KEY") ||
    envValue("MODERATION_OPENAI_API_KEY") ||
    envValue("OPENAI_API_KEY")
  );
}

export function getConfiguredModerationProviders(): ModerationProvider[] {
  if (!isModerationEnabled()) {
    return [];
  }

  const configured = envValue("CONTENT_MODERATION_PROVIDER");
  if (configured === "aliyun") {
    return getAliyunConfig() ? ["aliyun"] : [];
  }
  if (configured === "openai") {
    return getOpenAiApiKey() ? ["openai"] : [];
  }
  if (configured === "none") {
    return [];
  }

  const providers: ModerationProvider[] = [];
  if (getAliyunConfig()) providers.push("aliyun");
  if (getOpenAiApiKey()) providers.push("openai");
  return providers;
}

function toBlockResult(
  provider: ModerationProvider,
  reason: string,
  details?: unknown
): ModerationResult {
  return { decision: "block", provider, reason, details };
}

function getAliyunClient(config: AliyunConfig) {
  return new Green20220302(
    new AliyunOpenApiConfig({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      regionId: config.regionId,
      endpoint: config.endpoint,
    })
  );
}

function assertAliyunResponseOk(
  body: { code?: number | string; message?: string } | undefined
) {
  if (!body?.code || String(body.code) === "200") {
    return;
  }

  throw new Error(
    body.message
      ? `Aliyun moderation failed: ${body.code} ${body.message}`
      : `Aliyun moderation failed: ${body.code}`
  );
}

function getContentChunks(content: string) {
  const chunks: string[] = [];
  for (
    let index = 0;
    index < content.length;
    index += ALIYUN_MAX_CONTENT_LENGTH
  ) {
    chunks.push(content.slice(index, index + ALIYUN_MAX_CONTENT_LENGTH));
  }
  return chunks.length ? chunks : [content];
}

function getAliyunAgentPayload(
  input: ModerateContentInput,
  content: string,
  imageUrl?: string
) {
  const payload: Record<string, unknown> = {
    dataId: input.generationId,
    content,
  };

  if (imageUrl) {
    payload.images = [{ imageUrl }];
  }

  return payload;
}

async function moderateWithAliyunAgent(
  client: InstanceType<typeof Green20220302>,
  appId: string,
  input: ModerateContentInput,
  content: string,
  imageUrl?: string
): Promise<ModerationResult> {
  const response = await client.multiModalAgent(
    new MultiModalAgentRequest({
      appID: appId,
      serviceParameters: JSON.stringify(
        getAliyunAgentPayload(input, content, imageUrl)
      ),
    })
  );

  assertAliyunResponseOk(response.body);

  const data = response.body?.data;
  if (
    data?.riskLevel &&
    data.riskLevel !== "none" &&
    data.riskLevel !== "low"
  ) {
    const labels = (data.result || [])
      .map((item: { label?: string }) => item.label)
      .filter((label): label is string => Boolean(label));
    return toBlockResult(
      "aliyun",
      labels.length
        ? `Content blocked by Aliyun moderation: ${labels.join(", ")}`
        : `Content blocked by Aliyun moderation: ${data.riskLevel}`,
      data
    );
  }

  return { decision: "allow", provider: "aliyun", details: data };
}

async function moderateWithAliyunTextAgent(
  client: InstanceType<typeof Green20220302>,
  appId: string,
  input: ModerateContentInput
): Promise<ModerationResult> {
  for (const content of getContentChunks(input.prompt)) {
    const result = await moderateWithAliyunAgent(client, appId, input, content);
    if (result.decision === "block") {
      return result;
    }
  }

  return { decision: "allow", provider: "aliyun" };
}

async function moderateWithAliyunImageAgent(
  client: InstanceType<typeof Green20220302>,
  appId: string,
  input: ModerateContentInput
): Promise<ModerationResult> {
  if (!input.images?.length) {
    throw new Error("Aliyun image moderation requires an image");
  }

  for (const image of input.images) {
    if (!image.url) {
      throw new Error("Aliyun image moderation requires public image URLs");
    }

    for (const content of getContentChunks(input.prompt)) {
      const result = await moderateWithAliyunAgent(
        client,
        appId,
        input,
        content,
        image.url
      );
      if (result.decision === "block") {
        return result;
      }
    }
  }

  return { decision: "allow", provider: "aliyun" };
}

async function moderateWithAliyun(
  input: ModerateContentInput
): Promise<ModerationResult> {
  const config = getAliyunConfig();
  if (!config) {
    return { decision: "skipped", provider: "aliyun" };
  }

  const client = getAliyunClient(config);
  const isImageMode = input.mode === "image" || Boolean(input.images?.length);
  const appId = isImageMode ? config.imageAppId : config.textAppId;

  if (!appId) {
    throw new Error(
      isImageMode
        ? "ALIYUN_MODERATION_IMAGE_APP_ID is not configured"
        : "ALIYUN_MODERATION_TEXT_APP_ID is not configured"
    );
  }

  return isImageMode
    ? moderateWithAliyunImageAgent(client, appId, input)
    : moderateWithAliyunTextAgent(client, appId, input);
}

async function moderateWithOpenAI(
  input: ModerateContentInput
): Promise<ModerationResult> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return { decision: "skipped", provider: "openai" };
  }

  const client = new OpenAI({ apiKey });
  const moderationInput: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text: input.prompt }];

  for (const image of input.images || []) {
    moderationInput.push({
      type: "image_url",
      image_url: {
        url: `data:${image.type};base64,${image.data.toString("base64")}`,
      },
    });
  }

  const result = await client.moderations.create({
    model: envValue("OPENAI_MODERATION_MODEL") || "omni-moderation-latest",
    input: moderationInput,
  });

  const flagged = result.results.find((item) => item.flagged);
  if (flagged) {
    const categories = Object.entries(flagged.categories)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key);
    return toBlockResult(
      "openai",
      categories.length
        ? `Content blocked by OpenAI moderation: ${categories.join(", ")}`
        : "Content blocked by OpenAI moderation",
      result
    );
  }

  return { decision: "allow", provider: "openai", details: result };
}

export async function moderateContent(
  input: ModerateContentInput
): Promise<ModerationResult> {
  const providers = getConfiguredModerationProviders();
  if (providers.length === 0) {
    return { decision: "skipped" };
  }

  const errors: Array<{ provider: ModerationProvider; error: string }> = [];

  for (const provider of providers) {
    try {
      const result =
        provider === "aliyun"
          ? await moderateWithAliyun(input)
          : await moderateWithOpenAI(input);

      if (result.decision === "block") {
        return result;
      }

      if (result.decision === "allow") {
        return result;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push({ provider, error: message });
      logError(error, {
        provider,
        userId: input.userId,
        generationId: input.generationId,
        context: "content-moderation",
      });
    }
  }

  if (errors.length > 0) {
    if (shouldFailClosed()) {
      return {
        decision: "error",
        reason: "Content moderation failed",
        details: errors,
      };
    }

    logWarn("Content moderation failed open", {
      userId: input.userId,
      generationId: input.generationId,
      errors,
    });
    return { decision: "allow", details: errors };
  }

  return { decision: "skipped" };
}
