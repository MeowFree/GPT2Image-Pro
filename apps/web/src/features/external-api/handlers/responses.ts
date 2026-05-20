import { withApiLogging } from "@repo/shared/api-logger";
import { canUseExternalResponsesImageApi } from "@repo/shared/config/subscription-plan";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import {
  createExternalImageStreamResponse,
  createJsonKeepAliveResponse,
  getImageBase64,
  openAIImageError,
  toOpenAIErrorPayload,
  toOpenAIResponseImageItem,
  toOpenAIResponseTextItem,
  wantsImageStreamResponse,
} from "@/features/external-api/images";
import { isExternalResponsesImageModelAllowed } from "@/features/external-api/models";
import { runImageGenerationForUser } from "@/features/image-generation/operations";
import {
  DEFAULT_IMAGE_SIZE,
  getImageModel,
  validateImageSize,
} from "@/features/image-generation/resolution";
import type {
  ChatHistoryMessage,
  ImageInputFile,
  ImageModeration,
  ImageQuality,
  ThinkingLevel,
} from "@/features/image-generation/types";

const responseInputContentSchema = z.union([
  z.object({
    type: z.enum(["input_text", "output_text"]),
    text: z.string(),
  }),
  z.object({
    type: z.literal("input_image"),
    image_url: z.string(),
  }),
]);

const responseInputMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system", "developer"]).optional(),
  content: z.union([z.string(), z.array(responseInputContentSchema)]),
});

const responseSchema = z.object({
  model: z.string().optional(),
  input: z.union([z.string(), z.array(responseInputMessageSchema)]),
  tools: z.array(z.object({ type: z.string() }).passthrough()).optional(),
  stream: z.boolean().optional(),
  size: z
    .string()
    .optional()
    .refine((value) => !value || validateImageSize(value).valid, {
      message: "Invalid image size",
    }),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  moderation: z.enum(["auto", "low"]).optional(),
  reasoning: z
    .object({
      effort: z.enum(["none", "low", "medium", "high", "xhigh"]).optional(),
    })
    .passthrough()
    .optional(),
});

type ResponseRequest = z.infer<typeof responseSchema>;

function responseId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function getContentText(
  content: string | z.infer<typeof responseInputContentSchema>[]
) {
  if (typeof content === "string") return content;
  return content
    .filter((item) => item.type === "input_text" || item.type === "output_text")
    .map((item) => ("text" in item ? item.text : ""))
    .join("\n")
    .trim();
}

function getContentImages(
  content: string | z.infer<typeof responseInputContentSchema>[]
) {
  if (typeof content === "string") return [];
  return content
    .filter((item) => item.type === "input_image")
    .map((item) => ("image_url" in item ? item.image_url : ""))
    .filter(Boolean);
}

function inputToChatParams(input: ResponseRequest["input"]) {
  if (typeof input === "string") {
    return {
      prompt: input,
      history: [] as ChatHistoryMessage[],
      promptImageUrls: [] as string[],
    };
  }

  const history: ChatHistoryMessage[] = [];
  let prompt = "";
  let promptImages: string[] = [];

  for (const item of input) {
    const role = item.role || "user";
    const text = getContentText(item.content);
    const imageUrls = getContentImages(item.content);

    if (role === "assistant") {
      history.push({ role: "assistant", text });
      continue;
    }

    if (role === "user") {
      if (prompt) {
        history.push({ role: "user", text: prompt, imageUrls: promptImages });
      }
      prompt = text;
      promptImages = imageUrls;
    }
  }

  return {
    prompt: prompt.trim(),
    history,
    promptImageUrls: promptImages,
  };
}

function parseDataImageUrl(url: string): ImageInputFile | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(url);
  if (!match) return null;
  return {
    data: Buffer.from(match[2] || "", "base64"),
    name: "response-input-image.png",
    type: match[1] || "image/png",
    url,
  };
}

async function imageUrlToInputFile(
  imageUrl: string,
  index: number
): Promise<ImageInputFile | null> {
  if (imageUrl.startsWith("data:image/")) {
    return parseDataImageUrl(imageUrl);
  }
  if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) {
    return null;
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to load input image: ${response.status}`);
  }
  const type = response.headers.get("content-type") || "image/png";
  if (!type.startsWith("image/")) return null;
  return {
    data: Buffer.from(await response.arrayBuffer()),
    name: `response-input-image-${index + 1}`,
    type,
    url: imageUrl,
  };
}

async function inputImageUrlsToFiles(imageUrls: string[]) {
  const files = await Promise.all(
    imageUrls.map((imageUrl, index) => imageUrlToInputFile(imageUrl, index))
  );
  return files.filter((file): file is ImageInputFile => Boolean(file));
}

function hasImageGenerationTool(tools: ResponseRequest["tools"]) {
  return tools?.some((tool) => tool.type === "image_generation") ?? false;
}

function normalizeThinking(value: ThinkingLevel | undefined) {
  return value === "none" ? undefined : value;
}

function getRequestedToolImageModel(tools: ResponseRequest["tools"]) {
  const imageTool = tools?.find((tool) => tool.type === "image_generation");
  if (!imageTool || typeof imageTool.model !== "string") return undefined;
  return getImageModel(imageTool.model) || undefined;
}

function toResponsePayload(params: {
  requestId: string;
  model?: string;
  result: Awaited<ReturnType<typeof runImageGenerationForUser>>;
  imageBase64?: string;
}) {
  const output = [];
  if (params.imageBase64) {
    output.push(
      toOpenAIResponseImageItem({
        id: responseId("ig"),
        b64Json: params.imageBase64,
        revisedPrompt: params.result.revisedPrompt,
      })
    );
  }
  if (params.result.responseText) {
    output.push(
      toOpenAIResponseTextItem({
        id: responseId("msg"),
        text: params.result.responseText,
      })
    );
  }

  return {
    id: params.requestId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: params.result.model || params.model,
    output,
    usage: null,
    metadata: {
      generation_id: params.result.generationId,
      credits_consumed: params.result.creditsConsumed,
      size: params.result.size,
    },
  };
}

function toResponseErrorPayload(message: string, requestId?: string) {
  const payload = toOpenAIErrorPayload(message);
  return {
    error: payload.error,
    ...(requestId
      ? {
          response: {
            id: requestId,
            status: "failed",
            error: payload.error,
          },
        }
      : {}),
  };
}

export const postExternalResponses = withApiLogging(
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

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      return openAIImageError(
        parsed.error.issues[0]?.message || "Invalid request"
      );
    }

    if (parsed.data.tools && !hasImageGenerationTool(parsed.data.tools)) {
      return openAIImageError(
        "The external Responses API currently requires the image_generation tool."
      );
    }

    const plan = await getUserPlan(auth.userId);
    if (!canUseExternalResponsesImageApi(plan.plan)) {
      return openAIImageError(
        "External Responses image generation requires Pro plan or higher.",
        403,
        "insufficient_plan"
      );
    }

    if (!isExternalResponsesImageModelAllowed(parsed.data.model, plan.plan)) {
      return openAIImageError(
        "Unsupported model for this plan. Use /v1/models to list available Responses image models."
      );
    }

    const { prompt, history, promptImageUrls } = inputToChatParams(
      parsed.data.input
    );
    if (!prompt) {
      return openAIImageError("Responses input must include user text.");
    }

    let images: ImageInputFile[] = [];
    try {
      images = await inputImageUrlsToFiles(promptImageUrls);
    } catch (error) {
      return openAIImageError(
        error instanceof Error ? error.message : "Failed to load input image"
      );
    }

    const input = {
      mode: "chat" as const,
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      backendRequestKind: "responses" as const,
      prompt,
      history,
      images,
      moderationBlockRiskLevel: auth.moderationBlockRiskLevel,
      size: parsed.data.size || DEFAULT_IMAGE_SIZE,
      model: parsed.data.model,
      imageModel: getRequestedToolImageModel(parsed.data.tools),
      quality: parsed.data.quality as ImageQuality | undefined,
      moderation: (parsed.data.moderation || "auto") as ImageModeration,
      thinking: normalizeThinking(parsed.data.reasoning?.effort),
      stream: wantsImageStreamResponse(request, parsed.data.stream),
      rawResponsesBody: parsed.data,
    };

    const requestId = responseId("resp");

    if (wantsImageStreamResponse(request, parsed.data.stream)) {
      return createExternalImageStreamResponse(async (emit) => {
        const result = await runImageGenerationForUser(input, {
          onTextDelta: async (delta) => {
            await emit({
              event: "response.output_text.delta",
              data: { type: "response.output_text.delta", delta },
            });
          },
          onThinkingDelta: async (delta) => {
            await emit({
              event: "response.reasoning_summary_text.delta",
              data: { type: "response.reasoning_summary_text.delta", delta },
            });
          },
        });

        if (result.error) {
          const payload = toOpenAIErrorPayload(result.error, {
            generationId: result.generationId,
            creditsConsumed: result.creditsConsumed,
          });
          await emit({
            event: "response.failed",
            data: {
              type: "response.failed",
              response: {
                id: requestId,
                status: "failed",
                error: payload.error,
              },
              error: payload.error,
              generation_id: result.generationId,
              generationId: result.generationId,
              credits_consumed: result.creditsConsumed,
            },
          });
          return;
        }

        const imageBase64 = result.imageUrl
          ? await getImageBase64(request, result.imageUrl)
          : undefined;
        const response = toResponsePayload({
          requestId,
          model: parsed.data.model,
          result,
          imageBase64,
        });

        for (const item of response.output) {
          await emit({
            event: "response.output_item.done",
            data: { type: "response.output_item.done", item },
          });
        }

        await emit({
          event: "response.completed",
          data: { type: "response.completed", response },
        });
      });
    }

    return createJsonKeepAliveResponse(async () => {
      const result = await runImageGenerationForUser(input);
      if (result.error) {
        const payload = toOpenAIErrorPayload(result.error, {
          generationId: result.generationId,
          creditsConsumed: result.creditsConsumed,
        });
        return {
          ...toResponseErrorPayload(result.error, requestId),
          error: payload.error,
          response: {
            id: requestId,
            status: "failed",
            error: payload.error,
          },
          generation_id: result.generationId,
          generationId: result.generationId,
          credits_consumed: result.creditsConsumed,
        };
      }

      const imageBase64 = result.imageUrl
        ? await getImageBase64(request, result.imageUrl)
        : undefined;

      return toResponsePayload({
        requestId,
        model: parsed.data.model,
        result,
        imageBase64,
      });
    });
  }
);
