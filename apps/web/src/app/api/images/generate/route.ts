import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { runImageGenerationForUser } from "@/features/image-generation/operations";
import {
  DEFAULT_IMAGE_SIZE,
  validateImageSize,
} from "@/features/image-generation/resolution";
import { getUserApiConfig } from "@/features/image-generation/service";
import { createImageStreamResponse } from "@/features/image-generation/streaming";

const generateImageSchema = z.object({
  prompt: z.string().min(1).max(4000),
  apiPrompt: z.string().min(1).max(8000).optional(),
  promptOptimization: z.boolean().optional(),
  size: z
    .string()
    .optional()
    .refine((value) => !value || validateImageSize(value).valid, {
      message: "Invalid image size",
    }),
  model: z.string().optional(),
  gptModel: z.string().optional(),
  gpt_model: z.string().optional(),
  thinking: z.enum(["none", "low", "medium", "high", "xhigh"]).optional(),
  stream: z.boolean().optional(),
  count: z.number().int().min(1).max(10).optional(),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  moderation: z.enum(["auto", "low"]).optional(),
});

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function wantsStreamResponse(request: NextRequest, stream?: boolean) {
  if (stream) return true;
  return request.headers.get("accept")?.includes("text/event-stream") ?? false;
}

function generationErrorResponse(error: unknown) {
  return errorResponse(
    error instanceof Error ? error.message : "Failed to generate image."
  );
}

export const POST = withApiLogging(async (request: NextRequest) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return errorResponse("Unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const parsed = generateImageSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message || "Invalid request");
  }

  const input = {
    mode: "generate" as const,
    userId: session.user.id,
    backendRequestKind: "image_generation" as const,
    prompt: parsed.data.prompt,
    apiPrompt: parsed.data.apiPrompt,
    promptOptimization: parsed.data.promptOptimization,
    size: parsed.data.size || DEFAULT_IMAGE_SIZE,
    model: parsed.data.model,
    gptModel: parsed.data.gptModel || parsed.data.gpt_model,
    thinking: parsed.data.thinking,
    quality: parsed.data.quality || "auto",
    moderation: parsed.data.moderation || "auto",
  };
  const count = parsed.data.count || 1;

  try {
    const useStreamResponse =
      wantsStreamResponse(request, parsed.data.stream) &&
      Boolean((await getUserApiConfig(session.user.id))?.useStream);

    if (useStreamResponse) {
      return createImageStreamResponse(async (emit) => {
        for (let index = 0; index < count; index++) {
          const result = await runImageGenerationForUser(input, {
            onPartialImage: async (image) => {
              await emit({
                type: "partial_image",
                index,
                partial_image_index: image.partialImageIndex,
                b64_json: image.imageBase64,
                url: image.imageUrl,
              });
            },
          });

          if (result.error) {
            await emit({
              type: "error",
              error: result.error,
              generationId: result.generationId,
              creditsConsumed: result.creditsConsumed,
            });
            return null;
          }

          await emit({ type: "completed", ...result });
        }

        return null;
      });
    }

    if (count === 1) {
      return NextResponse.json(await runImageGenerationForUser(input));
    }

    const results = [];
    for (let index = 0; index < count; index++) {
      const result = await runImageGenerationForUser(input);
      results.push(result);
      if (result.error) break;
    }

    return NextResponse.json({
      results,
      error: results.find((result) => result.error)?.error,
    });
  } catch (error) {
    return generationErrorResponse(error);
  }
});
