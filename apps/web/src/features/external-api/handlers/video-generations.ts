/**
 * v1 视频生成端点 handler（外部 API）。
 *
 * 鉴权（外部 API key）→ 校验 Firefly 视频模型 → runAdobeVideoGenerationForUser（含幂等
 * 扣费/落库/re-host）→ 返回 OpenAI-images 风格响应（data[].url 为产物视频 URL）。视频是
 * 长任务，复用 createJsonKeepAliveResponse 撑住连接；operation 内出错则 throw，由其转成带
 * 状态的 OpenAI 错误响应。
 */

import { withApiLogging } from "@repo/shared/api-logger";
import { isFireflyVideoModelId } from "@repo/shared/adobe/firefly-direct/video-catalog";
import { logError } from "@repo/shared/logger";
import { canUsePlanCapability } from "@repo/shared/subscription/services/plan-capabilities";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { nanoid } from "nanoid";
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  completeAsyncImageTask,
  createAsyncImageTask,
  postAsyncImageCallback,
  toAsyncImageTaskResponse,
  validateCallbackUrl,
} from "@/features/external-api/async-image-tasks";
import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import {
  createJsonKeepAliveResponse,
  IMAGE_JSON_KEEP_ALIVE_INITIAL_WAIT_MS,
  openAIImageError,
  toOpenAIErrorPayload,
} from "@/features/external-api/images";
import {
  IMAGE_PROMPT_MAX_CHARACTERS,
  IMAGE_PROMPT_TOO_LONG_MESSAGE,
} from "@/features/image-generation/resolution";
import { runAdobeVideoGenerationForUser } from "@/features/image-generation/video-operations";

const inputImageSchema = z
  .string()
  .min(1)
  .max(20_000_000)
  .regex(/^data:image\/[a-zA-Z.+-]+;base64,/, "Invalid image data URL");

const externalVideoSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(IMAGE_PROMPT_MAX_CHARACTERS, IMAGE_PROMPT_TOO_LONG_MESSAGE),
  // 完整 Firefly 视频 model id：firefly-<family>-<dur>s-<ratio>[-<res>]。
  model: z.string().trim().min(1).max(120),
  negativePrompt: z.string().max(8000).optional(),
  negative_prompt: z.string().max(8000).optional(),
  // 图生视频输入图（base64 data URL，首帧/尾帧/参考），最多 3 张。
  image: z.array(inputImageSchema).max(3).optional(),
  // 异步开关（视频是长任务，建议异步）：立即返回 task_...，后台生成，凭 task_id 或
  // generation_id 轮询 GET /v1/videos/{id}；可选 callback_url 完成回调。
  async: z.boolean().optional(),
  callback_url: z.string().url().max(2048).optional(),
  callbackUrl: z.string().url().max(2048).optional(),
});

function decodeImageDataUrl(value: string): { data: Buffer; type: string } {
  const match = value.match(/^data:(image\/[a-zA-Z.+-]+);base64,(.*)$/);
  const type = match?.[1] || "image/png";
  const base64 = match?.[2] || "";
  return { data: Buffer.from(base64, "base64"), type };
}

export const postExternalVideoGenerations = withApiLogging(
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
        "External video generation is not enabled for this plan.",
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

    const parsed = externalVideoSchema.safeParse(body);
    if (!parsed.success) {
      return openAIImageError(
        parsed.error.issues[0]?.message || "Invalid request"
      );
    }
    if (!isFireflyVideoModelId(parsed.data.model)) {
      return openAIImageError(
        "Unsupported video model. Use a firefly-<family>-<dur>s-<ratio>[-<res>] id; see /v1/models."
      );
    }

    const inputImages = parsed.data.image?.map(decodeImageDataUrl);
    const negativePrompt =
      parsed.data.negativePrompt ?? parsed.data.negative_prompt;

    const useAsync =
      parsed.data.async === true ||
      request.nextUrl.searchParams.get("async") === "true";
    let callbackUrl: string | undefined;
    if (parsed.data.callback_url || parsed.data.callbackUrl) {
      try {
        callbackUrl = await validateCallbackUrl(
          (parsed.data.callback_url || parsed.data.callbackUrl) as string
        );
      } catch (error) {
        return openAIImageError(
          error instanceof Error ? error.message : "Invalid callback_url."
        );
      }
    }

    const runInput = {
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      prompt: parsed.data.prompt,
      model: parsed.data.model,
      ...(negativePrompt ? { negativePrompt } : {}),
      ...(inputImages?.length ? { inputImages } : {}),
    };
    const bucketName = async () =>
      (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
      "generations";

    // 异步：预供 videoId(令任务 generation_id = video_generation 行 id),立即返回
    // task_...,后台跑生成 → 完成/失败时落任务态 + 可选 callback。凭 task_id 或
    // generation_id 走 GET /v1/videos/{id} 轮询(后者 DB 持久,跨重启/多实例可查)。
    if (useAsync) {
      const videoId = nanoid();
      const task = createAsyncImageTask({
        userId: auth.userId,
        apiKeyId: auth.apiKeyId,
        model: parsed.data.model,
        generationIds: [videoId],
      });

      void (async () => {
        try {
          const result = await runAdobeVideoGenerationForUser({
            ...runInput,
            videoGenerationId: videoId,
          });
          let completed: ReturnType<typeof completeAsyncImageTask>;
          if ("error" in result) {
            // 传 OpenAI 错误信封,使任务对象得到规范的 error:{message,...}（与图像异步一致）。
            completed = completeAsyncImageTask(task.id, {
              error: toOpenAIErrorPayload(result.error),
            });
          } else {
            const videoUrl =
              buildSignedStorageImageUrl(result.storageKey, await bucketName()) ??
              "";
            completed = completeAsyncImageTask(task.id, {
              result: {
                object: "video",
                model: parsed.data.model,
                video_url: videoUrl,
                data: [{ url: videoUrl }],
                credits_consumed: result.creditsConsumed,
              },
            });
          }
          if (callbackUrl && completed) {
            await postAsyncImageCallback(callbackUrl, completed);
          }
        } catch (error) {
          logError(error, {
            source: "external-api-async-video",
            taskId: task.id,
          });
          const failed = completeAsyncImageTask(task.id, {
            error: toOpenAIErrorPayload(
              error instanceof Error ? error.message : "Video generation failed"
            ),
          });
          if (callbackUrl && failed) {
            await postAsyncImageCallback(callbackUrl, failed).catch(() => {});
          }
        }
      })();

      return Response.json(toAsyncImageTaskResponse(task), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    // 同步：keep-alive 撑住长连接,跑完直接返回视频 URL(并带 generation_id 便于后续复查)。
    return createJsonKeepAliveResponse(
      async () => {
        const result = await runAdobeVideoGenerationForUser({
          ...runInput,
          signal: request.signal,
        });
        if ("error" in result) {
          // 由 createJsonKeepAliveResponse 转成带状态的 OpenAI 错误响应。
          throw new Error(result.error);
        }
        const bucket = await bucketName();
        return {
          created: Math.floor(Date.now() / 1000),
          model: parsed.data.model,
          data: [
            {
              url:
                buildSignedStorageImageUrl(result.storageKey, bucket) ?? "",
            },
          ],
          generation_id: result.videoGenerationId,
          generationId: result.videoGenerationId,
          credits_consumed: result.creditsConsumed,
        };
      },
      { initialWaitMs: IMAGE_JSON_KEEP_ALIVE_INITIAL_WAIT_MS }
    );
  }
);
