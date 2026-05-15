import { withApiLogging } from "@repo/shared/api-logger";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import {
  createExternalImageStreamResponse,
  getImageBase64,
  getPublicImageUrl,
  openAIImageError,
  toOpenAIImageData,
  wantsImageStreamResponse,
} from "@/features/external-api/images";
import { runImageGenerationForUser } from "@/features/image-generation/operations";
import {
  DEFAULT_IMAGE_SIZE,
  validateImageSize,
} from "@/features/image-generation/resolution";
import type { PartialImageResult } from "@/features/image-generation/types";

const externalImageGenerationSchema = z.object({
  prompt: z.string().min(1).max(4000),
  apiPrompt: z.string().min(1).max(8000).optional(),
  api_prompt: z.string().min(1).max(8000).optional(),
  promptOptimization: z.boolean().optional(),
  prompt_optimization: z.boolean().optional(),
  model: z.string().optional(),
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

function toPartialPayload(
  image: PartialImageResult,
  index: number
) {
  return {
    type: "image_generation.partial_image",
    index,
    partial_image_index: image.partialImageIndex,
    b64_json: image.imageBase64,
    url: image.imageUrl,
  };
}

export const POST = withApiLogging(async (request: NextRequest) => {
  const auth = await authenticateExternalApiRequest(request);
  if (!auth) {
    return openAIImageError("Invalid or missing API key", 401, "invalid_api_key");
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

  const input = {
    mode: "generate" as const,
    userId: auth.userId,
    prompt: parsed.data.prompt,
    apiPrompt: parsed.data.apiPrompt || parsed.data.api_prompt,
    promptOptimization:
      parsed.data.promptOptimization ?? parsed.data.prompt_optimization,
    size: parsed.data.size || DEFAULT_IMAGE_SIZE,
    model: parsed.data.model,
    quality: parsed.data.quality,
    moderation: parsed.data.moderation || "auto",
  };
  const count = parsed.data.n || 1;
  const responseFormat = parsed.data.response_format || "url";

  if (wantsImageStreamResponse(request, parsed.data.stream)) {
    return createExternalImageStreamResponse(async (emit) => {
      for (let index = 0; index < count; index++) {
        const result = await runImageGenerationForUser(input, {
          onPartialImage: async (image) => {
            await emit({
              event: "image_generation.partial_image",
              data: toPartialPayload(image, index),
            });
          },
        });

        if (result.error) {
          await emit({
            event: "error",
            data: {
              type: "upstream_error",
              message: result.error,
              error: { message: result.error },
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
      }
    });
  }

  const data = [];
  const created = Math.floor(Date.now() / 1000);

  for (let index = 0; index < count; index++) {
    const result = await runImageGenerationForUser(input);
    if (result.error) {
      return openAIImageError(result.error, 400);
    }
    data.push(await toOpenAIImageData(request, result, responseFormat));
  }

  return NextResponse.json({
    created,
    data,
  });
});
