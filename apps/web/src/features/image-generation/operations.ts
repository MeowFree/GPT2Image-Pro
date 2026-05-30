import { db } from "@repo/database";
import { generation, user } from "@repo/database/schema";
import { consumeCredits } from "@repo/shared/credits/core";
import { GPT55_CHAT_MODEL } from "@repo/shared/config/subscription-plan";
import {
  IMAGE_GENERATION_PENDING_TIMEOUT_MS,
  IMAGE_GENERATION_TIMEOUT_ERROR,
  refundGenerationCredits,
} from "@repo/shared/generation-maintenance";
import { getFailedGenerationTargetCredits } from "@repo/shared/generation-settlement";
import { logWarn } from "@repo/shared/logger";
import {
  isContentModerationEnabled,
  moderateContent,
} from "@repo/shared/moderation";
import { getStorageProvider } from "@repo/shared/storage/providers";
import {
  getPlanCapabilitySnapshot,
  getPlanQueueSettings,
  normalizePlanModerationBlockRiskLevel,
} from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import {
  getRuntimeSettingNumber,
  getRuntimeSettingString,
} from "@repo/shared/system-settings";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ImageBackendPoolUnavailableError } from "@/features/image-backend-pool/service";
import type { ImageBackendRequestKind } from "@/features/image-backend-pool/types";
import {
  reserveExternalApiKeyCredits,
  refundExternalApiKeyCredits,
} from "@/features/external-api/quota";
import {
  detectImageOutputFormatFromBuffer,
  getOutputFormatContentType,
  getOutputFormatExtension,
  normalizeOutputFormat,
} from "./output-format";
import { buildInputImagesMetadata } from "./generation-metadata";
import { getRuntimeImageBaseCreditPricing } from "./pricing-settings";
import { withImageGenerationQueue } from "./queue";
import {
  DEFAULT_IMAGE_SIZE,
  getImageCreditCostBreakdown,
  getImageModel,
  type ImageBaseCreditPricing,
  isImageSizeWithinPixelRange,
  isOneKImageSize,
  normalizeImageSize,
  roundCreditAmount,
  roundUpCreditAmount,
} from "./resolution";
import {
  editImage,
  generateChatImage,
  generateImage,
  getEffectiveConfig,
  getResponsesModel,
  getUserApiConfig,
} from "./service";
import type {
  ApiConfig,
  ChatHistoryMessage,
  ChatImageParams,
  EditImageParams,
  GenerateImageParams,
  GenerateImageResult,
  ImageGenerationCallbacks,
  ImageInputFile,
  ModerationBlockRiskLevel,
} from "./types";

type RunImageGenerationInput =
  | ({
      mode: "generate";
      userId: string;
      generationId?: string;
      apiKeyId?: string;
      relayOnly?: boolean;
      backendRequestKind?: ImageBackendRequestKind;
      preferredBackendMemberId?: string;
      mixWebFirst?: boolean;
      forceWebBackend?: boolean;
      requiresResponsesBackend?: boolean;
    } & GenerateImageParams)
  | ({
      mode: "edit";
      userId: string;
      generationId?: string;
      apiKeyId?: string;
      relayOnly?: boolean;
      backendRequestKind?: ImageBackendRequestKind;
      preferredBackendMemberId?: string;
      mixWebFirst?: boolean;
      forceWebBackend?: boolean;
      requiresResponsesBackend?: boolean;
    } & EditImageParams)
  | ({
      mode: "chat";
      userId: string;
      generationId?: string;
      apiKeyId?: string;
      relayOnly?: boolean;
      backendRequestKind?: ImageBackendRequestKind;
      preferredBackendMemberId?: string;
      maxChatContextChars?: number;
      mixWebFirst?: boolean;
      forceWebBackend?: boolean;
      requiresResponsesBackend?: boolean;
    } & ChatImageParams);

const DEFAULT_FORCE_WEB_MIN_PIXELS = 660_000;
const DEFAULT_FORCE_WEB_MAX_PIXELS = 2_000_000;

async function getForceWebPixelRange() {
  const [minPixels, maxPixels] = await Promise.all([
    getRuntimeSettingNumber(
      "IMAGE_FORCE_WEB_MIN_PIXELS",
      DEFAULT_FORCE_WEB_MIN_PIXELS,
      { nonNegative: true }
    ),
    getRuntimeSettingNumber(
      "IMAGE_FORCE_WEB_MAX_PIXELS",
      DEFAULT_FORCE_WEB_MAX_PIXELS,
      { positive: true }
    ),
  ]);

  return {
    minPixels: Math.min(minPixels, maxPixels),
    maxPixels: Math.max(minPixels, maxPixels),
  };
}

async function shouldForceWebBackend(
  input: RunImageGenerationInput,
  size: string
) {
  const requiresResponsesBackend = Boolean(
    input.requiresResponsesBackend || (input.mode === "chat" && input.agentMode)
  );
  if (!input.forceWebBackend || requiresResponsesBackend) return false;

  const { minPixels, maxPixels } = await getForceWebPixelRange();
  return isImageSizeWithinPixelRange(size, minPixels, maxPixels);
}

const TEXT_MODERATION_ONLY_CREDITS =
  getImageCreditCostBreakdown(DEFAULT_IMAGE_SIZE).moderationOnlyCredits;

type ImageCreditCostBreakdown = ReturnType<typeof getImageCreditCostBreakdown>;

function getChatRoundCount(result: GenerateImageResult) {
  return Math.max(1, Math.floor(result.agentRoundCount || 1));
}

function normalizeBillingMultiplier(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(100, Math.max(0.01, Math.round(parsed * 100) / 100));
}

function getConfigBillingMultiplier(config: ApiConfig) {
  if (
    config.backend?.type !== "pool-account" &&
    config.backend?.type !== "pool-api"
  ) {
    return 1;
  }
  return normalizeBillingMultiplier(config.backend.billingMultiplier);
}

function applyBillingMultiplier(credits: number, multiplier: number) {
  const amount = Math.max(0, credits);
  return multiplier === 1 ? amount : roundUpCreditAmount(amount * multiplier);
}

function applyBillingMultiplierToCreditCost(
  creditCost: ImageCreditCostBreakdown,
  multiplier: number
): ImageCreditCostBreakdown {
  if (multiplier === 1) return creditCost;
  return {
    ...creditCost,
    baseCredits: applyBillingMultiplier(creditCost.baseCredits, multiplier),
    moderationCredits: applyBillingMultiplier(
      creditCost.moderationCredits,
      multiplier
    ),
    moderationOnlyCredits: applyBillingMultiplier(
      creditCost.moderationOnlyCredits,
      multiplier
    ),
    totalCredits: applyBillingMultiplier(creditCost.totalCredits, multiplier),
  };
}

function resolveOutputRole(params: {
  input: RunImageGenerationInput;
  outputRole?: "final" | "agent_draft" | "choice";
  index: number;
  total: number;
}) {
  if (params.outputRole === "choice") return "choice";
  if (params.input.mode === "chat" && params.input.agentMode) {
    return (
      params.outputRole ||
      (params.index === params.total - 1 ? "final" : "agent_draft")
    );
  }
  return "final";
}

export type ImageGenerationOperationResult = {
  error?: string;
  generationId?: string;
  imageUrl?: string;
  /** 纯中转模式下携带的内联 base64，使响应层无需回源即可产出 b64_json。 */
  imageBase64?: string;
  imageFileId?: string;
  imageOutputs?: GenerateImageResult["imageOutputs"];
  model?: string;
  size?: string;
  revisedPrompt?: string;
  responseText?: string;
  responseThinking?: string;
  responseAgent?: string;
  agentEvents?: GenerateImageResult["agentEvents"];
  agentRoundCount?: GenerateImageResult["agentRoundCount"];
  webConversation?: GenerateImageResult["webConversation"];
  backendMember?: GenerateImageResult["backendMember"];
  responsesPreviousResponse?: GenerateImageResult["responsesPreviousResponse"];
  creditsConsumed?: number;
};

async function getStoredImageUrl(bucket: string, storageKey: string) {
  return `/api/storage/${bucket}/${storageKey}`;
}

async function toImageBuffer(result: {
  imageBase64?: string;
  imageUrl?: string;
}) {
  if (result.imageBase64) {
    const base64 = result.imageBase64.includes(",")
      ? result.imageBase64.split(",").pop() || result.imageBase64
      : result.imageBase64;
    return Buffer.from(base64, "base64");
  }

  if (!result.imageUrl) {
    throw new Error("Missing image data");
  }

  const response = await fetch(result.imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function getImageFileName(params: {
  generationId: string;
  contentType: string;
}) {
  const extension =
    params.contentType === "image/jpeg"
      ? "jpg"
      : params.contentType === "image/webp"
        ? "webp"
        : "png";
  return `${params.generationId}.${extension}`;
}

function toBlobPart(buffer: Buffer): BlobPart {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}

function getOutputFileCacheBackend(config: ApiConfig) {
  const backend = config.backend;
  if (
    !backend ||
    backend.type !== "pool-account" ||
    backend.accountBackend !== "responses"
  ) {
    return null;
  }
  if (process.env.IMAGE_CODEX_FILES_API_ENABLED !== "true") {
    return null;
  }
  return backend;
}

function getMultipartHeaders(config: ApiConfig) {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.headers || {})) {
    if (key.toLowerCase() === "content-type") continue;
    headers[key] = value;
  }
  headers.Authorization = `Bearer ${config.apiKey}`;
  return headers;
}

async function uploadResponsesImageFile(params: {
  config: ApiConfig;
  buffer: Buffer;
  contentType: string;
  generationId: string;
}): Promise<ResponsesUploadedImageFile | undefined> {
  if (!getOutputFileCacheBackend(params.config)) return undefined;

  const formData = new FormData();
  const fileName = getImageFileName({
    generationId: params.generationId,
    contentType: params.contentType,
  });
  formData.append(
    "file",
    new Blob([toBlobPart(params.buffer)], { type: params.contentType }),
    fileName
  );
  formData.append("purpose", "vision");

  try {
    const response = await fetch(
      `${stripTrailingSlash(params.config.baseUrl)}/files`,
      {
        method: "POST",
        headers: getMultipartHeaders(params.config),
        body: formData,
      }
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logWarn("Responses 输出图片上传 Files 失败", {
        status: response.status,
        generationId: params.generationId,
        body: body.slice(0, 500),
      });
      return undefined;
    }
    const payload = (await response.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    const fileId = typeof payload?.id === "string" ? payload.id : undefined;
    if (!fileId) {
      logWarn("Responses 输出图片上传 Files 未返回 file id", {
        generationId: params.generationId,
      });
      return undefined;
    }
    return { fileId, source: "files_api" };
  } catch (error) {
    logWarn("Responses 输出图片上传 Files 异常", {
      generationId: params.generationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

type StoredGeneratedImageOutput = {
  generationId: string;
  imageUrl: string;
  /** 纯中转模式下直接携带的上游 base64，避免回源我方存储。 */
  imageBase64?: string;
  imageFileId?: string;
  webImageMessageId?: string;
  webImageGroupId?: string;
  /** 纯中转模式下为空串（未落对象存储）。 */
  storageKey: string;
  fileSize: number;
  size: string;
  revisedPrompt?: string;
  upstreamRevisedPrompt?: string;
  actualSizeDetected: boolean;
  actualOutputFormat: string | null;
  actualOutputFormatDetected: boolean;
  outputRole?: "final" | "agent_draft" | "choice";
};

type ResponsesUploadedImageFile = {
  fileId: string;
  source: "files_api";
};

function resolveStoredImageFormat(buffer: Buffer, requestedFormat?: string) {
  const detectedFormat = detectImageOutputFormatFromBuffer(buffer);
  const fallbackFormat = normalizeOutputFormat(requestedFormat) || "png";
  const format = detectedFormat || fallbackFormat;
  return {
    format,
    contentType: getOutputFormatContentType(format),
    extension: getOutputFormatExtension(format),
    detected: Boolean(detectedFormat),
  };
}

function isPendingGeneration(generationId: string) {
  return and(eq(generation.id, generationId), eq(generation.status, "pending"));
}

function readUInt24LE(buffer: Buffer, offset: number) {
  return buffer.readUIntLE(offset, 3);
}

function getPngDimensions(buffer: Buffer) {
  if (
    buffer.length < 24 ||
    buffer.readUInt32BE(0) !== 0x89504e47 ||
    buffer.readUInt32BE(4) !== 0x0d0a1a0a
  ) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function getJpegDimensions(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = buffer.readUInt8(offset + 1);
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > buffer.length) break;

    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && length >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }

  return null;
}

function getWebpDimensions(buffer: Buffer) {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: readUInt24LE(buffer, 24) + 1,
      height: readUInt24LE(buffer, 27) + 1,
    };
  }

  return null;
}

function getImageDimensionsFromBuffer(buffer: Buffer) {
  const dimensions =
    getPngDimensions(buffer) ||
    getJpegDimensions(buffer) ||
    getWebpDimensions(buffer);
  if (!dimensions?.width || !dimensions.height) return null;
  return dimensions;
}

function getInputImages(input: RunImageGenerationInput): ImageInputFile[] {
  if (input.mode === "generate") return [];
  return input.images || [];
}

function getChatHistoryText(message: ChatHistoryMessage) {
  if (message.error) return "";
  if (message.role === "user") return message.text || "";

  const variants = message.variants || [];
  const variant = variants[message.activeVariant || 0] || variants[0];
  const imageNote = variant?.imageUrl
    ? `\nGenerated image: ${variant.imageUrl}`
    : "";
  return `${variant?.text || message.text || ""}${imageNote}`;
}

function getChatContextLength(params: {
  prompt: string;
  apiPrompt?: string;
  fileContext?: string;
  promptOptimization?: boolean;
  history?: ChatHistoryMessage[];
}) {
  const basePrompt =
    params.promptOptimization === false
      ? params.prompt
      : params.apiPrompt || params.prompt;
  const currentPrompt = params.fileContext
    ? `${basePrompt}\n\n${params.fileContext}`
    : basePrompt;

  return (
    currentPrompt.length +
    (params.history || []).reduce(
      (total, message) => total + getChatHistoryText(message).length,
      0
    )
  );
}

function buildPromptOptimizationMetadata(params: {
  input: RunImageGenerationInput;
  promptOptimization: boolean;
  apiPrompt: string;
}) {
  const requestedApiPrompt = params.input.apiPrompt || "";
  return {
    promptOptimization: {
      enabled: params.promptOptimization,
      explicit: params.input.promptOptimization !== undefined,
      apiPromptProvided: Boolean(requestedApiPrompt),
      apiPromptUsed:
        params.promptOptimization && params.apiPrompt !== params.input.prompt,
      platformPromptRewriteDisabled: !params.promptOptimization,
      originalPromptInstructionInjected: false,
      effectivePromptChanged: params.apiPrompt !== params.input.prompt,
      effectivePromptKind: !params.promptOptimization
        ? "original"
        : params.apiPrompt !== params.input.prompt
          ? "api_prompt"
          : "original",
      originalPromptLength: params.input.prompt.length,
      effectivePromptLength: params.apiPrompt.length,
    },
  };
}

function buildRevisedPromptMetadata(params: {
  input: RunImageGenerationInput;
  apiPrompt: string;
  result: { revisedPrompt?: string; upstreamRevisedPrompt?: string };
}) {
  const upstreamRevisedPrompt =
    params.result.upstreamRevisedPrompt?.trim() ||
    params.result.revisedPrompt?.trim() ||
    "";
  return {
    promptOptimizationResult: {
      hasRevisedPrompt: Boolean(params.result.revisedPrompt?.trim()),
      hasUpstreamRevisedPrompt: Boolean(upstreamRevisedPrompt),
      upstreamRevisedPromptChangedFromOriginal:
        Boolean(upstreamRevisedPrompt) &&
        upstreamRevisedPrompt !== params.input.prompt,
      upstreamRevisedPromptChangedFromEffective:
        Boolean(upstreamRevisedPrompt) &&
        upstreamRevisedPrompt !== params.apiPrompt,
      upstreamRevisedPromptLength: upstreamRevisedPrompt.length,
      upstreamRevisedPromptSuppressed:
        params.input.promptOptimization === false &&
        Boolean(upstreamRevisedPrompt),
    },
  };
}

function buildResponseOutputMetadata(result: GenerateImageResult) {
  const agentEvents = sanitizeAgentEventsForMetadata(result.agentEvents);

  return {
    responseOutput: {
      responseText: result.responseText,
      responseThinking: result.responseThinking,
      responseAgent: result.responseAgent,
      agentEvents,
      agentRoundCount: result.agentRoundCount,
      webConversation: result.webConversation,
      backendMember: result.backendMember,
      responsesPreviousResponse: result.responsesPreviousResponse,
    },
  };
}

function sanitizeAgentEventsForMetadata(
  events: GenerateImageResult["agentEvents"] | undefined
) {
  return events?.map((event) => {
    const next = { ...event };
    delete next.imageBase64;
    if (next.imageUrl?.startsWith("data:image/")) {
      delete next.imageUrl;
    }
    return next;
  });
}

function getResultImageOutputs(result: GenerateImageResult) {
  const outputs = (result.imageOutputs || []).filter(
    (item) => item.imageBase64 || item.imageUrl
  );
  if (outputs.length > 0) return outputs;
  if (!result.imageBase64 && !result.imageUrl) return [];
  return [
    {
      imageBase64: result.imageBase64,
      imageUrl: result.imageUrl,
      revisedPrompt: result.revisedPrompt,
      upstreamRevisedPrompt: result.upstreamRevisedPrompt,
      index: 0,
    },
  ] satisfies NonNullable<GenerateImageResult["imageOutputs"]>;
}

function resolveOutputGenerationId(
  parentGenerationId: string,
  index: number,
  total: number
) {
  return index === total - 1
    ? parentGenerationId
    : `${parentGenerationId}-${index + 1}`;
}

async function storeGeneratedImageOutput(params: {
  output: {
    imageBase64?: string;
    imageUrl?: string;
    imageFileId?: string;
    webImageMessageId?: string;
    webImageGroupId?: string;
    revisedPrompt?: string;
    upstreamRevisedPrompt?: string;
    outputRole?: "final" | "agent_draft" | "choice";
  };
  config: ApiConfig;
  userId: string;
  generationId: string;
  bucket: string;
  requestedSize: string;
  requestedFormat?: string;
}) {
  const imageBuffer = await toImageBuffer(params.output);
  const storedFormat = resolveStoredImageFormat(
    imageBuffer,
    params.requestedFormat
  );
  const storageKey = `${params.userId}/${nanoid(32)}.${storedFormat.extension}`;
  let actualSize = params.requestedSize || DEFAULT_IMAGE_SIZE;
  let actualSizeDetected = false;
  const actualDimensions = getImageDimensionsFromBuffer(imageBuffer);
  if (actualDimensions) {
    actualSizeDetected = true;
    actualSize = normalizeImageSize(
      actualDimensions.width,
      actualDimensions.height
    );
  }
  const storage = await getStorageProvider();
  await storage.putObject(
    storageKey,
    params.bucket,
    imageBuffer,
    storedFormat.contentType
  );
  const uploadedImageFile =
    params.output.imageFileId ||
    (
      await uploadResponsesImageFile({
        config: params.config,
        buffer: imageBuffer,
        contentType: storedFormat.contentType,
        generationId: params.generationId,
      })
    )?.fileId;

  return {
    generationId: params.generationId,
    imageUrl: await getStoredImageUrl(params.bucket, storageKey),
    imageFileId: uploadedImageFile,
    webImageMessageId: params.output.webImageMessageId,
    webImageGroupId: params.output.webImageGroupId,
    storageKey,
    fileSize: imageBuffer.length,
    size: actualSize,
    revisedPrompt:
      params.output.revisedPrompt || params.output.upstreamRevisedPrompt,
    upstreamRevisedPrompt: params.output.upstreamRevisedPrompt,
    actualSizeDetected,
    actualOutputFormat: storedFormat.format,
    actualOutputFormatDetected: storedFormat.detected,
    outputRole: params.output.outputRole,
  } satisfies StoredGeneratedImageOutput;
}

async function emitAgentOperationEvent(
  callbacks: ImageGenerationCallbacks | undefined,
  event: NonNullable<GenerateImageResult["agentEvents"]>[number]
) {
  await callbacks?.onAgentEvent?.({
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
  });
}

function buildBackendExecutionMetadata(params: {
  config: ApiConfig;
  useCredits: boolean;
}) {
  const backend = params.config.backend || { type: "platform" as const };
  return {
    backend: {
      type: backend.type,
      id: backend.id,
      groupId: backend.groupId,
      requestKind: backend.requestKind,
      accountBackend: backend.accountBackend,
      apiInterfaceMode: backend.apiInterfaceMode,
      apiForceResponsesEndpoint: backend.apiForceResponsesEndpoint,
      useCredits: params.useCredits,
      baseUrl: params.config.baseUrl,
      model: params.config.model,
      apiKeyId: backend.apiKeyId,
      billingGroupId: backend.billingGroupId,
      billingMultiplier: backend.billingMultiplier,
    },
  };
}

function usesPoolAccountBackend(config: ApiConfig) {
  return config.backend?.type === "pool-account";
}

async function resolveRequestedPoolGptModel(params: {
  config: ApiConfig;
  model?: string;
  allowGpt55: boolean;
}) {
  const requested = params.model?.trim();
  if (!usesPoolAccountBackend(params.config)) return undefined;
  if (params.config.backend?.accountBackend === "web") {
    if (!requested) {
      const configured = params.config.model?.trim();
      if (configured === GPT55_CHAT_MODEL && !params.allowGpt55) {
        return undefined;
      }
      return configured || undefined;
    }
    if (requested.startsWith("gpt-image-")) {
      throw new Error("Unsupported GPT model. Use a non-image model.");
    }
    if (requested === GPT55_CHAT_MODEL && !params.allowGpt55) {
      throw new Error("GPT-5.5 chat model requires Ultra plan.");
    }
    return requested;
  }
  return await getResponsesModel(params.config, requested, {
    allowGpt55: params.allowGpt55,
  });
}

function buildModelMetadata(params: {
  imageModel: string;
  gptModel?: string;
  recordModel: string;
}) {
  return {
    models: {
      imageModel: params.imageModel,
      gptModel: params.gptModel || null,
      recordModel: params.recordModel,
    },
  };
}

async function getUserModerationBlockRiskLevel(
  userId: string,
  plan: Awaited<ReturnType<typeof getUserPlan>>["plan"],
  requested?: ModerationBlockRiskLevel
) {
  if (requested) {
    return await normalizePlanModerationBlockRiskLevel(plan, requested);
  }

  const [row] = await db
    .select({ moderationBlockRiskLevel: user.moderationBlockRiskLevel })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return await normalizePlanModerationBlockRiskLevel(
    plan,
    row?.moderationBlockRiskLevel
  );
}

export async function runImageGenerationForUser(
  input: RunImageGenerationInput,
  callbacks?: ImageGenerationCallbacks
): Promise<ImageGenerationOperationResult> {
  const generationId = input.generationId || nanoid();
  const size = input.size || DEFAULT_IMAGE_SIZE;
  const requiresResponsesBackend = Boolean(
    input.requiresResponsesBackend || (input.mode === "chat" && input.agentMode)
  );
  const forceWebBackend = await shouldForceWebBackend(input, size);
  const mixWebFirst = Boolean(
    input.mixWebFirst &&
      isOneKImageSize(size) &&
      !requiresResponsesBackend &&
      !forceWebBackend
  );
  const inputImages = getInputImages(input);
  const isChatInput = input.mode === "chat";
  const bucket =
    (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
    "generations";
  const userPlan = await getUserPlan(input.userId);
  const planCapabilities = await getPlanCapabilitySnapshot(userPlan.plan);
  const queueSettings = await getPlanQueueSettings(userPlan.plan);
  const moderationBlockRiskLevel = await getUserModerationBlockRiskLevel(
    input.userId,
    userPlan.plan,
    input.moderationBlockRiskLevel
  );
  const moderationBlockingEnabled =
    planCapabilities.features["moderation.blocking"];
  const promptOptimizationAllowed =
    planCapabilities.features["promptOptimization.control"];
  const explicitPromptOptimization =
    input.promptOptimization !== undefined || Boolean(input.apiPrompt);

  if (explicitPromptOptimization && !promptOptimizationAllowed) {
    return {
      error: "Prompt optimization control requires Pro plan or higher.",
      generationId,
    };
  }

  const promptOptimization = input.promptOptimization ?? true;
  const apiPrompt = promptOptimization
    ? input.apiPrompt || input.prompt
    : input.prompt;
  const moderationPrompt =
    input.mode === "chat" || !promptOptimization ? input.prompt : apiPrompt;

  if (
    input.mode === "generate" &&
    !planCapabilities.features["imageGeneration.text"]
  ) {
    return {
      error: "Text image generation is not enabled for this plan.",
      generationId,
    };
  }
  if (
    input.mode === "edit" &&
    !planCapabilities.features["imageGeneration.edit"]
  ) {
    return {
      error: "Image editing is not enabled for this plan.",
      generationId,
    };
  }
  if (input.mode === "chat" && input.backendRequestKind !== "responses") {
    const chatCapability = input.agentMode
      ? input.apiKeyId
        ? "externalApi.agent"
        : "imageGeneration.agent"
      : input.waterfallMode
        ? "imageGeneration.waterfall"
        : input.apiKeyId
          ? "externalApi.chat.completions"
          : "imageGeneration.chat";
    const chatLabel = input.agentMode
      ? input.apiKeyId
        ? "External Agent API"
        : "Agent mode"
      : input.waterfallMode
        ? "Waterfall mode"
        : input.apiKeyId
          ? "External Chat Completions API"
          : "Chat mode";
    if (!planCapabilities.features[chatCapability]) {
      return {
        error: `${chatLabel} is not enabled for this plan.`,
        generationId,
      };
    }
  }
  if (
    input.mode === "chat" &&
    input.backendRequestKind === "responses" &&
    !planCapabilities.features["externalApi.responses"]
  ) {
    return {
      error: "External Responses API is not enabled for this plan.",
      generationId,
    };
  }
  const requestedCount =
    input.mode === "generate" || input.mode === "edit" || input.mode === "chat"
      ? input.n || 1
      : 1;
  if (
    requestedCount > 1 &&
    !planCapabilities.features["imageGeneration.batch"]
  ) {
    return {
      error: "Batch image generation is not enabled for this plan.",
      generationId,
    };
  }
  if (requestedCount > planCapabilities.limits.maxBatchCount) {
    return {
      error: `Image count must be no more than ${planCapabilities.limits.maxBatchCount}.`,
      generationId,
    };
  }
  const maxChatContextChars =
    input.mode === "chat"
      ? input.maxChatContextChars || planCapabilities.limits.maxChatContextChars
      : planCapabilities.limits.maxChatContextChars;
  if (
    input.mode === "chat" &&
    getChatContextLength({
      prompt: input.prompt,
      apiPrompt,
      fileContext: input.fileContext,
      promptOptimization,
      history: input.history,
    }) > maxChatContextChars
  ) {
    return {
      error: `Chat input context must be no more than ${maxChatContextChars} characters.`,
      generationId,
    };
  }
  if (
    requiresResponsesBackend &&
    input.mode !== "chat" &&
    input.backendRequestKind !== "image_edit"
  ) {
    return {
      error: "Exact image references require image edit or Chat/Agent mode.",
      generationId,
    };
  }

  const userConfig = await getUserApiConfig(input.userId);
  const backendRequestKind =
    input.backendRequestKind ??
    (input.mode === "generate"
      ? "image_generation"
      : input.mode === "edit"
        ? "image_edit"
        : "chat");
  let effectiveConfig: Awaited<ReturnType<typeof getEffectiveConfig>>;
  try {
    try {
      effectiveConfig = await getEffectiveConfig(userConfig, {
        userId: input.userId,
        apiKeyId: input.apiKeyId,
        requestKind: backendRequestKind,
        preferredMemberId: input.preferredBackendMemberId,
        accountBackendPreference: requiresResponsesBackend
          ? "responses"
          : forceWebBackend || mixWebFirst
            ? "web"
            : undefined,
        accountBackendPreferenceMode: forceWebBackend
          ? "mixed-only"
          : undefined,
        ignoreUserConfig: requiresResponsesBackend,
      });
    } catch (error) {
      if (
        !mixWebFirst ||
        !(error instanceof ImageBackendPoolUnavailableError)
      ) {
        throw error;
      }
      effectiveConfig = await getEffectiveConfig(userConfig, {
        userId: input.userId,
        apiKeyId: input.apiKeyId,
        requestKind: backendRequestKind,
        preferredMemberId: input.preferredBackendMemberId,
        accountBackendPreference: "responses",
        ignoreUserConfig: requiresResponsesBackend,
      });
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "当前没有可用的生图后端",
      generationId,
    };
  }
  const { config, useCredits } = effectiveConfig;
  const billingMultiplier = getConfigBillingMultiplier(config);
  const moderationEnabled =
    (await isContentModerationEnabled()) &&
    moderationBlockingEnabled &&
    config.contentSafetyEnabled !== false;
  const moderationImageCount = moderationEnabled ? inputImages.length : 0;
  const imageBasePricing = await getRuntimeImageBaseCreditPricing();
  const baseCreditCost = getImageCreditCostBreakdown(size, {
    textModerationCount: moderationEnabled ? undefined : 0,
    imageModerationCount: moderationImageCount,
    basePricing: imageBasePricing,
  });
  const creditCost = applyBillingMultiplierToCreditCost(
    baseCreditCost,
    billingMultiplier
  );
  const creditsPerImage = creditCost.totalCredits;
  const chatRoundCredits = isChatInput
    ? applyBillingMultiplier(
        input.agentMode
          ? planCapabilities.billing.agentRoundCredits
          : planCapabilities.billing.chatRoundCredits,
        billingMultiplier
      )
    : 0;
  const initialCreditCharge = isChatInput ? chatRoundCredits : creditsPerImage;
  const moderationFailureCredits = moderationEnabled
    ? planCapabilities.features["moderation.onlyFailureSettlement"]
      ? isChatInput
        ? Math.min(
            applyBillingMultiplier(
              TEXT_MODERATION_ONLY_CREDITS,
              billingMultiplier
            ),
            chatRoundCredits
          )
        : creditCost.moderationOnlyCredits
      : initialCreditCharge
    : 0;
  let imageModel: string;
  let gptModel: string | undefined;
  let recordModel: string;
  try {
    if (input.mode === "chat") {
      if (
        config.backend?.type === "pool-account" &&
        config.backend.accountBackend === "web"
      ) {
        gptModel = await resolveRequestedPoolGptModel({
          config,
          model: input.model,
          allowGpt55: planCapabilities.features["models.gpt55"],
        });
      } else {
        gptModel = await getResponsesModel(config, input.model, {
          allowGpt55: planCapabilities.features["models.gpt55"],
        });
      }
      const requestedImageModel = getImageModel(input.imageModel, config.model);
      if (!requestedImageModel) {
        throw new Error(
          "Unsupported model for image generation. Use a gpt-image-* model."
        );
      }
      imageModel = requestedImageModel;
      recordModel = gptModel || imageModel;
    } else {
      const requestedImageModel = getImageModel(input.model, config.model);
      if (!requestedImageModel) {
        throw new Error(
          "Unsupported model for image generation. Use a gpt-image-* model."
        );
      }
      imageModel = requestedImageModel;
      gptModel = await resolveRequestedPoolGptModel({
        config,
        model: input.gptModel,
        allowGpt55: planCapabilities.features["models.gpt55"],
      });
      recordModel = imageModel;
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid model.",
      generationId,
    };
  }

  if (!imageModel || !recordModel) {
    return {
      error: "Invalid model.",
      generationId,
    };
  }

  try {
    return await withImageGenerationQueue(
      {
        userId: input.userId,
        priority: queueSettings.priority,
        userConcurrency: queueSettings.userConcurrency,
      },
      () =>
        runQueuedImageGenerationForUser({
          input,
          callbacks,
          generationId,
          size,
          inputImages,
          creditCost,
          creditsPerImage,
          isChatInput,
          initialCreditCharge,
          chatRoundCredits,
          bucket,
          userPlan,
          moderationBlockRiskLevel,
          moderationFailureCredits,
          promptOptimization,
          apiPrompt,
          moderationPrompt,
          imageBasePricing,
          config,
          useCredits,
          billingMultiplier,
          imageModel,
          gptModel,
          recordModel,
          allowGpt55: planCapabilities.features["models.gpt55"],
          moderationEnabled,
          forceWebBackend,
        })
    );
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Image generation queue is busy. Please retry shortly.",
      generationId,
    };
  }
}

async function runQueuedImageGenerationForUser({
  input,
  callbacks,
  generationId,
  size,
  inputImages,
  creditCost,
  creditsPerImage,
  isChatInput,
  initialCreditCharge,
  chatRoundCredits,
  bucket,
  userPlan,
  moderationBlockRiskLevel,
  moderationFailureCredits,
  promptOptimization,
  apiPrompt,
  moderationPrompt,
  imageBasePricing,
  config,
  useCredits,
  billingMultiplier,
  imageModel,
  gptModel,
  recordModel,
  allowGpt55,
  moderationEnabled,
  forceWebBackend,
}: {
  input: RunImageGenerationInput;
  callbacks?: ImageGenerationCallbacks;
  generationId: string;
  size: string;
  inputImages: ImageInputFile[];
  creditCost: ImageCreditCostBreakdown;
  creditsPerImage: number;
  isChatInput: boolean;
  initialCreditCharge: number;
  chatRoundCredits: number;
  bucket: string;
  userPlan: Awaited<ReturnType<typeof getUserPlan>>;
  moderationBlockRiskLevel: ModerationBlockRiskLevel;
  moderationFailureCredits: number;
  promptOptimization: boolean;
  apiPrompt: string;
  moderationPrompt: string;
  imageBasePricing: ImageBaseCreditPricing;
  config: Awaited<ReturnType<typeof getEffectiveConfig>>["config"];
  useCredits: boolean;
  billingMultiplier: number;
  imageModel: string;
  gptModel?: string;
  recordModel: string;
  allowGpt55: boolean;
  moderationEnabled: boolean;
  forceWebBackend: boolean;
}): Promise<ImageGenerationOperationResult> {
  const startedAt = Date.now();
  // 纯中转模式：不写 generation 历史、不上传对象存储；仍扣费/审核/退款。
  // generationId 仍生成，仅作扣费/退款的幂等 sourceRef 前缀。
  const relayOnly = input.relayOnly === true;
  const promptOptimizationMetadata = buildPromptOptimizationMetadata({
    input,
    promptOptimization,
    apiPrompt,
  });
  const backendMetadata = buildBackendExecutionMetadata({ config, useCredits });
  const billingMetadata = {
    billingMultiplier,
    billingGroupId: config.backend?.billingGroupId ?? null,
  };
  const modelMetadata = buildModelMetadata({
    imageModel,
    gptModel,
    recordModel,
  });
  const inputImagesMetadata = buildInputImagesMetadata(inputImages);
  const mixWebFirst = Boolean(
    input.mixWebFirst && isOneKImageSize(size) && !forceWebBackend
  );
  const isAgentChatInput = input.mode === "chat" && input.agentMode === true;

  // 纯中转：不落生成历史。其余 db.update(generation) 在无行时天然 no-op。
  if (!relayOnly)
    await db.insert(generation).values({
      id: generationId,
      userId: input.userId,
      prompt: input.prompt,
      model: recordModel,
      size,
      status: "pending",
      creditsConsumed: useCredits ? initialCreditCharge : 0,
      storageBucket: bucket,
      metadata:
        input.mode === "edit"
          ? {
              mode: "edit",
              ...backendMetadata,
              ...modelMetadata,
              ...promptOptimizationMetadata,
              ...inputImagesMetadata,
            imageCount: input.images.length,
            hasMask: Boolean(input.mask),
            quality: input.quality || "auto",
            outputFormat: input.outputFormat || null,
            outputCompression: input.outputCompression ?? null,
            background: input.background || null,
            batchCount: input.n || 1,
            forceWebBackend,
            creditCost,
            ...billingMetadata,
            chatRoundCredits,
            moderationBlockingEnabled: moderationEnabled,
            moderationFailureCredits,
          }
        : input.mode === "chat"
          ? {
              mode: input.agentMode
                ? "agent"
                : input.waterfallMode
                  ? "waterfall"
                  : "chat",
              action: "auto",
              ...backendMetadata,
              ...modelMetadata,
              ...promptOptimizationMetadata,
              ...inputImagesMetadata,
              imageCount: input.images?.length || 0,
              fileContextChars: input.fileContext?.length || 0,
              quality: input.quality || "auto",
              moderation: input.moderation || "auto",
              outputFormat: input.outputFormat || null,
              outputCompression: input.outputCompression ?? null,
              batchCount: input.n || 1,
              forceWebBackend,
              creditCost,
              ...billingMetadata,
              moderationBlockingEnabled: moderationEnabled,
              moderationFailureCredits,
            }
          : {
              mode: "generate",
              ...backendMetadata,
              ...modelMetadata,
              ...promptOptimizationMetadata,
              quality: input.quality || "auto",
              moderation: input.moderation || "auto",
              outputFormat: input.outputFormat || null,
              outputCompression: input.outputCompression ?? null,
              background: input.background || null,
              batchCount: input.n || 1,
              forceWebBackend,
              creditCost,
              ...billingMetadata,
              moderationBlockingEnabled: moderationEnabled,
              moderationFailureCredits,
            },
  });

  let chargedCredits = 0;
  const refundChargedCredits = async (
    amount: number,
    sourceRef: string,
    description: string
  ) => {
    if (!useCredits || amount <= 0) return;
    const roundedAmount = roundCreditAmount(amount);
    await refundGenerationCredits({
      generationId,
      userId: input.userId,
      amount: roundedAmount,
      sourceRef,
      description,
    });
    await refundExternalApiKeyCredits({
      apiKeyId: input.apiKeyId,
      userId: input.userId,
      amount: roundedAmount,
    });
    chargedCredits = roundCreditAmount(
      Math.max(0, chargedCredits - roundedAmount)
    );
  };
  const chargeAdditionalCredits = async (
    amount: number,
    serviceName: string,
    description: string,
    metadata?: Record<string, unknown>,
    sourceRef?: string
  ) => {
    if (!useCredits || amount <= 0) return;
    const roundedAmount = roundCreditAmount(amount);
    await reserveExternalApiKeyCredits({
      apiKeyId: input.apiKeyId,
      userId: input.userId,
      amount: roundedAmount,
    });
    let userCreditsConsumed = false;
    try {
      await consumeCredits({
        userId: input.userId,
        amount: roundedAmount,
        serviceName,
        description,
        sourceRef,
        metadata: {
          ...metadata,
          externalApiKeyId: input.apiKeyId,
        },
      });
      userCreditsConsumed = true;
    } finally {
      if (!userCreditsConsumed) {
        await refundExternalApiKeyCredits({
          apiKeyId: input.apiKeyId,
          userId: input.userId,
          amount: roundedAmount,
        });
      }
    }
    chargedCredits = roundCreditAmount(chargedCredits + roundedAmount);
  };
  const settleChargedCredits = async (
    targetCredits: number,
    serviceName: string,
    sourceRef: string,
    description: string,
    metadata?: Record<string, unknown>
  ) => {
    if (!useCredits) return;

    const roundedTarget = roundCreditAmount(Math.max(0, targetCredits));
    const delta = roundCreditAmount(roundedTarget - chargedCredits);
    if (delta > 0) {
      // 结算补扣用独立 sourceRef，避免与初始扣费 / 退款 sourceRef 冲突而被误判重复。
      await chargeAdditionalCredits(
        delta,
        serviceName,
        description,
        {
          ...metadata,
          previousCredits: chargedCredits,
          targetCredits: roundedTarget,
        },
        `${sourceRef}:charge`
      );
      return;
    }

    if (delta < 0) {
      await refundChargedCredits(Math.abs(delta), sourceRef, description);
    }
  };

  if (useCredits) {
    try {
      await chargeAdditionalCredits(
        initialCreditCharge,
        isChatInput ? "chat-input" : "image-generation",
        isChatInput
          ? `Chat input: ${input.prompt.substring(0, 50)}`
          : `Image generation: ${input.prompt.substring(0, 50)}`,
        {
          generationId,
          mode: input.mode,
          size,
          creditCost,
          billingMultiplier,
          billingGroupId: config.backend?.billingGroupId ?? null,
          initialCredits: initialCreditCharge,
          targetImageCredits: creditsPerImage,
        },
        `${generationId}:charge`
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Insufficient credits";
      await db
        .update(generation)
        .set({
          status: "failed",
          error: message,
          creditsConsumed: chargedCredits,
        })
        .where(isPendingGeneration(generationId));
      return { error: message, generationId };
    }
  }

  const isTimedOut = () =>
    Date.now() - startedAt > IMAGE_GENERATION_PENDING_TIMEOUT_MS;
  const failTimedOutGeneration =
    async (): Promise<ImageGenerationOperationResult> => {
      const targetCredits = getFailedGenerationTargetCredits({
        reason: "generation_error",
        moderationFailureCredits,
        moderationOnlyCredits: creditCost.moderationOnlyCredits,
      });
      const creditsToRefund = Math.max(0, chargedCredits - targetCredits);
      const refundSourceRef = `${generationId}:timeout-refund`;

      const [updated] = await db
        .update(generation)
        .set({
          status: "failed",
          error: IMAGE_GENERATION_TIMEOUT_ERROR,
          creditsConsumed: chargedCredits,
          completedAt: new Date(),
          metadata: sql`COALESCE(${generation.metadata}, '{}'::json)::jsonb || ${JSON.stringify(
            {
              timeout: {
                reason: "runtime_timeout",
                timeoutMs: IMAGE_GENERATION_PENDING_TIMEOUT_MS,
                elapsedMs: Date.now() - startedAt,
                targetCredits,
                refundCredits: creditsToRefund,
                refundSourceRef,
              },
            }
          )}::jsonb`,
        })
        .where(isPendingGeneration(generationId))
        .returning({ id: generation.id });

      // 中转模式无 generation 行，UPDATE 返回空；退款仍须照常执行。
      if ((updated || relayOnly) && creditsToRefund > 0) {
        try {
          await refundChargedCredits(
            creditsToRefund,
            refundSourceRef,
            `Refund timed out image generation charge: ${input.prompt.slice(
              0,
              50
            )}`
          );
          await db
            .update(generation)
            .set({
              creditsConsumed: chargedCredits,
              metadata: sql`COALESCE(${generation.metadata}, '{}'::json)::jsonb || ${JSON.stringify(
                {
                  timeoutRefund: {
                    sourceRef: refundSourceRef,
                    creditsRefunded: creditsToRefund,
                    settledAt: new Date().toISOString(),
                  },
                }
              )}::jsonb`,
            })
            .where(eq(generation.id, generationId));
        } catch {
          /* best effort settlement */
        }
      }

      return {
        error: IMAGE_GENERATION_TIMEOUT_ERROR,
        generationId,
        creditsConsumed: chargedCredits,
      };
    };

  const moderation = !moderationEnabled
    ? ({ decision: "skipped" } as const)
    : await moderateContent({
        prompt: moderationPrompt,
        images: inputImages,
        mode: inputImages.length > 0 ? "image" : "text",
        userId: input.userId,
        userPlan: userPlan.plan,
        userModerationBlockRiskLevel: moderationBlockRiskLevel,
        generationId,
      });

  if (isTimedOut()) {
    return failTimedOutGeneration();
  }

  if (moderation.decision === "block" || moderation.decision === "error") {
    const targetCredits = getFailedGenerationTargetCredits({
      reason:
        moderation.decision === "block"
          ? "moderation_block"
          : "moderation_error",
      moderationFailureCredits,
      moderationOnlyCredits: creditCost.moderationOnlyCredits,
    });
    try {
      await settleChargedCredits(
        targetCredits,
        "content-moderation",
        `${generationId}:moderation`,
        `Settle after moderation stop: ${input.prompt.substring(0, 50)}`,
        {
          generationId,
          moderationDecision: moderation.decision,
          creditCost,
        }
      );
    } catch {
      /* best effort settlement */
    }
    const message =
      moderation.decision === "block"
        ? "Content failed moderation"
        : "Content moderation is temporarily unavailable";
    const responseMessage = moderation.reason || message;
    await db
      .update(generation)
      .set({
        status: "failed",
        error: responseMessage,
        creditsConsumed: chargedCredits,
      })
      .where(isPendingGeneration(generationId));
    return {
      error: responseMessage,
      generationId,
      creditsConsumed: chargedCredits,
    };
  }

  let result: GenerateImageResult;
  try {
    result =
      input.mode === "edit"
        ? await editImage(
            config,
            {
              prompt: input.prompt,
              apiPrompt,
              promptOptimization,
              signal: AbortSignal.timeout(IMAGE_GENERATION_PENDING_TIMEOUT_MS),
              images: input.images,
              mask: input.mask,
              size: input.size,
              model: imageModel,
              gptModel,
              thinking: input.thinking,
              quality: input.quality,
              n: input.n,
              moderation: input.moderation,
              outputFormat: input.outputFormat,
              outputCompression: input.outputCompression,
              background: input.background,
              mixWebFirst,
              forceWebBackend,
              requiresResponsesBackend: input.requiresResponsesBackend,
            },
            callbacks
          )
        : input.mode === "chat"
          ? await generateChatImage(
              config,
              {
                prompt: input.prompt,
                apiPrompt,
                fileContext: input.fileContext,
                files: input.files,
                promptOptimization,
                signal: AbortSignal.timeout(
                  IMAGE_GENERATION_PENDING_TIMEOUT_MS
                ),
                images: input.images,
                history: input.history,
                size,
                model: gptModel,
                imageModel,
                allowGpt55,
                quality: input.quality,
                n: input.n,
                moderation: input.moderation,
                outputFormat: input.outputFormat,
                outputCompression: input.outputCompression,
                stream: input.stream,
                thinking: input.thinking,
                agentMode: input.agentMode,
                agentMaxRounds: input.agentMaxRounds,
                agentForceMaxRounds: input.agentForceMaxRounds,
                rawResponsesBody: input.rawResponsesBody,
                mixWebFirst,
                requiresResponsesBackend: input.requiresResponsesBackend,
              },
              callbacks
            )
          : await generateImage(
              config,
              {
                prompt: input.prompt,
                apiPrompt,
                promptOptimization,
                signal: AbortSignal.timeout(
                  IMAGE_GENERATION_PENDING_TIMEOUT_MS
                ),
                size,
                model: imageModel,
                gptModel,
                thinking: input.thinking,
                n: input.n,
                quality: input.quality,
                moderation: input.moderation,
                outputFormat: input.outputFormat,
                outputCompression: input.outputCompression,
                background: input.background,
                mixWebFirst,
                forceWebBackend,
                requiresResponsesBackend: input.requiresResponsesBackend,
              },
              callbacks
            );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Image generation failed";
    const targetCredits = getFailedGenerationTargetCredits({
      reason: "generation_error",
      moderationFailureCredits,
      moderationOnlyCredits: creditCost.moderationOnlyCredits,
    });
    try {
      await settleChargedCredits(
        targetCredits,
        "content-moderation",
        `${generationId}:generation-exception`,
        `Settle failed generation exception: ${input.prompt.substring(0, 50)}`,
        {
          generationId,
          creditCost,
          error: message,
        }
      );
    } catch {
      /* best effort settlement */
    }
    await db
      .update(generation)
      .set({
        status: "failed",
        error: message,
        creditsConsumed: chargedCredits,
      })
      .where(isPendingGeneration(generationId));
    return {
      error: message,
      generationId,
      creditsConsumed: chargedCredits,
    };
  }

  if (isTimedOut()) {
    return failTimedOutGeneration();
  }

  if (result.error) {
    const failureTargetCredits = getFailedGenerationTargetCredits({
      reason: "generation_error",
      moderationFailureCredits,
      moderationOnlyCredits: creditCost.moderationOnlyCredits,
    });
    try {
      await settleChargedCredits(
        failureTargetCredits,
        "content-moderation",
        `${generationId}:generation-error`,
        `Settle failed generation: ${input.prompt.substring(0, 50)}`,
        {
          generationId,
          creditCost,
          fullRefund: failureTargetCredits === 0,
          error: result.error,
        }
      );
    } catch {
      /* best effort settlement */
    }
    await db
      .update(generation)
      .set({
        status: "failed",
        error: result.error,
        creditsConsumed: chargedCredits,
      })
      .where(isPendingGeneration(generationId));
    return {
      error: result.error,
      generationId,
      creditsConsumed: chargedCredits,
    };
  }

  if (!result.imageBase64 && !result.imageUrl) {
    if (!isChatInput) {
      const message =
        result.responseText?.trim() ||
        result.responseAgent?.trim() ||
        "Image generation completed without an image output";
      const failureTargetCredits = getFailedGenerationTargetCredits({
        reason: "generation_error",
        moderationFailureCredits,
        moderationOnlyCredits: creditCost.moderationOnlyCredits,
      });
      try {
        await settleChargedCredits(
          failureTargetCredits,
          "content-moderation",
          `${generationId}:missing-image-output`,
          `Settle missing image output: ${input.prompt.substring(0, 50)}`,
          {
            generationId,
            creditCost,
            fullRefund: failureTargetCredits === 0,
            error: message,
          }
        );
      } catch {
        /* best effort settlement */
      }
      await db
        .update(generation)
        .set({
          status: "failed",
          error: message,
          creditsConsumed: chargedCredits,
          metadata: sql`COALESCE(${generation.metadata}, '{}'::json)::jsonb || ${JSON.stringify(
            {
              ...buildResponseOutputMetadata(result),
              missingImageOutput: true,
            }
          )}::jsonb`,
          completedAt: new Date(),
        })
        .where(isPendingGeneration(generationId));
      return {
        error: message,
        generationId,
        creditsConsumed: chargedCredits,
      };
    }

    let finalChargedCredits = chargedCredits;
    const textChatRoundCount = isChatInput ? getChatRoundCount(result) : 0;
    const targetChatTextCredits = chatRoundCredits * textChatRoundCount;
    if (isChatInput) {
      try {
        await settleChargedCredits(
          targetChatTextCredits,
          "chat-text-only",
          `${generationId}:chat-text-only`,
          `Settle chat text response: ${input.prompt.substring(0, 50)}`,
          {
            generationId,
            creditCost,
            chatRoundCredits,
            chatRoundCount: textChatRoundCount,
          }
        );
        finalChargedCredits = chargedCredits;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Insufficient credits";
        await db
          .update(generation)
          .set({
            status: "failed",
            error: message,
            creditsConsumed: chargedCredits,
          })
          .where(isPendingGeneration(generationId));
        return {
          error: "Insufficient credits",
          generationId,
          creditsConsumed: chargedCredits,
        };
      }
    }

    await db
      .update(generation)
      .set({
        status: "completed",
        revisedPrompt: result.revisedPrompt,
        creditsConsumed: finalChargedCredits,
        metadata: sql`COALESCE(${generation.metadata}, '{}'::json)::jsonb || ${JSON.stringify(
          {
            ...buildRevisedPromptMetadata({ input, apiPrompt, result }),
            ...buildResponseOutputMetadata(result),
            ...(isChatInput
              ? {
                  chatTextOnlyCharge: {
                    credits: useCredits ? targetChatTextCredits : 0,
                    chatRoundCredits: useCredits ? chatRoundCredits : 0,
                    chatRoundCount: textChatRoundCount,
                  },
                }
              : {}),
          }
        )}::jsonb`,
        completedAt: new Date(),
      })
      .where(isPendingGeneration(generationId));

    return {
      generationId,
      imageOutputs: result.imageOutputs,
      model: recordModel,
      size,
      revisedPrompt: result.revisedPrompt,
      responseText: result.responseText,
      responseThinking: result.responseThinking,
      responseAgent: result.responseAgent,
      agentEvents: result.agentEvents,
      agentRoundCount: result.agentRoundCount,
      webConversation: result.webConversation,
      backendMember: result.backendMember,
      responsesPreviousResponse: result.responsesPreviousResponse,
      creditsConsumed: finalChargedCredits,
    };
  }

  let storedOutputs: StoredGeneratedImageOutput[] = [];
  try {
    const imageOutputs = getResultImageOutputs(result).map(
      (output, index, items) => ({
        ...output,
        outputRole: resolveOutputRole({
          input,
          outputRole: output.outputRole,
          index,
          total: items.length,
        }),
      })
    ) satisfies NonNullable<GenerateImageResult["imageOutputs"]>;
    if (imageOutputs.length === 0) {
      throw new Error("Missing image data");
    }
    if (isAgentChatInput) {
      await emitAgentOperationEvent(callbacks, {
        kind: "tool",
        status: "running",
        title: "保存生成图片",
        detail: `正在保存 ${imageOutputs.length} 张图片并生成站内访问地址`,
        toolType: "image_storage",
      });
    }
    storedOutputs = [];
    if (relayOnly) {
      // 纯中转：不落对象存储，直接透传上游图片（base64 / 上游 URL）。
      // 不做实际尺寸/格式检测（无 buffer），按请求尺寸计费。
      storedOutputs = imageOutputs.map((output, index) => ({
        generationId: resolveOutputGenerationId(
          generationId,
          index,
          imageOutputs.length
        ),
        imageUrl: output.imageUrl ?? "",
        imageBase64: output.imageBase64,
        imageFileId: output.imageFileId,
        webImageMessageId: output.webImageMessageId,
        webImageGroupId: output.webImageGroupId,
        storageKey: "",
        fileSize: 0,
        size,
        revisedPrompt: output.revisedPrompt || output.upstreamRevisedPrompt,
        upstreamRevisedPrompt: output.upstreamRevisedPrompt,
        actualSizeDetected: false,
        actualOutputFormat: null,
        actualOutputFormatDetected: false,
        outputRole: output.outputRole,
      }));
      if (isAgentChatInput) {
        await emitAgentOperationEvent(callbacks, {
          kind: "tool",
          status: "completed",
          title: "图片就绪",
          detail: `已就绪 ${storedOutputs.length} 张图片（纯中转，未留存）`,
          toolType: "image_storage",
        });
      }
    } else {
      for (const [index, output] of imageOutputs.entries()) {
        storedOutputs.push(
          await storeGeneratedImageOutput({
            output,
            config,
            userId: input.userId,
            generationId: resolveOutputGenerationId(
              generationId,
              index,
              imageOutputs.length
            ),
            bucket,
            requestedSize: size,
            requestedFormat: input.outputFormat,
          })
        );
        if (isAgentChatInput) {
          await emitAgentOperationEvent(callbacks, {
            kind: "tool",
            status:
              index === imageOutputs.length - 1 ? "completed" : "running",
            title:
              index === imageOutputs.length - 1
                ? "图片保存完成"
                : "保存生成图片",
            detail: `已保存 ${index + 1}/${imageOutputs.length} 张图片`,
            toolType: "image_storage",
          });
        }
      }
    }
  } catch (storageError: unknown) {
    const message =
      storageError instanceof Error
        ? storageError.message
        : "Unknown storage error";
    await db
      .update(generation)
      .set({ status: "failed", error: `Storage error: ${message}` })
      .where(isPendingGeneration(generationId));
    try {
      await settleChargedCredits(
        getFailedGenerationTargetCredits({
          reason: "storage_error",
          moderationFailureCredits,
          moderationOnlyCredits: creditCost.moderationOnlyCredits,
        }),
        "content-moderation",
        `${generationId}:storage-error`,
        `Settle storage failure: ${input.prompt.substring(0, 50)}`,
        {
          generationId,
          creditCost,
        }
      );
    } catch {
      /* best effort settlement */
    }
    await db
      .update(generation)
      .set({ creditsConsumed: chargedCredits })
      .where(isPendingGeneration(generationId));
    return {
      error: "Failed to save image",
      generationId,
      creditsConsumed: chargedCredits,
    };
  }

  const selectedWebChoiceId = result.webConversation?.selectedImageMessageId;
  const selectedOutputIndex =
    selectedWebChoiceId && storedOutputs.length > 1
      ? storedOutputs.findIndex(
          (output) => output.webImageMessageId === selectedWebChoiceId
        )
      : -1;
  const primaryOutput =
    storedOutputs[
      selectedOutputIndex >= 0 ? selectedOutputIndex : storedOutputs.length - 1
    ]!;
  const upstreamImageOutputCount = Math.max(
    Math.floor(result.imageOutputCount || 0),
    storedOutputs.length
  );
  const hasChoiceOutputs = storedOutputs.some(
    (output) => output.outputRole === "choice"
  );
  const billableOutputs = hasChoiceOutputs
    ? [primaryOutput]
    : storedOutputs.filter((output) => output.outputRole !== "agent_draft");
  const billableImageOutputCount = billableOutputs.length;
  const perOutputCreditCosts = storedOutputs.map((output) =>
    output.outputRole === "agent_draft" ||
    (hasChoiceOutputs && output.generationId !== primaryOutput.generationId)
      ? {
          baseCredits: 0,
          totalCredits: 0,
          imageModerationCount: 0,
          moderationCny: 0,
          moderationCredits: 0,
          moderationOnlyCredits: 0,
          textModerationCredits: 0,
          textModerationCount: 0,
          pixels: 0,
        }
      : applyBillingMultiplierToCreditCost(
          getImageCreditCostBreakdown(output.size, {
            textModerationCount: moderationEnabled ? undefined : 0,
            imageModerationCount: moderationEnabled ? inputImages.length : 0,
            basePricing: imageBasePricing,
          }),
          billingMultiplier
        )
  );
  const billableOutputCreditCosts = billableOutputs.map((output) =>
    applyBillingMultiplierToCreditCost(
      getImageCreditCostBreakdown(output.size, {
        textModerationCount: moderationEnabled ? undefined : 0,
        imageModerationCount: moderationEnabled ? inputImages.length : 0,
        basePricing: imageBasePricing,
      }),
      billingMultiplier
    )
  );
  const actualCreditCost =
    billableOutputCreditCosts[billableOutputCreditCosts.length - 1] ||
    applyBillingMultiplierToCreditCost(
      getImageCreditCostBreakdown(primaryOutput.size, {
        textModerationCount: moderationEnabled ? undefined : 0,
        imageModerationCount: moderationEnabled ? inputImages.length : 0,
        basePricing: imageBasePricing,
      }),
      billingMultiplier
    );
  const actualImageCredits = perOutputCreditCosts.reduce(
    (total, item) => roundCreditAmount(total + item.totalCredits),
    0
  );
  const chatRoundCount = isChatInput ? getChatRoundCount(result) : 0;
  const targetSuccessCredits = isChatInput
    ? chatRoundCredits * chatRoundCount + actualImageCredits
    : actualImageCredits;
  try {
    if (isAgentChatInput) {
      await emitAgentOperationEvent(callbacks, {
        kind: "tool",
        status: "running",
        title: "结算本次生成",
        detail: `正在按 ${billableImageOutputCount} 张成品图结算积分`,
        toolType: "billing",
      });
    }
    await settleChargedCredits(
      targetSuccessCredits,
      "image-generation",
      `${generationId}:image-actual-size`,
      `Settle image generation: ${input.prompt.substring(0, 50)}`,
      {
        generationId,
        mode: input.mode,
        requestedSize: size,
        actualSize: primaryOutput.size,
        requestedCreditCost: creditCost,
        actualCreditCost,
        perOutputCreditCosts,
        chatRoundCredits: isChatInput ? chatRoundCredits : 0,
        chatRoundCount,
        billableImageOutputCount,
        upstreamImageOutputCount,
      }
    );
    if (isAgentChatInput) {
      await emitAgentOperationEvent(callbacks, {
        kind: "tool",
        status: "completed",
        title: "结算完成",
        detail: `本次实际消耗 ${targetSuccessCredits} 积分`,
        toolType: "billing",
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Insufficient credits";
    try {
      await settleChargedCredits(
        getFailedGenerationTargetCredits({
          reason: "settlement_error",
          moderationFailureCredits,
          moderationOnlyCredits: creditCost.moderationOnlyCredits,
        }),
        "content-moderation",
        `${generationId}:settlement-error`,
        `Settle image generation settlement failure: ${input.prompt.substring(
          0,
          50
        )}`,
        {
          generationId,
          creditCost,
          error: message,
        }
      );
    } catch {
      /* best effort settlement */
    }
    await db
      .update(generation)
      .set({
        status: "failed",
        error: message,
        creditsConsumed: chargedCredits,
      })
      .where(isPendingGeneration(generationId));
    return {
      error: "Insufficient credits",
      generationId,
      creditsConsumed: chargedCredits,
    };
  }

  if (isTimedOut()) {
    return failTimedOutGeneration();
  }

  await db
    .update(generation)
    .set({
      status: "completed",
      storageKey: primaryOutput.storageKey,
      fileSize: primaryOutput.fileSize,
      size: primaryOutput.size,
      revisedPrompt: result.revisedPrompt || primaryOutput.revisedPrompt,
      creditsConsumed: chargedCredits,
      metadata: sql`COALESCE(${generation.metadata}, '{}'::json)::jsonb || ${JSON.stringify(
        {
          ...buildRevisedPromptMetadata({ input, apiPrompt, result }),
          ...buildResponseOutputMetadata(result),
          webConversation: result.webConversation || null,
          outputImage: {
            requestedSize: size,
            actualSize: primaryOutput.size,
            actualSizeDetected: primaryOutput.actualSizeDetected,
            actualSizeMatchesRequested: primaryOutput.size === size,
            requestedFormat: input.outputFormat || null,
            requestedCompression: input.outputCompression ?? null,
            actualFormat: primaryOutput.actualOutputFormat,
            actualFormatDetected: primaryOutput.actualOutputFormatDetected,
            requestedCreditCost: creditCost,
            actualCreditCost,
            perOutputCreditCosts,
            chatRoundCredits: isChatInput ? chatRoundCredits : 0,
            chatRoundCount,
            billableImageOutputCount,
            upstreamImageOutputCount,
            imageOutputs: storedOutputs.map((output, index) => ({
              generationId: output.generationId,
              imageUrl: output.imageUrl,
              imageFileId: output.imageFileId,
              webImageMessageId: output.webImageMessageId,
              webImageGroupId: output.webImageGroupId,
              storageKey: output.storageKey,
              size: output.size,
              revisedPrompt: output.revisedPrompt,
              upstreamRevisedPrompt: output.upstreamRevisedPrompt,
              actualFormat: output.actualOutputFormat,
              actualFormatDetected: output.actualOutputFormatDetected,
              actualSizeDetected: output.actualSizeDetected,
              role:
                output.outputRole ||
                resolveOutputRole({
                  input,
                  index,
                  total: storedOutputs.length,
                }),
              primary: output.generationId === primaryOutput.generationId,
            })),
          },
        }
      )}::jsonb`,
      completedAt: new Date(),
    })
    .where(isPendingGeneration(generationId));

  return {
    generationId,
    imageUrl: primaryOutput.imageUrl,
    imageBase64: primaryOutput.imageBase64,
    imageFileId: primaryOutput.imageFileId,
    imageOutputs: storedOutputs.map((output, index) => ({
      generationId: output.generationId,
      imageUrl: output.imageUrl,
      imageBase64: output.imageBase64,
      imageFileId: output.imageFileId,
      webImageMessageId: output.webImageMessageId,
      webImageGroupId: output.webImageGroupId,
      size: output.size,
      revisedPrompt: output.revisedPrompt,
      upstreamRevisedPrompt: output.upstreamRevisedPrompt,
      index,
      outputRole:
        output.outputRole ||
        resolveOutputRole({ input, index, total: storedOutputs.length }),
    })),
    model: recordModel,
    size: primaryOutput.size,
    revisedPrompt: result.revisedPrompt || primaryOutput.revisedPrompt,
    responseText: result.responseText,
    responseThinking: result.responseThinking,
    responseAgent: result.responseAgent,
    agentEvents: result.agentEvents,
    agentRoundCount: result.agentRoundCount,
    webConversation: result.webConversation,
    backendMember: result.backendMember,
    responsesPreviousResponse: result.responsesPreviousResponse,
    creditsConsumed: chargedCredits,
  };
}
