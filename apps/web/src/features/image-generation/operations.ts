import { db } from "@repo/database";
import { generation, user } from "@repo/database/schema";
import { consumeCredits } from "@repo/shared/credits/core";
import {
  IMAGE_GENERATION_PENDING_TIMEOUT_MS,
  IMAGE_GENERATION_TIMEOUT_ERROR,
  refundGenerationCredits,
} from "@repo/shared/generation-maintenance";
import { getFailedGenerationTargetCredits } from "@repo/shared/generation-settlement";
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
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ImageBackendPoolUnavailableError } from "@/features/image-backend-pool/service";
import type { ImageBackendRequestKind } from "@/features/image-backend-pool/types";
import {
  detectImageOutputFormatFromBuffer,
  getOutputFormatContentType,
  getOutputFormatExtension,
  normalizeOutputFormat,
} from "./output-format";
import { withImageGenerationQueue } from "./queue";
import {
  DEFAULT_IMAGE_SIZE,
  getImageCreditCostBreakdown,
  getImageModel,
  isOneKImageSize,
  normalizeImageSize,
  roundCreditAmount,
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
      backendRequestKind?: ImageBackendRequestKind;
      preferredBackendMemberId?: string;
      mixWebFirst?: boolean;
    } & GenerateImageParams)
  | ({
      mode: "edit";
      userId: string;
      generationId?: string;
      apiKeyId?: string;
      backendRequestKind?: ImageBackendRequestKind;
      preferredBackendMemberId?: string;
      mixWebFirst?: boolean;
    } & EditImageParams)
  | ({
      mode: "chat";
      userId: string;
      generationId?: string;
      apiKeyId?: string;
      backendRequestKind?: ImageBackendRequestKind;
      preferredBackendMemberId?: string;
      maxChatContextChars?: number;
      mixWebFirst?: boolean;
    } & ChatImageParams);

const CHAT_TEXT_ONLY_CREDITS = 1;
const TEXT_MODERATION_ONLY_CREDITS =
  getImageCreditCostBreakdown(DEFAULT_IMAGE_SIZE).moderationOnlyCredits;

function getChatRoundCount(result: GenerateImageResult) {
  return Math.max(1, Math.floor(result.agentRoundCount || 1));
}

export type ImageGenerationOperationResult = {
  error?: string;
  generationId?: string;
  imageUrl?: string;
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
    return Buffer.from(result.imageBase64, "base64");
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

type StoredGeneratedImageOutput = {
  generationId: string;
  imageUrl: string;
  storageKey: string;
  fileSize: number;
  size: string;
  revisedPrompt?: string;
  upstreamRevisedPrompt?: string;
  actualSizeDetected: boolean;
  actualOutputFormat: string | null;
  actualOutputFormatDetected: boolean;
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
  ];
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
    revisedPrompt?: string;
    upstreamRevisedPrompt?: string;
  };
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

  return {
    generationId: params.generationId,
    imageUrl: await getStoredImageUrl(params.bucket, storageKey),
    storageKey,
    fileSize: imageBuffer.length,
    size: actualSize,
    revisedPrompt:
      params.output.revisedPrompt || params.output.upstreamRevisedPrompt,
    upstreamRevisedPrompt: params.output.upstreamRevisedPrompt,
    actualSizeDetected,
    actualOutputFormat: storedFormat.format,
    actualOutputFormatDetected: storedFormat.detected,
  } satisfies StoredGeneratedImageOutput;
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
      useCredits: params.useCredits,
      baseUrl: params.config.baseUrl,
      model: params.config.model,
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
  if (!requested || !usesPoolAccountBackend(params.config)) return undefined;
  if (params.config.backend?.accountBackend === "web") {
    if (requested.startsWith("gpt-image-")) {
      throw new Error("Unsupported GPT model. Use a non-image model.");
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
  const mixWebFirst = Boolean(input.mixWebFirst && isOneKImageSize(size));
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
      ? "imageGeneration.agent"
      : input.waterfallMode
        ? "imageGeneration.waterfall"
        : "imageGeneration.chat";
    const chatLabel = input.agentMode
      ? "Agent mode"
      : input.waterfallMode
        ? "Waterfall mode"
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
        accountBackendPreference: mixWebFirst ? "web" : undefined,
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
      });
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "当前没有可用的生图后端",
      generationId,
    };
  }
  const { config, useCredits } = effectiveConfig;
  const moderationEnabled =
    (await isContentModerationEnabled()) &&
    moderationBlockingEnabled &&
    config.contentSafetyEnabled !== false;
  const moderationImageCount = moderationEnabled ? inputImages.length : 0;
  const creditCost = getImageCreditCostBreakdown(size, {
    textModerationCount: moderationEnabled ? undefined : 0,
    imageModerationCount: moderationImageCount,
  });
  const creditsPerImage = creditCost.totalCredits;
  const initialCreditCharge = isChatInput
    ? CHAT_TEXT_ONLY_CREDITS
    : creditsPerImage;
  const moderationFailureCredits = moderationEnabled
    ? planCapabilities.features["moderation.onlyFailureSettlement"]
      ? isChatInput
        ? Math.min(TEXT_MODERATION_ONLY_CREDITS, CHAT_TEXT_ONLY_CREDITS)
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
        gptModel = input.model?.trim() || config.model?.trim() || undefined;
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
          bucket,
          userPlan,
          moderationBlockRiskLevel,
          moderationFailureCredits,
          promptOptimization,
          apiPrompt,
          moderationPrompt,
          config,
          useCredits,
          imageModel,
          gptModel,
          recordModel,
          allowGpt55: planCapabilities.features["models.gpt55"],
          moderationEnabled,
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
  bucket,
  userPlan,
  moderationBlockRiskLevel,
  moderationFailureCredits,
  promptOptimization,
  apiPrompt,
  moderationPrompt,
  config,
  useCredits,
  imageModel,
  gptModel,
  recordModel,
  allowGpt55,
  moderationEnabled,
}: {
  input: RunImageGenerationInput;
  callbacks?: ImageGenerationCallbacks;
  generationId: string;
  size: string;
  inputImages: ImageInputFile[];
  creditCost: ReturnType<typeof getImageCreditCostBreakdown>;
  creditsPerImage: number;
  isChatInput: boolean;
  initialCreditCharge: number;
  bucket: string;
  userPlan: Awaited<ReturnType<typeof getUserPlan>>;
  moderationBlockRiskLevel: ModerationBlockRiskLevel;
  moderationFailureCredits: number;
  promptOptimization: boolean;
  apiPrompt: string;
  moderationPrompt: string;
  config: Awaited<ReturnType<typeof getEffectiveConfig>>["config"];
  useCredits: boolean;
  imageModel: string;
  gptModel?: string;
  recordModel: string;
  allowGpt55: boolean;
  moderationEnabled: boolean;
}): Promise<ImageGenerationOperationResult> {
  const startedAt = Date.now();
  const promptOptimizationMetadata = buildPromptOptimizationMetadata({
    input,
    promptOptimization,
    apiPrompt,
  });
  const backendMetadata = buildBackendExecutionMetadata({ config, useCredits });
  const modelMetadata = buildModelMetadata({
    imageModel,
    gptModel,
    recordModel,
  });
  const mixWebFirst = Boolean(input.mixWebFirst && isOneKImageSize(size));

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
            imageCount: input.images.length,
            hasMask: Boolean(input.mask),
            quality: input.quality || "auto",
            outputFormat: input.outputFormat || null,
            outputCompression: input.outputCompression ?? null,
            batchCount: input.n || 1,
            creditCost,
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
              imageCount: input.images?.length || 0,
              fileContextChars: input.fileContext?.length || 0,
              quality: input.quality || "auto",
              moderation: input.moderation || "auto",
              outputFormat: input.outputFormat || null,
              outputCompression: input.outputCompression ?? null,
              batchCount: input.n || 1,
              creditCost,
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
              batchCount: input.n || 1,
              creditCost,
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
    await refundGenerationCredits({
      generationId,
      userId: input.userId,
      amount: roundCreditAmount(amount),
      sourceRef,
      description,
    });
    chargedCredits = roundCreditAmount(Math.max(0, chargedCredits - amount));
  };
  const chargeAdditionalCredits = async (
    amount: number,
    serviceName: string,
    description: string,
    metadata?: Record<string, unknown>
  ) => {
    if (!useCredits || amount <= 0) return;
    await consumeCredits({
      userId: input.userId,
      amount: roundCreditAmount(amount),
      serviceName,
      description,
      metadata,
    });
    chargedCredits = roundCreditAmount(chargedCredits + amount);
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
      await chargeAdditionalCredits(delta, serviceName, description, {
        ...metadata,
        previousCredits: chargedCredits,
        targetCredits: roundedTarget,
      });
      return;
    }

    if (delta < 0) {
      await refundChargedCredits(Math.abs(delta), sourceRef, description);
    }
  };

  if (useCredits) {
    try {
      await consumeCredits({
        userId: input.userId,
        amount: initialCreditCharge,
        serviceName: isChatInput ? "chat-input" : "image-generation",
        description: isChatInput
          ? `Chat input: ${input.prompt.substring(0, 50)}`
          : `Image generation: ${input.prompt.substring(0, 50)}`,
        metadata: {
          generationId,
          mode: input.mode,
          size,
          creditCost,
          initialCredits: initialCreditCharge,
          targetImageCredits: creditsPerImage,
        },
      });
      chargedCredits = initialCreditCharge;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Insufficient credits";
      await db
        .update(generation)
        .set({ status: "failed", error: message })
        .where(isPendingGeneration(generationId));
      return { error: "Insufficient credits", generationId };
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

      if (updated && creditsToRefund > 0) {
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
              mixWebFirst,
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
                rawResponsesBody: input.rawResponsesBody,
                mixWebFirst,
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
                mixWebFirst,
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
    let finalChargedCredits = chargedCredits;
    if (isChatInput) {
      try {
        await settleChargedCredits(
          CHAT_TEXT_ONLY_CREDITS,
          "chat-text-only",
          `${generationId}:chat-text-only`,
          `Settle chat text response: ${input.prompt.substring(0, 50)}`,
          {
            generationId,
            creditCost,
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
            ...(isChatInput
              ? {
                  chatTextOnlyCharge: {
                    credits: useCredits ? CHAT_TEXT_ONLY_CREDITS : 0,
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
      creditsConsumed: finalChargedCredits,
    };
  }

  let storedOutputs: StoredGeneratedImageOutput[] = [];
  try {
    const imageOutputs = getResultImageOutputs(result);
    if (imageOutputs.length === 0) {
      throw new Error("Missing image data");
    }
    storedOutputs = [];
    for (const [index, output] of imageOutputs.entries()) {
      storedOutputs.push(
        await storeGeneratedImageOutput({
          output,
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

  const primaryOutput = storedOutputs[storedOutputs.length - 1]!;
  const upstreamImageOutputCount = Math.max(
    Math.floor(result.imageOutputCount || 0),
    storedOutputs.length
  );
  const billableImageOutputCount = storedOutputs.length;
  const perOutputCreditCosts = storedOutputs.map((output) =>
    getImageCreditCostBreakdown(output.size, {
      textModerationCount: moderationEnabled ? undefined : 0,
      imageModerationCount: moderationEnabled ? inputImages.length : 0,
    })
  );
  const actualCreditCost =
    perOutputCreditCosts[perOutputCreditCosts.length - 1] ||
    getImageCreditCostBreakdown(primaryOutput.size, {
      textModerationCount: moderationEnabled ? undefined : 0,
      imageModerationCount: moderationEnabled ? inputImages.length : 0,
    });
  const actualImageCredits = perOutputCreditCosts.reduce(
    (total, item) => roundCreditAmount(total + item.totalCredits),
    0
  );
  const chatRoundCount = isChatInput ? getChatRoundCount(result) : 0;
  const targetSuccessCredits = isChatInput
    ? CHAT_TEXT_ONLY_CREDITS * chatRoundCount + actualImageCredits
    : actualImageCredits;
  try {
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
        chatRoundCredits: isChatInput ? CHAT_TEXT_ONLY_CREDITS : 0,
        chatRoundCount,
        billableImageOutputCount,
        upstreamImageOutputCount,
      }
    );
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
            chatRoundCredits: isChatInput ? CHAT_TEXT_ONLY_CREDITS : 0,
            chatRoundCount,
            billableImageOutputCount,
            upstreamImageOutputCount,
            imageOutputs: storedOutputs.map((output, index) => ({
              generationId: output.generationId,
              imageUrl: output.imageUrl,
              storageKey: output.storageKey,
              size: output.size,
              revisedPrompt: output.revisedPrompt,
              upstreamRevisedPrompt: output.upstreamRevisedPrompt,
              actualFormat: output.actualOutputFormat,
              actualFormatDetected: output.actualOutputFormatDetected,
              actualSizeDetected: output.actualSizeDetected,
              primary: index === storedOutputs.length - 1,
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
    imageOutputs: storedOutputs.map((output, index) => ({
      generationId: output.generationId,
      imageUrl: output.imageUrl,
      size: output.size,
      revisedPrompt: output.revisedPrompt,
      upstreamRevisedPrompt: output.upstreamRevisedPrompt,
      index,
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
    creditsConsumed: chargedCredits,
  };
}
