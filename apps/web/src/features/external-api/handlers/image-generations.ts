import { withApiLogging } from "@repo/shared/api-logger";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import {
  canUsePlanCapability,
  getPlanLimits,
} from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import {
  createExternalImageStreamResponse,
  createJsonKeepAliveResponse,
  getImageBase64,
  getPublicImageUrl,
  openAIImageError,
  toExternalGenerationUsage,
  toOpenAIImageData,
  toOpenAIErrorPayload,
  wantsImageStreamResponse,
} from "@/features/external-api/images";
import { runBatchImageGeneration } from "@/features/image-generation/batch-runner";
import { runImageGenerationForUser } from "@/features/image-generation/operations";
import {
  normalizeOutputCompression,
  normalizeOutputFormat,
} from "@/features/image-generation/output-format";
import {
  DEFAULT_IMAGE_SIZE,
  getImageModel,
  validateImageSize,
} from "@/features/image-generation/resolution";
import type { PartialImageResult } from "@/features/image-generation/types";

const externalImageGenerationSchema = z.object({
  prompt: z.string().min(1).max(4000),
  promptOptimization: z.boolean().optional(),
  prompt_optimization: z.boolean().optional(),
  model: z.string().optional(),
  gptModel: z.string().optional(),
  gpt_model: z.string().optional(),
  thinking: z
    .enum(["minimal", "none", "low", "medium", "high", "xhigh"])
    .optional(),
  n: z.number().int().min(1).max(100).optional(),
  size: z
    .string()
    .optional()
    .refine((value) => !value || validateImageSize(value).valid, {
      message: "Invalid image size",
    }),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  moderation: z.enum(["auto", "low"]).optional(),
  response_format: z.enum(["url", "b64_json"]).optional(),
  output_format: z.enum(["png", "jpeg", "webp"]).optional(),
  output_compression: z.number().int().min(0).max(100).optional(),
  force_web: z.boolean().optional(),
  forceWeb: z.boolean().optional(),
  stream: z.boolean().optional(),
});

async function toStreamCompletedPayload(
  request: Request,
  result: Awaited<ReturnType<typeof runImageGenerationForUser>>,
  responseFormat: "url" | "b64_json",
  index: number
) {
  const outputs = result.imageOutputs?.length
    ? result.imageOutputs
    : [{ imageUrl: result.imageUrl, revisedPrompt: result.revisedPrompt }];
  const images = [];
  for (const output of outputs) {
    const image =
      responseFormat === "b64_json"
        ? { b64_json: await getImageBase64(request, output.imageUrl) }
        : { url: getPublicImageUrl(request, output.imageUrl) };
    images.push({
      ...image,
      revised_prompt: output.revisedPrompt || result.revisedPrompt,
    });
  }
  const primary = images[images.length - 1] || {};

  return {
    type: "image_generation.completed",
    index,
    generation_id: result.generationId,
    generationId: result.generationId,
    model: result.model,
    size: result.size,
    revised_prompt: result.revisedPrompt,
    credits_consumed: result.creditsConsumed,
    ...primary,
    data: images,
  };
}

function toPartialPayload(image: PartialImageResult, index: number) {
  return {
    type: "image_generation.partial_image",
    index,
    partial_image_index: image.partialImageIndex,
    b64_json: image.imageBase64,
    url: image.imageUrl,
  };
}

function resolveImageModel(model: string | undefined) {
  return getImageModel(model);
}

export const postExternalImageGenerations = withApiLogging(
  async (request: NextRequest) => {
    const auth = await authenticateExternalApiRequest(request);
    if (!auth) {
      return openAIImageError(
        "Invalid or missing API key",
        401,
        "invalid_api_key"
      );
    }
    if (
      !(await canUsePlanCapability(auth.plan, "externalApi.images.generate"))
    ) {
      return openAIImageError(
        "External image generation is not enabled for this plan.",
        403,
        "insufficient_plan"
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return openAIImageError("Invalid JSON body");
    }

    const parsed = externalImageGenerationSchema.safeParse(body);
    if (!parsed.success) {
      return openAIImageError(
        parsed.error.issues[0]?.message || "Invalid request"
      );
    }

    const imageModel = resolveImageModel(parsed.data.model);
    if (!imageModel) {
      return openAIImageError(
        "Unsupported model for /v1/images/generations. Use a gpt-image-* model, or call /v1/responses for Responses image models."
      );
    }

    const plan = await getUserPlan(auth.userId);
    const limits = await getPlanLimits(plan.plan);
    const count = parsed.data.n || 1;
    if (
      count > 1 &&
      !(await canUsePlanCapability(plan.plan, "imageGeneration.batch"))
    ) {
      return openAIImageError(
        "Batch image generation is not enabled for this plan.",
        403,
        "insufficient_plan"
      );
    }
    if (count > limits.maxBatchCount) {
      return openAIImageError(
        `n must be between 1 and ${limits.maxBatchCount}.`
      );
    }
    if (
      wantsImageStreamResponse(request, parsed.data.stream) &&
      !(await canUsePlanCapability(plan.plan, "externalApi.streaming"))
    ) {
      return openAIImageError(
        "External API streaming is not enabled for this plan.",
        403,
        "insufficient_plan"
      );
    }

    const input = {
      mode: "generate" as const,
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      backendRequestKind: "image_generation" as const,
      prompt: parsed.data.prompt,
      promptOptimization:
        parsed.data.promptOptimization ?? parsed.data.prompt_optimization,
      moderationBlockRiskLevel: auth.moderationBlockRiskLevel,
      size: parsed.data.size || DEFAULT_IMAGE_SIZE,
      model: imageModel,
      gptModel: parsed.data.gptModel || parsed.data.gpt_model,
      thinking: parsed.data.thinking,
      quality: parsed.data.quality,
      moderation: parsed.data.moderation || "auto",
      outputFormat: normalizeOutputFormat(parsed.data.output_format),
      outputCompression: normalizeOutputCompression(
        parsed.data.output_compression
      ),
      forceWebBackend: parsed.data.force_web ?? parsed.data.forceWeb,
    };
    const responseFormat = parsed.data.response_format || "b64_json";

    if (wantsImageStreamResponse(request, parsed.data.stream)) {
      return createExternalImageStreamResponse(async (emit) => {
        await runBatchImageGeneration({
          count,
          concurrency: limits.imageGenerationConcurrency,
          run: (generationId, callbacks) =>
            runImageGenerationForUser(
              { ...input, generationId },
              callbacks
            ),
          callbacks: (index) => ({
            onPartialImage: async (image) => {
              await emit({
                event: "image_generation.partial_image",
                data: toPartialPayload(image, index),
              });
            },
          }),
          onResult: async (result, index) => {
            if (result.error) {
              await emit({
                event: "error",
                data: {
                  type: "upstream_error",
                  message: result.error,
                  error: toOpenAIErrorPayload(result.error, {
                    generationId: result.generationId,
                    creditsConsumed: result.creditsConsumed,
                  }).error,
                  generation_id: result.generationId,
                  generationId: result.generationId,
                  credits_consumed: result.creditsConsumed,
                },
              });
              return;
            }

            await emit({
              event: "image_generation.completed",
              data: await toStreamCompletedPayload(
                request,
                result,
                responseFormat,
                index
              ),
            });
          },
        });
      });
    }

    return createJsonKeepAliveResponse(async () => {
      const data = [];
      const created = Math.floor(Date.now() / 1000);

      const results = await runBatchImageGeneration({
        count,
        concurrency: limits.imageGenerationConcurrency,
        run: () => runImageGenerationForUser(input),
      });
      for (const result of results) {
        if (result.error) {
          return toOpenAIErrorPayload(result.error, {
            generationId: result.generationId,
            creditsConsumed: result.creditsConsumed,
          });
        }
        if (result.imageOutputs?.length) {
          for (const output of result.imageOutputs) {
            data.push(
              await toOpenAIImageData(
                request,
                {
                  ...result,
                  imageUrl: output.imageUrl,
                  revisedPrompt: output.revisedPrompt || result.revisedPrompt,
                },
                responseFormat
              )
            );
          }
        } else {
          data.push(await toOpenAIImageData(request, result, responseFormat));
        }
      }

      return {
        created,
        data,
        ...toExternalGenerationUsage(results),
        usage: null,
      };
    });
  }
);
