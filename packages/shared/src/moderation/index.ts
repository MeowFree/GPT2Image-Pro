import Green20220302Module, {
  ImageModerationRequest,
  MultiModalAgentRequest,
  TextModerationPlusRequest,
} from "@alicloud/green20220302";
import { Config as AliyunOpenApiConfig } from "@alicloud/openapi-client";
import { RuntimeOptions as AliyunRuntimeOptions } from "@alicloud/tea-util";
import OpenAI from "openai";
import type {
  ModerationBlockRiskLevel,
  SubscriptionPlan,
} from "../config/subscription-plan";
import { normalizePlanModerationBlockRiskLevel } from "../subscription/services/plan-capabilities";
import { logError, logWarn } from "../logger";
import {
  getRuntimeSettingBoolean,
  getRuntimeSettingNumber,
  getRuntimeSettingString,
} from "../system-settings";

type ModerationProvider = "aliyun" | "openai";
type ModerationDecision = "allow" | "block" | "skipped" | "error";
type ModerationMode = "text" | "image";
type AliyunRiskLevel = "none" | "low" | "medium" | "high";

const ALIYUN_MAX_CONTENT_LENGTH = 2000;
const ALIYUN_RISK_ORDER: Record<AliyunRiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};
const DEFAULT_MODERATION_BLOCK_RISK_LEVEL: AliyunRiskLevel = "low";
const Green20220302 =
  (
    Green20220302Module as typeof Green20220302Module & {
      default?: typeof Green20220302Module;
    }
  ).default || Green20220302Module;

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
  userPlan?: SubscriptionPlan;
  userModerationBlockRiskLevel?: ModerationBlockRiskLevel;
  generationId?: string;
  skipProxy?: boolean;
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
  timeoutMs: number;
  endpoint?: string;
  textRegionId?: string;
  textEndpoint?: string;
  textService?: string;
  imageRegionId?: string;
  imageEndpoint?: string;
  imageService?: string;
  textAppId?: string;
  imageAppId?: string;
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export async function isContentModerationEnabled() {
  return getRuntimeSettingBoolean("CONTENT_MODERATION_ENABLED", true);
}

async function shouldFailClosed() {
  return getRuntimeSettingBoolean("CONTENT_MODERATION_FAIL_CLOSED", true);
}

async function runtimeValue(name: Parameters<typeof getRuntimeSettingString>[0]) {
  return getRuntimeSettingString(name);
}

async function getAliyunConfig(): Promise<AliyunConfig | null> {
  const accessKeyId = await runtimeValue("ALIYUN_MODERATION_ACCESS_KEY_ID");
  const accessKeySecret = await runtimeValue(
    "ALIYUN_MODERATION_ACCESS_KEY_SECRET"
  );

  if (!accessKeyId || !accessKeySecret) {
    return null;
  }

  const config: AliyunConfig = {
    accessKeyId,
    accessKeySecret,
    regionId: (await runtimeValue("ALIYUN_MODERATION_REGION_ID")) || "cn-shanghai",
    timeoutMs: await getProviderTimeoutMs(),
  };

  const endpoint = await runtimeValue("ALIYUN_MODERATION_ENDPOINT");
  if (endpoint) config.endpoint = endpoint;

  const textRegionId = await runtimeValue("ALIYUN_MODERATION_TEXT_REGION_ID");
  if (textRegionId) config.textRegionId = textRegionId;

  const textEndpoint = await runtimeValue("ALIYUN_MODERATION_TEXT_ENDPOINT");
  if (textEndpoint) config.textEndpoint = textEndpoint;

  const textService = await runtimeValue("ALIYUN_MODERATION_TEXT_SERVICE");
  if (textService) config.textService = textService;

  const imageRegionId = await runtimeValue("ALIYUN_MODERATION_IMAGE_REGION_ID");
  if (imageRegionId) config.imageRegionId = imageRegionId;

  const imageEndpoint = await runtimeValue("ALIYUN_MODERATION_IMAGE_ENDPOINT");
  if (imageEndpoint) config.imageEndpoint = imageEndpoint;

  const imageService = await runtimeValue("ALIYUN_MODERATION_IMAGE_SERVICE");
  if (imageService) config.imageService = imageService;

  const textAppId =
    (await runtimeValue("ALIYUN_MODERATION_TEXT_APP_ID")) ||
    envValue("ALIYUN_MODERATION_APP_ID");
  if (textAppId) config.textAppId = textAppId;

  const imageAppId = await runtimeValue("ALIYUN_MODERATION_IMAGE_APP_ID");
  if (imageAppId) config.imageAppId = imageAppId;

  return config;
}

async function getOpenAiApiKey() {
  return (
    (await runtimeValue("OPENAI_MODERATION_API_KEY")) ||
    envValue("MODERATION_OPENAI_API_KEY")
  );
}

async function getProxyUrl() {
  return runtimeValue("CONTENT_MODERATION_PROXY_URL");
}

async function getProxySecret() {
  return runtimeValue("CONTENT_MODERATION_PROXY_SECRET");
}

async function getProxyTimeoutMs() {
  return getRuntimeSettingNumber("CONTENT_MODERATION_PROXY_TIMEOUT_MS", 10_000, {
    positive: true,
  });
}

async function getProviderTimeoutMs() {
  return getRuntimeSettingNumber(
    "CONTENT_MODERATION_PROVIDER_TIMEOUT_MS",
    10_000,
    { positive: true }
  );
}

async function getEffectiveAliyunBlockRiskLevel(
  userPlan?: SubscriptionPlan,
  userModerationBlockRiskLevel?: ModerationBlockRiskLevel
): Promise<AliyunRiskLevel> {
  if (!userPlan) {
    return DEFAULT_MODERATION_BLOCK_RISK_LEVEL;
  }

  return await normalizePlanModerationBlockRiskLevel(
    userPlan,
    userModerationBlockRiskLevel
  );
}

function shouldBlockAliyunRisk(
  riskLevel: unknown,
  blockRiskLevel: AliyunRiskLevel
) {
  if (typeof riskLevel !== "string") return false;
  const normalized = riskLevel.toLowerCase();
  if (!(normalized in ALIYUN_RISK_ORDER)) return normalized !== "pass";

  return (
    ALIYUN_RISK_ORDER[normalized as AliyunRiskLevel] >=
    ALIYUN_RISK_ORDER[blockRiskLevel]
  );
}

export async function getConfiguredModerationProviders(): Promise<
  ModerationProvider[]
> {
  if (!(await isContentModerationEnabled())) {
    return [];
  }

  const configured = await runtimeValue("CONTENT_MODERATION_PROVIDER");
  if (configured === "aliyun") {
    return (await getAliyunConfig()) ? ["aliyun"] : [];
  }
  if (configured === "openai") {
    return (await getOpenAiApiKey()) ? ["openai"] : [];
  }
  if (configured === "none") {
    return [];
  }

  const providers: ModerationProvider[] = [];
  if (await getAliyunConfig()) providers.push("aliyun");
  if (await getOpenAiApiKey()) providers.push("openai");
  return providers;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function toBlockResult(
  provider: ModerationProvider,
  reason: string,
  details?: unknown
): ModerationResult {
  return { decision: "block", provider, reason, details };
}

function formatModerationErrors(
  errors: Array<{ provider: ModerationProvider; error: string }>
) {
  return errors.map(({ provider, error }) => `${provider}: ${error}`).join("; ");
}

function getAliyunClient(config: AliyunConfig) {
  return new Green20220302(
    new AliyunOpenApiConfig({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      regionId: config.textRegionId || config.regionId,
      endpoint: config.textEndpoint || config.endpoint,
      readTimeout: config.timeoutMs,
      connectTimeout: config.timeoutMs,
    })
  );
}

function getAliyunAgentClient(config: AliyunConfig) {
  return new Green20220302(
    new AliyunOpenApiConfig({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      regionId: config.regionId,
      endpoint: config.endpoint,
      readTimeout: config.timeoutMs,
      connectTimeout: config.timeoutMs,
    })
  );
}

function getAliyunImageClient(config: AliyunConfig) {
  return new Green20220302(
    new AliyunOpenApiConfig({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      regionId: config.imageRegionId || config.regionId,
      endpoint: config.imageEndpoint || config.endpoint,
      readTimeout: config.timeoutMs,
      connectTimeout: config.timeoutMs,
    })
  );
}

function getAliyunRuntime(config: AliyunConfig) {
  return new AliyunRuntimeOptions({
    readTimeout: config.timeoutMs,
    connectTimeout: config.timeoutMs,
  });
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
  config: AliyunConfig,
  appId: string,
  input: ModerateContentInput,
  content: string,
  imageUrl: string | undefined,
  blockRiskLevel: AliyunRiskLevel
): Promise<ModerationResult> {
  const response = await client.multiModalAgentWithOptions(
    new MultiModalAgentRequest({
      appID: appId,
      serviceParameters: JSON.stringify(
        getAliyunAgentPayload(input, content, imageUrl)
      ),
    }),
    getAliyunRuntime(config)
  );

  assertAliyunResponseOk(response.body);

  const data = response.body?.data;
  if (data && shouldBlockAliyunRisk(data.riskLevel, blockRiskLevel)) {
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
  config: AliyunConfig,
  appId: string,
  input: ModerateContentInput,
  blockRiskLevel: AliyunRiskLevel
): Promise<ModerationResult> {
  for (const content of getContentChunks(input.prompt)) {
    const result = await moderateWithAliyunAgent(
      client,
      config,
      appId,
      input,
      content,
      undefined,
      blockRiskLevel
    );
    if (result.decision === "block") {
      return result;
    }
  }

  return { decision: "allow", provider: "aliyun" };
}

async function moderateWithAliyunTextPlus(
  client: InstanceType<typeof Green20220302>,
  config: AliyunConfig,
  service: string,
  input: ModerateContentInput,
  blockRiskLevel: AliyunRiskLevel
): Promise<ModerationResult> {
  for (const content of getContentChunks(input.prompt)) {
    const response = await client.textModerationPlusWithOptions(
      new TextModerationPlusRequest({
        service,
        serviceParameters: JSON.stringify({
          dataId: input.generationId,
          content,
        }),
      }),
      getAliyunRuntime(config)
    );

    assertAliyunResponseOk(response.body);

    const data = response.body?.data;
    if (data && shouldBlockAliyunRisk(data.riskLevel, blockRiskLevel)) {
      const labels = [
        ...(data.result || []).map((item: { label?: string }) => item.label),
        ...(data.attackResult || []).map(
          (item: { label?: string }) => item.label
        ),
        ...(data.sensitiveResult || []).map(
          (item: { label?: string }) => item.label
        ),
      ].filter((label): label is string => Boolean(label));

      return toBlockResult(
        "aliyun",
        labels.length
          ? `Content blocked by Aliyun moderation: ${labels.join(", ")}`
          : `Content blocked by Aliyun moderation: ${data.riskLevel}`,
        data
      );
    }
  }

  return { decision: "allow", provider: "aliyun" };
}

async function moderateWithAliyunImageAgent(
  client: InstanceType<typeof Green20220302>,
  config: AliyunConfig,
  appId: string,
  input: ModerateContentInput,
  blockRiskLevel: AliyunRiskLevel
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
        config,
        appId,
        input,
        content,
        image.url,
        blockRiskLevel
      );
      if (result.decision === "block") {
        return result;
      }
    }
  }

  return { decision: "allow", provider: "aliyun" };
}

async function moderateWithAliyunImageModeration(
  client: InstanceType<typeof Green20220302>,
  config: AliyunConfig,
  service: string,
  input: ModerateContentInput,
  blockRiskLevel: AliyunRiskLevel
): Promise<ModerationResult> {
  if (!input.images?.length) {
    throw new Error("Aliyun image moderation requires an image");
  }

  for (const image of input.images) {
    if (!image.url) {
      throw new Error("Aliyun image moderation requires public image URLs");
    }

    const response = await client.imageModerationWithOptions(
      new ImageModerationRequest({
        service,
        serviceParameters: JSON.stringify({
          dataId: input.generationId,
          imageUrl: image.url,
        }),
      }),
      getAliyunRuntime(config)
    );

    assertAliyunResponseOk(response.body);

    const data = response.body?.data;
    if (data && shouldBlockAliyunRisk(data.riskLevel, blockRiskLevel)) {
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
  }

  return { decision: "allow", provider: "aliyun" };
}

async function moderateWithAliyun(
  input: ModerateContentInput
): Promise<ModerationResult> {
  const config = await getAliyunConfig();
  if (!config) {
    return { decision: "skipped", provider: "aliyun" };
  }

  const isImageMode = input.mode === "image" || Boolean(input.images?.length);
  const blockRiskLevel = await getEffectiveAliyunBlockRiskLevel(
    input.userPlan,
    input.userModerationBlockRiskLevel
  );

  if (!isImageMode && config.textService) {
    return moderateWithAliyunTextPlus(
      getAliyunClient(config),
      config,
      config.textService,
      input,
      blockRiskLevel
    );
  }

  if (isImageMode && config.imageService) {
    return moderateWithAliyunImageModeration(
      getAliyunImageClient(config),
      config,
      config.imageService,
      input,
      blockRiskLevel
    );
  }

  const client = getAliyunAgentClient(config);
  const appId = isImageMode ? config.imageAppId : config.textAppId;

  if (!appId) {
    throw new Error(
      isImageMode
        ? "ALIYUN_MODERATION_IMAGE_APP_ID is not configured"
        : "ALIYUN_MODERATION_TEXT_APP_ID is not configured"
    );
  }

  return isImageMode
    ? moderateWithAliyunImageAgent(client, config, appId, input, blockRiskLevel)
    : moderateWithAliyunTextAgent(client, config, appId, input, blockRiskLevel);
}

async function moderateWithOpenAI(
  input: ModerateContentInput
): Promise<ModerationResult> {
  const apiKey = await getOpenAiApiKey();
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
    model:
      (await runtimeValue("OPENAI_MODERATION_MODEL")) ||
      "omni-moderation-latest",
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

async function moderateWithProxy(
  input: ModerateContentInput
): Promise<ModerationResult> {
  const proxyUrl = await getProxyUrl();
  if (!proxyUrl || input.skipProxy) {
    return { decision: "skipped" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    await getProxyTimeoutMs()
  );

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    const secret = await getProxySecret();
    if (secret) {
      headers.authorization = `Bearer ${secret}`;
      headers["x-moderation-proxy-secret"] = secret;
    }

    const response = await fetch(proxyUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: input.prompt,
        mode: input.mode,
        userId: input.userId,
        userPlan: input.userPlan,
        userModerationBlockRiskLevel: input.userModerationBlockRiskLevel,
        generationId: input.generationId,
        images: (input.images || []).map((image) => ({
          name: image.name,
          type: image.type,
          url: image.url,
          data: image.url ? undefined : image.data.toString("base64"),
        })),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Moderation proxy failed: ${response.status}`);
    }

    const result = (await response.json()) as ModerationResult;
    if (
      result.decision === "allow" ||
      result.decision === "block" ||
      result.decision === "skipped" ||
      result.decision === "error"
    ) {
      return result;
    }

    throw new Error("Moderation proxy returned an invalid decision");
  } finally {
    clearTimeout(timeout);
  }
}

export async function moderateContent(
  input: ModerateContentInput
): Promise<ModerationResult> {
  if (!(await isContentModerationEnabled())) {
    return { decision: "skipped" };
  }

  const providers = await getConfiguredModerationProviders();
  const proxyUrl = await getProxyUrl();
  if (providers.length === 0 && (!proxyUrl || input.skipProxy)) {
    return { decision: "skipped" };
  }

  const errors: Array<{ provider: ModerationProvider; error: string }> = [];

  if (proxyUrl && !input.skipProxy) {
    try {
      const result = await moderateWithProxy(input);
      if (result.decision === "block" || result.decision === "allow") {
        return result;
      }
      if (result.decision === "error") {
        return result;
      }
    } catch (error) {
      logError(error, {
        userId: input.userId,
        generationId: input.generationId,
        context: "content-moderation-proxy",
      });
    }
  }

  for (const provider of providers) {
    try {
      const result = await withTimeout(
        provider === "aliyun"
          ? moderateWithAliyun(input)
          : moderateWithOpenAI(input),
        await getProviderTimeoutMs(),
        `${provider} moderation`
      );

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
    const reason = formatModerationErrors(errors);

    if (await shouldFailClosed()) {
      return {
        decision: "error",
        reason,
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
