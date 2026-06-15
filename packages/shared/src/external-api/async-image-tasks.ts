import { randomUUID } from "node:crypto";
import { logError } from "@repo/shared/logger";
import {
  assertPublicCallbackUrl,
  fetchPublicCallback,
} from "@repo/shared/external-api/safe-image-fetch";

type AsyncImageTaskStatus = "processing" | "completed" | "failed";

export type AsyncImageTask = {
  id: string;
  object: "image.generation" | "image";
  userId: string;
  apiKeyId?: string;
  model?: string;
  status: AsyncImageTaskStatus;
  created_at: string;
  completed_at?: string;
  generation_id?: string;
  generationId?: string;
  generation_ids?: string[];
  generationIds?: string[];
  [key: string]: unknown;
};

type CreateAsyncImageTaskParams = {
  userId: string;
  apiKeyId?: string;
  model?: string;
  generationIds?: string[];
};

type CompleteAsyncImageTaskParams = {
  result?: unknown;
  error?: unknown;
};

const TASK_TTL_MS = 30 * 60 * 1000;
const CALLBACK_TIMEOUT_MS = 10_000;
const asyncImageTasks = new Map<string, AsyncImageTask>();

// 回调 URL 提交期校验：强制 https + 公网（内网黑名单复用 safe-image-fetch 单一来源）。
export async function validateCallbackUrl(value: string) {
  const url = await assertPublicCallbackUrl(value);
  return url.toString();
}

export function createAsyncImageTask(params: CreateAsyncImageTaskParams) {
  const id = `task_${randomUUID().replace(/-/g, "")}`;
  const generationIds = params.generationIds?.filter(Boolean);
  const now = new Date();
  const task: AsyncImageTask = {
    id,
    object: "image.generation",
    userId: params.userId,
    apiKeyId: params.apiKeyId,
    model: params.model,
    status: "processing",
    created: Math.floor(now.getTime() / 1000),
    created_at: now.toISOString(),
    ...(generationIds?.length === 1
      ? {
          generation_id: generationIds[0],
          generationId: generationIds[0],
        }
      : generationIds?.length
        ? {
            generation_ids: generationIds,
            generationIds,
          }
        : {}),
  };
  asyncImageTasks.set(id, task);
  const timeout = setTimeout(() => asyncImageTasks.delete(id), TASK_TTL_MS);
  if (
    typeof timeout === "object" &&
    "unref" in timeout &&
    typeof timeout.unref === "function"
  ) {
    timeout.unref();
  }
  return task;
}

export function getAsyncImageTask(id: string) {
  return asyncImageTasks.get(id);
}

export function toAsyncImageTaskResponse(task: AsyncImageTask) {
  const { userId: _userId, apiKeyId: _apiKeyId, ...publicTask } = task;
  return publicTask;
}

export function completeAsyncImageTask(
  id: string,
  params: CompleteAsyncImageTaskParams
) {
  const existing = asyncImageTasks.get(id);
  if (!existing) return undefined;

  const now = new Date();
  const completedAt = now.toISOString();
  const payload = params.error ?? params.result;
  const payloadFields =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : params.error
        ? { error: payload }
        : { result: payload };
  const task: AsyncImageTask = {
    ...existing,
    ...payloadFields,
    object: "image",
    status: params.error ? "failed" : "completed",
    completed: Math.floor(now.getTime() / 1000),
    completed_at: completedAt,
  };
  asyncImageTasks.set(id, task);
  return task;
}

export async function postAsyncImageCallback(
  callbackUrl: string,
  payload: AsyncImageTask
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);
  try {
    // 完成时再经逐跳复检投递：弥补"提交校验通过、30 分钟后被 302 跳内网"的 TOCTOU 盲 SSRF。
    const response = await fetchPublicCallback(callbackUrl, {
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Tokens-Callback": "true",
      },
      body: JSON.stringify(toAsyncImageTaskResponse(payload)),
    });
    if (!response.ok) {
      logError(new Error(`Callback returned HTTP ${response.status}`), {
        source: "external-api-async-image-callback",
        taskId: payload.id,
        callbackUrl,
      });
    }
  } catch (error) {
    logError(error, {
      source: "external-api-async-image-callback",
      taskId: payload.id,
      callbackUrl,
    });
  } finally {
    clearTimeout(timeout);
  }
}
