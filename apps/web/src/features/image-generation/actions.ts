"use server";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import { consumeCredits, grantCredits } from "@repo/shared/credits/core";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { protectedAction } from "@repo/shared/safe-action";

import { generateImage, getEffectiveConfig, getUserApiConfig } from "./service";

const generateImageSchema = z.object({
  prompt: z.string().min(1).max(4000),
  size: z.string().optional(),
  model: z.string().optional(),
});

export const generateImageAction = protectedAction
  .metadata({ action: "image-generation.generate" })
  .schema(generateImageSchema)
  .action(async ({ parsedInput, ctx }) => {
    const generationId = nanoid();
    const creditsPerImage = Number(process.env.CREDITS_PER_IMAGE) || 1;
    const model =
      parsedInput.model || process.env.PLATFORM_IMAGE_MODEL || "gpt-image-1";
    const size = parsedInput.size || "1024x1024";
    const bucket =
      process.env.NEXT_PUBLIC_GENERATIONS_BUCKET_NAME || "generations";

    const userConfig = await getUserApiConfig(ctx.userId);
    const { config, useCredits } = getEffectiveConfig(userConfig);

    await db.insert(generation).values({
      id: generationId,
      userId: ctx.userId,
      prompt: parsedInput.prompt,
      model,
      size,
      status: "pending",
      creditsConsumed: useCredits ? creditsPerImage : 0,
      storageBucket: bucket,
    });

    if (useCredits) {
      try {
        await consumeCredits({
          userId: ctx.userId,
          amount: creditsPerImage,
          serviceName: "image-generation",
          description: `Image generation: ${parsedInput.prompt.substring(0, 50)}`,
          metadata: { generationId },
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

    const result = await generateImage(config, {
      prompt: parsedInput.prompt,
      size,
      model,
    });

    if (result.error) {
      if (useCredits) {
        try {
          await grantCredits({
            userId: ctx.userId,
            amount: creditsPerImage,
            sourceType: "refund",
            debitAccount: "SYSTEM:generation_refund",
            transactionType: "refund",
            sourceRef: generationId,
            description: `Refund for failed generation: ${parsedInput.prompt.substring(0, 50)}`,
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
      const imageBuffer = Buffer.from(result.imageBase64!, "base64");
      storageKey = `${ctx.userId}/${generationId}.png`;
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
            userId: ctx.userId,
            amount: creditsPerImage,
            sourceType: "refund",
            debitAccount: "SYSTEM:generation_refund",
            transactionType: "refund",
            sourceRef: generationId,
            description: `Refund for storage failure: ${parsedInput.prompt.substring(0, 50)}`,
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

    const imageUrl = process.env.STORAGE_ENDPOINT
      ? `/image-proxy/${bucket}/${storageKey}`
      : `/api/storage/${bucket}/${storageKey}`;

    return {
      generationId,
      imageUrl,
      revisedPrompt: result.revisedPrompt,
      creditsConsumed: useCredits ? creditsPerImage : 0,
    };
  });

export const deleteGenerationAction = protectedAction
  .metadata({ action: "image-generation.delete" })
  .schema(z.object({ generationId: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    const gen = await db
      .select()
      .from(generation)
      .where(eq(generation.id, parsedInput.generationId))
      .limit(1);

    if (!gen[0] || gen[0].userId !== ctx.userId) {
      return { error: "Not found" };
    }

    if (gen[0].storageKey && gen[0].storageBucket) {
      try {
        const storage = await getStorageProvider();
        await storage.deleteObject(gen[0].storageKey, gen[0].storageBucket);
      } catch {
        /* best effort */
      }
    }

    await db
      .delete(generation)
      .where(eq(generation.id, parsedInput.generationId));
    return { success: true };
  });
