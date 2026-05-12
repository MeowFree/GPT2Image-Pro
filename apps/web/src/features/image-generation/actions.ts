"use server";

import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import { protectedAction } from "@repo/shared/safe-action";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  DEFAULT_IMAGE_SIZE,
  validateImageSize,
} from "./resolution";
import { runImageGenerationForUser } from "./operations";

const generateImageSchema = z.object({
  prompt: z.string().min(1).max(4000),
  size: z
    .string()
    .optional()
    .refine((value) => !value || validateImageSize(value).valid, {
      message: "Invalid image size",
    }),
  model: z.string().optional(),
});

export const generateImageAction = protectedAction
  .metadata({ action: "image-generation.generate" })
  .schema(generateImageSchema)
  .action(async ({ parsedInput, ctx }) => {
    return await runImageGenerationForUser({
      mode: "generate",
      userId: ctx.userId,
      prompt: parsedInput.prompt,
      size: parsedInput.size || DEFAULT_IMAGE_SIZE,
      model: parsedInput.model,
    });
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
