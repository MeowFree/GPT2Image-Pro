import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { getPlanLimits } from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { runImageGenerationForUser } from "@/features/image-generation/operations";
import {
  firstBatchError,
  runBatchImageGeneration,
} from "@/features/image-generation/batch-runner";
import {
  DEFAULT_IMAGE_SIZE,
  validateImageSize,
} from "@/features/image-generation/resolution";
import { createImageStreamResponse } from "@/features/image-generation/streaming";
import {
  normalizeOutputCompression,
  normalizeOutputFormat,
} from "@/features/image-generation/output-format";

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
  count: z.number().int().min(1).max(100).optional(),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  moderation: z.enum(["auto", "low"]).optional(),
  output_format: z.enum(["png", "jpeg", "webp"]).optional(),
  outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
  output_compression: z.number().int().min(0).max(100).optional(),
  outputCompression: z.number().int().min(0).max(100).optional(),
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

  const plan = await getUserPlan(session.user.id);
  const planLimits = await getPlanLimits(plan.plan);
  const count = parsed.data.count || 1;
  if (count > planLimits.maxBatchCount) {
    return errorResponse(
      `count must be between 1 and ${planLimits.maxBatchCount}.`
    );
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
    outputFormat: normalizeOutputFormat(
      parsed.data.output_format || parsed.data.outputFormat
    ),
    outputCompression: normalizeOutputCompression(
      parsed.data.output_compression ?? parsed.data.outputCompression
    ),
  };

  try {
    const useStreamResponse = wantsStreamResponse(request, parsed.data.stream);

    if (useStreamResponse) {
      return createImageStreamResponse(async (emit) => {
        await runBatchImageGeneration({
          count,
          run: (generationId, callbacks) =>
            runImageGenerationForUser({ ...input, generationId }, callbacks),
          callbacks: (index) => ({
            onPartialImage: async (image) => {
              await emit({
                type: "partial_image",
                index,
                partial_image_index: image.partialImageIndex,
                b64_json: image.imageBase64,
                url: image.imageUrl,
              });
            },
          }),
          onResult: async (result) => {
            if (result.error) {
              await emit({
                type: "error",
                error: result.error,
                generationId: result.generationId,
                creditsConsumed: result.creditsConsumed,
              });
              return;
            }
            await emit({ type: "completed", ...result });
          },
          stopOnError: true,
        });

        return null;
      });
    }

    if (count === 1) {
      return NextResponse.json(await runImageGenerationForUser(input));
    }

    const results = await runBatchImageGeneration({
      count,
      run: () => runImageGenerationForUser(input),
    });

    return NextResponse.json({
      results,
      error: firstBatchError(results)?.error,
    });
  } catch (error) {
    return generationErrorResponse(error);
  }
});
