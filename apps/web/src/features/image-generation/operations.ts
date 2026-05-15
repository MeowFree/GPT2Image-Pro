import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import { consumeCredits, grantCredits } from "@repo/shared/credits/core";
import { moderateContent } from "@repo/shared/moderation";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  getImageCreditCostBreakdown,
  normalizeImageModel,
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

function getStoredImageUrl(bucket: string, storageKey: string) {
  return process.env.STORAGE_ENDPOINT
    ? `/image-proxy/${bucket}/${storageKey}`
    : `/api/storage/${bucket}/${storageKey}`;
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

export async function runImageGenerationForUser(
  input: RunImageGenerationInput,
  callbacks?: ImageGenerationCallbacks
): Promise<ImageGenerationOperationResult> {
  const generationId = input.generationId || nanoid();
  const apiPrompt = input.apiPrompt || input.prompt;
  const size = input.size || DEFAULT_IMAGE_SIZE;
  const inputImages = getInputImages(input);
  const creditCost = getImageCreditCostBreakdown(size, {
    imageModerationCount: inputImages.length,
  });
  const creditsPerImage = creditCost.totalCredits;
  const refundableGenerationCredits = Math.max(
    0,
    creditsPerImage - creditCost.moderationOnlyCredits
  );
  const bucket =
    process.env.NEXT_PUBLIC_GENERATIONS_BUCKET_NAME || "generations";

  const userConfig = await getUserApiConfig(input.userId);
  const { config, useCredits } = getEffectiveConfig(userConfig);
  const model =
    input.mode === "chat"
      ? getResponsesModel(config, input.model)
      : normalizeImageModel(input.model) ||
        normalizeImageModel(config.model) ||
        DEFAULT_IMAGE_MODEL;

  await db.insert(generation).values({
    id: generationId,
    userId: input.userId,
    prompt: input.prompt,
    model,
    size,
    status: "pending",
    creditsConsumed: useCredits ? creditsPerImage : 0,
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
            }
          : {
              mode: "generate",
              quality: input.quality || "auto",
              moderation: input.moderation || "auto",
              batchCount: input.n || 1,
              creditCost,
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
      amount,
      sourceType: "refund",
      debitAccount: "SYSTEM:generation_refund",
      transactionType: "refund",
      sourceRef,
      description,
    });
    chargedCredits = Math.max(0, chargedCredits - amount);
  };

  if (useCredits) {
    try {
      await consumeCredits({
        userId: input.userId,
        amount: creditsPerImage,
        serviceName: "image-generation",
        description: `Image generation: ${input.prompt.substring(0, 50)}`,
        metadata: {
          generationId,
          mode: input.mode,
          size,
          creditCost,
        },
      });
      chargedCredits = creditsPerImage;
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
    prompt: apiPrompt,
    images: inputImages,
    mode: inputImages.length > 0 ? "image" : "text",
    userId: input.userId,
    generationId,
  });

  if (moderation.decision === "block" || moderation.decision === "error") {
    const refundAmount =
      moderation.decision === "block"
        ? refundableGenerationCredits
        : creditsPerImage;
    if (refundAmount > 0) {
      try {
        await refundChargedCredits(
          refundAmount,
          `${generationId}:moderation`,
          `Refund after moderation stop: ${input.prompt.substring(0, 50)}`
        );
      } catch {
        /* best effort refund */
      }
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
              images: input.images,
              history: input.history,
              size,
              model,
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
              size,
              model,
              n: input.n,
              quality: input.quality,
              moderation: input.moderation,
            },
            callbacks
          );

  if (result.error) {
    if (refundableGenerationCredits > 0) {
      try {
        await refundChargedCredits(
          refundableGenerationCredits,
          generationId,
          `Refund for failed generation: ${input.prompt.substring(0, 50)}`
        );
      } catch {
        /* best effort refund */
      }
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
    await db
      .update(generation)
      .set({
        status: "completed",
        revisedPrompt: result.revisedPrompt,
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
      creditsConsumed: chargedCredits,
    };
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
    if (refundableGenerationCredits > 0) {
      try {
        await refundChargedCredits(
          refundableGenerationCredits,
          generationId,
          `Refund for storage failure: ${input.prompt.substring(0, 50)}`
        );
      } catch {
        /* best effort */
      }
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
      completedAt: new Date(),
    })
    .where(eq(generation.id, generationId));

  return {
    generationId,
    imageUrl: getStoredImageUrl(bucket, storageKey),
    model,
    size,
    revisedPrompt: result.revisedPrompt,
    responseText: result.responseText,
    responseThinking: result.responseThinking,
    creditsConsumed: chargedCredits,
  };
}
