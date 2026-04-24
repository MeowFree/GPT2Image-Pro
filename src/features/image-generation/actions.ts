"use server";

import { consumeCredits } from "@/features/credits/core";
import { protectedAction } from "@/lib/safe-action";
import { z } from "zod";
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
    const userConfig = await getUserApiConfig(ctx.userId);
    const { config, useCredits } = getEffectiveConfig(userConfig);

    const creditsPerImage = Number(process.env.CREDITS_PER_IMAGE) || 1;

    if (useCredits) {
      try {
        await consumeCredits({
          userId: ctx.userId,
          amount: creditsPerImage,
          serviceName: "image-generation",
          description: "Image generation via platform API",
        });
      } catch (error) {
        return {
          error:
            error instanceof Error ? error.message : "Insufficient credits",
        };
      }
    }

    const result = await generateImage(config, {
      prompt: parsedInput.prompt,
      size: parsedInput.size,
      model: parsedInput.model,
    });

    if (result.error && useCredits) {
      // TODO: Consider refunding credits on API failure
    }

    return result;
  });
