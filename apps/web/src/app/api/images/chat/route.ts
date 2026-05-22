import { randomUUID } from "node:crypto";
import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import {
  canUsePlanCapability,
  getPlanLimits,
} from "@repo/shared/subscription/services/plan-capabilities";
import { getPlanUploadLimits } from "@repo/shared/subscription/services/upload-limits";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { type NextRequest, NextResponse } from "next/server";

import { runImageGenerationForUser } from "@/features/image-generation/operations";
import {
  firstBatchError,
  runBatchImageGeneration,
} from "@/features/image-generation/batch-runner";
import {
  DEFAULT_IMAGE_SIZE,
  validateImageSize,
} from "@/features/image-generation/resolution";
import {
  deleteModerationImages,
  filesToImageInputs,
  formatMegabytes,
  getTotalUploadSize,
  uploadModerationImages,
  validateImageFile,
} from "@/features/image-generation/request-utils";
import { createImageStreamResponse } from "@/features/image-generation/streaming";
import {
  normalizeOutputCompression,
  normalizeOutputFormat,
  VALID_OUTPUT_FORMATS,
} from "@/features/image-generation/output-format";
import type {
  ChatHistoryMessage,
  ImageModeration,
  ImageOutputFormat,
  ImageQuality,
  ThinkingLevel,
} from "@/features/image-generation/types";

const VALID_QUALITIES = new Set<ImageQuality>([
  "auto",
  "low",
  "medium",
  "high",
]);
const VALID_MODERATION = new Set<ImageModeration>(["auto", "low"]);
const VALID_THINKING = new Set<ThinkingLevel>([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
]);

function getPreferredBackendMemberId(history: ChatHistoryMessage[]) {
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    if (!message || message.role !== "assistant" || message.error) continue;
    const variants = message.variants || [];
    const variant = variants[message.activeVariant || 0] || variants[0];
    const accountId = variant?.webConversation?.accountId;
    if (accountId) return accountId;
  }
  return undefined;
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getCount(formData: FormData, maxBatchCount: number) {
  const value = getText(formData, "count");
  if (!value) return 1;
  if (!/^\d+$/.test(value)) {
    throw new Error("count must be an integer.");
  }
  const count = Number(value);
  if (count < 1 || count > maxBatchCount) {
    throw new Error(`count must be between 1 and ${maxBatchCount}.`);
  }
  return count;
}

function getOptionalBoolean(formData: FormData, ...keys: string[]) {
  for (const key of keys) {
    const value = getText(formData, key).toLowerCase();
    if (!value) continue;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
  }
  return undefined;
}

function wantsStreamResponse(request: NextRequest, formData: FormData) {
  if (formData.get("stream") === "true") return true;
  return request.headers.get("accept")?.includes("text/event-stream") ?? false;
}

function getRequestBaseUrl(request: NextRequest) {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    new URL(request.url).origin
  );
}

function toPublicImageUrl(request: NextRequest, imageUrl?: string) {
  if (!imageUrl) return imageUrl;
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }
  return new URL(imageUrl, getRequestBaseUrl(request)).toString();
}

function normalizeHistoryImageUrls(
  request: NextRequest,
  history: ChatHistoryMessage[]
) {
  return history.map((message) => ({
    ...message,
    imageUrls: (message.imageUrls || []).map((url) =>
      toPublicImageUrl(request, url) || url
    ),
    variants: message.variants?.map((variant) => ({
      ...variant,
      imageUrl: toPublicImageUrl(request, variant.imageUrl),
    })),
  }));
}

function getImageFiles(formData: FormData) {
  const images: File[] = [];

  for (const [key, value] of formData.entries()) {
    if (
      value instanceof File &&
      (key === "image" || key === "image[]" || key.startsWith("image_"))
    ) {
      images.push(value);
    }
  }

  return images;
}

function getHistory(
  formData: FormData,
  maxChatImages: number
): ChatHistoryMessage[] {
  const value = getText(formData, "history");
  if (!value) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("history must be valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("history must be an array.");
  }

  return parsed.slice(-24).flatMap((item): ChatHistoryMessage[] => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const role = source.role === "assistant" ? "assistant" : "user";
    const text =
      typeof source.text === "string" ? source.text.slice(0, 4000) : "";
    const imageUrls = Array.isArray(source.imageUrls)
      ? source.imageUrls
          .filter((url): url is string => typeof url === "string")
          .slice(0, maxChatImages)
      : [];
    const variants = Array.isArray(source.variants)
      ? source.variants
          .filter((variant) => variant && typeof variant === "object")
          .slice(0, 10)
          .map((variant) => {
            const item = variant as Record<string, unknown>;
            return {
              text:
                typeof item.text === "string"
                  ? item.text.slice(0, 4000)
                  : undefined,
              imageUrl:
                typeof item.imageUrl === "string"
                  ? item.imageUrl.slice(0, 4000)
                  : undefined,
              size: typeof item.size === "string" ? item.size : undefined,
              timestamp:
                typeof item.timestamp === "string" ? item.timestamp : undefined,
              webConversation:
                item.webConversation &&
                typeof item.webConversation === "object" &&
                typeof (item.webConversation as Record<string, unknown>)
                  .conversationId === "string" &&
                typeof (item.webConversation as Record<string, unknown>)
                  .parentMessageId === "string"
                  ? {
                      conversationId: (
                        item.webConversation as Record<string, unknown>
                      ).conversationId as string,
                      parentMessageId: (
                        item.webConversation as Record<string, unknown>
                      ).parentMessageId as string,
                      accountId:
                        typeof (item.webConversation as Record<string, unknown>)
                          .accountId === "string"
                          ? ((item.webConversation as Record<string, unknown>)
                              .accountId as string)
                          : undefined,
                    }
                  : undefined,
            };
          })
      : undefined;

    return [
      {
        role,
        text,
        imageUrls,
        variants,
        activeVariant:
          typeof source.activeVariant === "number"
            ? source.activeVariant
            : undefined,
        error: typeof source.error === "string" ? source.error : undefined,
      },
    ];
  });
}

function getHistoryMessageText(message: ChatHistoryMessage) {
  if (message.error) return "";
  if (message.role === "user") return message.text || "";

  const variants = message.variants || [];
  const variant = variants[message.activeVariant || 0] || variants[0];
  const imageNote = variant?.imageUrl
    ? `\nGenerated image: ${variant.imageUrl}`
    : "";
  return `${variant?.text || message.text || ""}${imageNote}`;
}

function trimHistoryMessageText(
  message: ChatHistoryMessage,
  maxChars: number
): ChatHistoryMessage | null {
  if (maxChars <= 0 || message.error) return null;

  const text = getHistoryMessageText(message);
  if (!text) return message;
  const trimmedText = text.length > maxChars ? text.slice(0, maxChars) : text;

  if (message.role === "user") {
    return { ...message, text: trimmedText };
  }

  return {
    ...message,
    text: trimmedText,
    variants: undefined,
    activeVariant: undefined,
  };
}

function limitChatContext(params: {
  prompt: string;
  apiPrompt?: string;
  promptOptimization?: boolean;
  history: ChatHistoryMessage[];
  maxChatContextChars: number;
}): { history: ChatHistoryMessage[]; error?: string } {
  const currentPrompt =
    params.promptOptimization === false
      ? params.prompt
      : params.apiPrompt || params.prompt;
  let remaining = params.maxChatContextChars - currentPrompt.length;

  if (remaining < 0) {
    return {
      history: [],
      error: `Chat input context must be no more than ${params.maxChatContextChars} characters.`,
    };
  }

  const limited: ChatHistoryMessage[] = [];
  for (let index = params.history.length - 1; index >= 0; index--) {
    const message = params.history[index];
    if (!message || message.error) continue;

    const textLength = getHistoryMessageText(message).length;
    if (textLength <= remaining) {
      limited.unshift(message);
      remaining -= textLength;
      continue;
    }

    const trimmed = trimHistoryMessageText(message, remaining);
    if (trimmed) limited.unshift(trimmed);
    break;
  }

  return { history: limited };
}

export const POST = withApiLogging(async (request: NextRequest) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return errorResponse("Unauthorized", 401);
  }

  const plan = await getUserPlan(session.user.id);
  if (!(await canUsePlanCapability(plan.plan, "imageGeneration.chat"))) {
    return errorResponse("Chat mode requires Pro plan or higher.", 403);
  }
  const planLimits = await getPlanLimits(plan.plan);
  const uploadLimits = await getPlanUploadLimits(plan.plan);
  const maxImageBytes = uploadLimits.maxFileSizeBytes;
  const maxRequestBytes = uploadLimits.maxUploadBytes;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      `Upload is too large or incomplete. Each reference image must be ${formatMegabytes(maxImageBytes)} or smaller, and the total upload must be ${formatMegabytes(maxRequestBytes)} or smaller.`,
      413
    );
  }

  const prompt = getText(formData, "prompt");
  if (!prompt) {
    return errorResponse("Prompt is required.");
  }
  if (prompt.length > 4000) {
    return errorResponse("Prompt exceeds the 4000 character limit.");
  }

  const apiPrompt = getText(formData, "apiPrompt") || undefined;
  if (apiPrompt && apiPrompt.length > 8000) {
    return errorResponse("Context prompt exceeds the 8000 character limit.");
  }
  const promptOptimization = getOptionalBoolean(
    formData,
    "promptOptimization",
    "prompt_optimization"
  );
  let history: ChatHistoryMessage[] = [];
  try {
    history = getHistory(formData, planLimits.maxChatImages);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Invalid history."
    );
  }
  const limitedContext = limitChatContext({
    prompt,
    apiPrompt,
    promptOptimization,
    history,
    maxChatContextChars: planLimits.maxChatContextChars,
  });
  if (limitedContext.error) {
    return errorResponse(limitedContext.error);
  }
  history = normalizeHistoryImageUrls(request, limitedContext.history);
  const preferredBackendMemberId = getPreferredBackendMemberId(history);

  const sourceFiles = getImageFiles(formData);
  let size = getText(formData, "size") || DEFAULT_IMAGE_SIZE;
  const sizeCheck = validateImageSize(size);
  if (!sizeCheck.valid) {
    if (sourceFiles.length > 0) {
      size = DEFAULT_IMAGE_SIZE;
    } else {
      return errorResponse(sizeCheck.message);
    }
  }

  const qualityValue = getText(formData, "quality") || "auto";
  if (!VALID_QUALITIES.has(qualityValue as ImageQuality)) {
    return errorResponse("Invalid quality.");
  }
  const quality = qualityValue as ImageQuality;

  const moderationValue = getText(formData, "moderation") || "auto";
  if (!VALID_MODERATION.has(moderationValue as ImageModeration)) {
    return errorResponse("Invalid moderation.");
  }
  const moderation = moderationValue as ImageModeration;
  const outputFormatValue =
    getText(formData, "output_format") || getText(formData, "outputFormat");
  const outputFormat = normalizeOutputFormat(outputFormatValue);
  if (
    outputFormatValue &&
    !VALID_OUTPUT_FORMATS.has(outputFormat as ImageOutputFormat)
  ) {
    return errorResponse("Invalid output_format.");
  }
  const outputCompression = normalizeOutputCompression(
    getText(formData, "output_compression") ||
      getText(formData, "outputCompression")
  );

  const thinkingValue = getText(formData, "thinking") || "low";
  if (!VALID_THINKING.has(thinkingValue as ThinkingLevel)) {
    return errorResponse("Invalid thinking level.");
  }
  const thinking = thinkingValue as ThinkingLevel;

  let count = 1;
  try {
    count = getCount(formData, planLimits.maxBatchCount);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Invalid count."
    );
  }

  const model = getText(formData, "model") || undefined;
  const imageModel =
    getText(formData, "imageModel") ||
    getText(formData, "image_model") ||
    undefined;
  if (sourceFiles.length > planLimits.maxChatImages) {
    return errorResponse(
      `No more than ${planLimits.maxChatImages} images are allowed.`
    );
  }

  try {
    for (const file of sourceFiles) {
      validateImageFile(file, {
        maxImageBytes,
        invalidTypeMessage: "Reference images must be PNG, JPEG, or WebP files.",
      });
    }

    const totalUploadSize = getTotalUploadSize(sourceFiles);
    if (totalUploadSize > maxRequestBytes) {
      return errorResponse(
        `Total upload size must be no more than ${formatMegabytes(maxRequestBytes)}.`,
        413
      );
    }

    const batchId = randomUUID();
    const moderationImages = await uploadModerationImages(
      session.user.id,
      batchId,
      sourceFiles
    );
    const useStreamResponse = wantsStreamResponse(request, formData);

    const buildImages = async () =>
      await filesToImageInputs(sourceFiles, moderationImages);

    const runChat = async (
      generationId: string,
      onPartialImage?: Parameters<typeof runImageGenerationForUser>[1]
    ) =>
      await runImageGenerationForUser(
        {
          mode: "chat",
          userId: session.user.id,
          generationId,
          prompt,
          apiPrompt,
          promptOptimization,
          images: await buildImages(),
          history,
          preferredBackendMemberId,
          maxChatContextChars: planLimits.maxChatContextChars,
          size,
          model,
          imageModel,
          quality,
          n: 1,
          moderation,
          outputFormat,
          outputCompression,
          stream: useStreamResponse,
          thinking,
        },
        onPartialImage
      );

    try {
      if (useStreamResponse) {
        return createImageStreamResponse(async (emit) => {
          try {
            await runBatchImageGeneration({
              count,
              run: runChat,
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
                onTextDelta: async (delta) => {
                  await emit({ type: "text_delta", index, delta });
                },
                onThinkingDelta: async (delta) => {
                  await emit({ type: "thinking_delta", index, delta });
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
            });

            return null;
          } finally {
            await deleteModerationImages(moderationImages);
          }
        });
      }

      if (count === 1) {
        const result = await runChat(randomUUID());
        return NextResponse.json(result);
      }

      const results = await runBatchImageGeneration({
        count,
        run: runChat,
      });

      return NextResponse.json({
        results,
        error: firstBatchError(results)?.error,
      });
    } finally {
      if (!useStreamResponse) {
        await deleteModerationImages(moderationImages);
      }
    }
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to generate image."
    );
  }
});
