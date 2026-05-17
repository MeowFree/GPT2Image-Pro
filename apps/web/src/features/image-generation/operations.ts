import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import { consumeCredits, grantCredits } from "@repo/shared/credits/core";
import { moderateContent } from "@repo/shared/moderation";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import {
  canUseChat,
  canUseGpt55Chat,
  canUseModerationOnlyFailureSettlement,
  canUsePromptOptimization,
} from "@repo/shared/config/subscription-plan";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  getImageCreditCostBreakdown,
  normalizeImageModel,
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
  ChatImageParams,
  EditImageParams,
  GenerateImageParams,
  ImageGenerationCallbacks,
  ImageInputFile,
  ChatHistoryMessage,
} from "./types";

type RunImageGenerationInput =
  | ({
      mode: "generate";
      userId: string;
      generationId?: string;
    } & GenerateImageParams)
  | ({
      mode: "edit";
      userId: string;
      generationId?: string;
    } & EditImageParams)
  | ({
      mode: "chat";
      userId: string;
      generationId?: string;
    } & ChatImageParams);

const CHAT_TEXT_ONLY_CREDITS = 1;
const MAX_CHAT_CONTEXT_CHARS = 30_000;
const TEXT_MODERATION_ONLY_CREDITS = getImageCreditCostBreakdown(
  DEFAULT_IMAGE_SIZE
).moderationOnlyCredits;

export type ImageGenerationOperationResult = {
  error?: string;
  generationId?: string;
  imageUrl?: string;
  model?: string;
  size?: string;
  revisedPrompt?: string;
  responseText?: string;
  responseThinking?: string;
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
  promptOptimization?: boolean;
  history?: ChatHistoryMessage[];
}) {
  const currentPrompt =
    params.promptOptimization === false
      ? params.prompt
      : params.apiPrompt || params.prompt;

  return (
    currentPrompt.length +
    (params.history || []).reduce(
      (total, message) => total + getChatHistoryText(message).length,
      0
    )
  );
}

export async function runImageGenerationForUser(
  input: RunImageGenerationInput,
  callbacks?: ImageGenerationCallbacks
): Promise<ImageGenerationOperationResult> {
  const generationId = input.generationId || nanoid();
  const size = input.size || DEFAULT_IMAGE_SIZE;
  const inputImages = getInputImages(input);
  const creditCost = getImageCreditCostBreakdown(size, {
    imageModerationCount: inputImages.length,
  });
  const creditsPerImage = creditCost.totalCredits;
  const isTextOnlyChatInput = input.mode === "chat" && inputImages.length === 0;
  const initialCreditCharge = isTextOnlyChatInput
    ? CHAT_TEXT_ONLY_CREDITS
    : creditsPerImage;
  const bucket =
    (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
    "generations";
  const userPlan = await getUserPlan(input.userId);
  const moderationFailureCredits = canUseModerationOnlyFailureSettlement(
    userPlan.plan
  )
    ? isTextOnlyChatInput
      ? Math.min(TEXT_MODERATION_ONLY_CREDITS, CHAT_TEXT_ONLY_CREDITS)
      : creditCost.moderationOnlyCredits
    : initialCreditCharge;
  const promptOptimizationAllowed = canUsePromptOptimization(userPlan.plan);
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
  const moderationPrompt = input.mode === "chat" ? input.prompt : apiPrompt;

  if (input.mode === "chat" && !canUseChat(userPlan.plan)) {
    return {
      error: "Chat mode requires Pro plan or higher.",
      generationId,
    };
  }
  if (
    input.mode === "chat" &&
    getChatContextLength({
      prompt: input.prompt,
      apiPrompt,
      promptOptimization,
      history: input.history,
    }) > MAX_CHAT_CONTEXT_CHARS
  ) {
    return {
      error: `Chat input context must be no more than ${MAX_CHAT_CONTEXT_CHARS} characters.`,
      generationId,
    };
  }

  const userConfig = await getUserApiConfig(input.userId);
  const { config, useCredits } = await getEffectiveConfig(userConfig);
  let model: string;
  try {
    model =
      input.mode === "chat"
        ? await getResponsesModel(config, input.model, {
            allowGpt55: canUseGpt55Chat(userPlan.plan),
          })
        : normalizeImageModel(input.model) ||
          normalizeImageModel(config.model) ||
          DEFAULT_IMAGE_MODEL;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid model.",
      generationId,
    };
  }

  await db.insert(generation).values({
    id: generationId,
    userId: input.userId,
    prompt: input.prompt,
    model,
    size,
    status: "pending",
    creditsConsumed: useCredits ? initialCreditCharge : 0,
    storageBucket: bucket,
    metadata:
      input.mode === "edit"
        ? {
            mode: "edit",
            imageCount: input.images.length,
            hasMask: Boolean(input.mask),
            quality: input.quality || "auto",
            batchCount: input.n || 1,
            creditCost,
            moderationFailureCredits,
          }
        : input.mode === "chat"
          ? {
              mode: "chat",
              action: "auto",
              imageCount: input.images?.length || 0,
              quality: input.quality || "auto",
              moderation: input.moderation || "auto",
              batchCount: input.n || 1,
              creditCost,
              moderationFailureCredits,
            }
          : {
              mode: "generate",
              quality: input.quality || "auto",
              moderation: input.moderation || "auto",
              batchCount: input.n || 1,
              creditCost,
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
    await grantCredits({
      userId: input.userId,
      amount: roundCreditAmount(amount),
      sourceType: "refund",
      debitAccount: "SYSTEM:generation_refund",
      transactionType: "refund",
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
        serviceName: isTextOnlyChatInput ? "chat-input" : "image-generation",
        description: isTextOnlyChatInput
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
        .where(eq(generation.id, generationId));
      return { error: "Insufficient credits", generationId };
    }
  }

  const moderation = await moderateContent({
    prompt: moderationPrompt,
    images: inputImages,
    mode: inputImages.length > 0 ? "image" : "text",
    userId: input.userId,
    generationId,
  });

  if (moderation.decision === "block" || moderation.decision === "error") {
    const targetCredits =
      moderation.decision === "block"
        ? moderationFailureCredits
        : 0;
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
    await db
      .update(generation)
      .set({
        status: "failed",
        error: moderation.reason || message,
        creditsConsumed: chargedCredits,
      })
      .where(eq(generation.id, generationId));
    return { error: message, generationId, creditsConsumed: chargedCredits };
  }

  const result =
    input.mode === "edit"
      ? await editImage(
          config,
          {
            prompt: input.prompt,
            apiPrompt,
            promptOptimization,
            images: input.images,
            mask: input.mask,
            size: input.size,
            model,
            quality: input.quality,
            n: input.n,
            moderation: input.moderation,
          },
          callbacks
        )
      : input.mode === "chat"
        ? await generateChatImage(
            config,
            {
              prompt: input.prompt,
              apiPrompt,
              promptOptimization,
              images: input.images,
              history: input.history,
              size,
              model,
              allowGpt55: canUseGpt55Chat(userPlan.plan),
              quality: input.quality,
              n: input.n,
              moderation: input.moderation,
              stream: input.stream,
              thinking: input.thinking,
            },
            callbacks
          )
        : await generateImage(
            config,
            {
              prompt: input.prompt,
              apiPrompt,
              promptOptimization,
              size,
              model,
              n: input.n,
              quality: input.quality,
              moderation: input.moderation,
            },
            callbacks
          );

  if (result.error) {
    try {
      await settleChargedCredits(
        moderationFailureCredits,
        "content-moderation",
        `${generationId}:generation-error`,
        `Settle failed generation: ${input.prompt.substring(0, 50)}`,
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
      .set({
        status: "failed",
        error: result.error,
        creditsConsumed: chargedCredits,
      })
      .where(eq(generation.id, generationId));
    return { error: result.error, generationId, creditsConsumed: chargedCredits };
  }

  if (!result.imageBase64 && !result.imageUrl) {
    let finalChargedCredits = chargedCredits;
    if (isTextOnlyChatInput) {
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
          .set({ status: "failed", error: message, creditsConsumed: chargedCredits })
          .where(eq(generation.id, generationId));
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
          isTextOnlyChatInput
            ? {
                chatTextOnlyCharge: {
                  credits: useCredits ? CHAT_TEXT_ONLY_CREDITS : 0,
                },
              }
            : {}
        )}::jsonb`,
        completedAt: new Date(),
      })
      .where(eq(generation.id, generationId));

    return {
      generationId,
      model,
      size,
      revisedPrompt: result.revisedPrompt,
      responseText: result.responseText,
      responseThinking: result.responseThinking,
      creditsConsumed: finalChargedCredits,
    };
  }

  if (isTextOnlyChatInput) {
    try {
      await settleChargedCredits(
        creditsPerImage,
        "image-generation",
        `${generationId}:chat-image-upgrade`,
        `Settle chat image generation: ${input.prompt.substring(0, 50)}`,
        {
          generationId,
          mode: input.mode,
          size,
          creditCost,
        }
      );
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
        .where(eq(generation.id, generationId));
      return {
        error: "Insufficient credits",
        generationId,
        creditsConsumed: chargedCredits,
      };
    }
  }

  let storageKey = "";
  let fileSize = 0;
  try {
    const imageBuffer = await toImageBuffer(result);
    storageKey = `${input.userId}/${generationId}.png`;
    fileSize = imageBuffer.length;
    const storage = await getStorageProvider();
    await storage.putObject(storageKey, bucket, imageBuffer, "image/png");
  } catch (storageError: unknown) {
    const message =
      storageError instanceof Error
        ? storageError.message
        : "Unknown storage error";
    await db
      .update(generation)
      .set({ status: "failed", error: `Storage error: ${message}` })
      .where(eq(generation.id, generationId));
    try {
      await settleChargedCredits(
        moderationFailureCredits,
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
      .where(eq(generation.id, generationId));
    return {
      error: "Failed to save image",
      generationId,
      creditsConsumed: chargedCredits,
    };
  }

  await db
    .update(generation)
    .set({
      status: "completed",
      storageKey,
      fileSize,
      revisedPrompt: result.revisedPrompt,
      creditsConsumed: chargedCredits,
      completedAt: new Date(),
    })
    .where(eq(generation.id, generationId));

  return {
    generationId,
    imageUrl: await getStoredImageUrl(bucket, storageKey),
    model,
    size,
    revisedPrompt: result.revisedPrompt,
    responseText: result.responseText,
    responseThinking: result.responseThinking,
    creditsConsumed: chargedCredits,
  };
}
