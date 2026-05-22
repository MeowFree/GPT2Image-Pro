import { withApiLogging } from "@repo/shared/api-logger";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import {
  createExternalImageStreamResponse,
  createJsonKeepAliveResponse,
  getImageBase64,
  getPublicImageUrl,
  openAIImageError,
  toOpenAIImageData,
  toOpenAIErrorPayload,
  wantsImageStreamResponse,
} from "@/features/external-api/images";
import { runBatchImageGeneration } from "@/features/image-generation/batch-runner";
import { runImageGenerationForUser } from "@/features/image-generation/operations";
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
  n: z.number().int().min(1).max(10).optional(),
  size: z
    .string()
    .optional()
    .refine((value) => !value || validateImageSize(value).valid, {
      message: "Invalid image size",
    }),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  moderation: z.enum(["auto", "low"]).optional(),
  response_format: z.enum(["url", "b64_json"]).optional(),
  stream: z.boolean().optional(),
});

async function toStreamCompletedPayload(
  request: Request,
  result: Awaited<ReturnType<typeof runImageGenerationForUser>>,
  responseFormat: "url" | "b64_json",
  index: number
) {
  const image =
    responseFormat === "b64_json"
      ? { b64_json: await getImageBase64(request, result.imageUrl) }
      : { url: getPublicImageUrl(request, result.imageUrl) };

  return {
    type: "image_generation.completed",
    index,
    generation_id: result.generationId,
    generationId: result.generationId,
    model: result.model,
    size: result.size,
    revised_prompt: result.revisedPrompt,
    credits_consumed: result.creditsConsumed,
    ...image,
    data: [
      {
        ...image,
        revised_prompt: result.revisedPrompt,
      },
    ],
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
    };
    const count = parsed.data.n || 1;
    const responseFormat = parsed.data.response_format || "b64_json";

    if (wantsImageStreamResponse(request, parsed.data.stream)) {
      return createExternalImageStreamResponse(async (emit) => {
        await runBatchImageGeneration({
          count,
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
        run: () => runImageGenerationForUser(input),
      });
      for (const result of results) {
        if (result.error) {
          return toOpenAIErrorPayload(result.error, {
            generationId: result.generationId,
            creditsConsumed: result.creditsConsumed,
          });
        }
        data.push(await toOpenAIImageData(request, result, responseFormat));
      }

      return {
        created,
        data,
        usage: null,
      };
    });
  }
);
