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
  getImageCreditCost,
  normalizeImageModel,
} from "./resolution";
import {
  editImage,
  generateImage,
  getEffectiveConfig,
  getUserApiConfig,
} from "./service";
import type { EditImageParams, GenerateImageParams } from "./types";

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
    } & EditImageParams);

export type ImageGenerationOperationResult = {
  error?: string;
  generationId?: string;
  imageUrl?: string;
  model?: string;
  size?: string;
  revisedPrompt?: string;
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

export async function runImageGenerationForUser(
  input: RunImageGenerationInput
): Promise<ImageGenerationOperationResult> {
  const generationId = input.generationId || nanoid();
  const size = input.size || DEFAULT_IMAGE_SIZE;
  const creditsPerImage = getImageCreditCost(size);
  const bucket =
    process.env.NEXT_PUBLIC_GENERATIONS_BUCKET_NAME || "generations";

  const userConfig = await getUserApiConfig(input.userId);
  const { config, useCredits } = getEffectiveConfig(userConfig);
  const model =
    normalizeImageModel(input.model) ||
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
          }
        : { mode: "generate", quality: input.quality || "auto" },
  });

  const moderation = await moderateContent({
    prompt: input.prompt,
    images: input.mode === "edit" ? input.images : undefined,
    mode: input.mode === "edit" ? "image" : "text",
    userId: input.userId,
    generationId,
  });

  if (moderation.decision === "block" || moderation.decision === "error") {
    const message =
      moderation.decision === "block"
        ? "Content failed moderation"
        : "Content moderation is temporarily unavailable";
    await db
      .update(generation)
      .set({
        status: "failed",
        error: moderation.reason || message,
      })
      .where(eq(generation.id, generationId));
    return { error: message, generationId };
  }

  if (useCredits) {
    try {
      await consumeCredits({
        userId: input.userId,
        amount: creditsPerImage,
        serviceName: "image-generation",
        description: `Image generation: ${input.prompt.substring(0, 50)}`,
        metadata: { generationId, mode: input.mode, size },
      });
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

  const result =
    input.mode === "edit"
      ? await editImage(config, {
          prompt: input.prompt,
          images: input.images,
          mask: input.mask,
          size: input.size,
          model,
          quality: input.quality,
          n: input.n,
        })
      : await generateImage(config, {
          prompt: input.prompt,
          size,
          model,
          n: input.n,
          quality: input.quality,
        });

  if (result.error) {
    if (useCredits) {
      try {
        await grantCredits({
          userId: input.userId,
          amount: creditsPerImage,
          sourceType: "refund",
          debitAccount: "SYSTEM:generation_refund",
          transactionType: "refund",
          sourceRef: generationId,
          description: `Refund for failed generation: ${input.prompt.substring(0, 50)}`,
        });
      } catch {
        /* best effort refund */
      }
    }
    await db
      .update(generation)
      .set({ status: "failed", error: result.error })
      .where(eq(generation.id, generationId));
    return { error: result.error, generationId };
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
    if (useCredits) {
      try {
        await grantCredits({
          userId: input.userId,
          amount: creditsPerImage,
          sourceType: "refund",
          debitAccount: "SYSTEM:generation_refund",
          transactionType: "refund",
          sourceRef: generationId,
          description: `Refund for storage failure: ${input.prompt.substring(0, 50)}`,
        });
      } catch {
        /* best effort */
      }
    }
    return { error: "Failed to save image", generationId };
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
    creditsConsumed: useCredits ? creditsPerImage : 0,
  };
}
