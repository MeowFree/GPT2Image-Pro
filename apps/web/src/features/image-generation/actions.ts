"use server";

import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import {
  collectGenerationImageStorageReferences,
  type GenerationImageStorageReference,
} from "@repo/shared/generation-maintenance";
import { protectedAction } from "@repo/shared/safe-action";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { runImageGenerationForUser } from "./operations";
import {
  DEFAULT_IMAGE_SIZE,
  IMAGE_PROMPT_MAX_CHARACTERS,
  IMAGE_PROMPT_TOO_LONG_MESSAGE,
  validateImageSize,
} from "./resolution";

const generateImageSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(IMAGE_PROMPT_MAX_CHARACTERS, IMAGE_PROMPT_TOO_LONG_MESSAGE),
  size: z
    .string()
    .optional()
    .refine((value) => !value || validateImageSize(value).valid, {
      message: "Invalid image size",
    }),
  model: z.string().optional(),
});

function referenceKey(ref: GenerationImageStorageReference) {
  return `${ref.bucket}:${ref.key}`;
}

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

    const storageReferences = collectGenerationImageStorageReferences({
      storageKey: gen[0].storageKey,
      storageBucket: gen[0].storageBucket,
      metadata: gen[0].metadata,
    });
    const storageReferenceKeys = new Set(storageReferences.map(referenceKey));

    if (storageReferenceKeys.size > 0) {
      const otherGenerations = await db
        .select({
          storageKey: generation.storageKey,
          storageBucket: generation.storageBucket,
          metadata: generation.metadata,
        })
        .from(generation)
        .where(
          and(
            eq(generation.userId, ctx.userId),
            ne(generation.id, parsedInput.generationId)
          )
        );
      for (const other of otherGenerations) {
        for (const ref of collectGenerationImageStorageReferences(other)) {
          storageReferenceKeys.delete(referenceKey(ref));
        }
      }
    }

    if (storageReferenceKeys.size > 0) {
      try {
        const storage = await getStorageProvider();
        for (const ref of storageReferences) {
          if (!storageReferenceKeys.has(referenceKey(ref))) continue;
          await storage.deleteObject(ref.key, ref.bucket);
        }
      } catch {
        /* best effort */
      }
    }

    await db
      .delete(generation)
      .where(eq(generation.id, parsedInput.generationId));
    return { success: true };
  });
