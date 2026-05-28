import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { logError } from "@repo/shared/logger";

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

function isPrivateIpAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized === "::" || normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpAddress(normalized.replace(/^::ffff:/, ""));
  }

  const parts = normalized.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }

  const [a = 0, b = 0] = parts.map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

export async function validateCallbackUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("callback_url must be a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("callback_url must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("callback_url must not include credentials.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("callback_url must be publicly reachable.");
  }
  if (
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("callback_url must be publicly reachable.");
  }

  const strippedHostname = hostname.replace(/^\[|\]$/g, "");
  const literalIp = isIP(strippedHostname);
  if (literalIp) {
    if (isPrivateIpAddress(strippedHostname)) {
      throw new Error("callback_url must be publicly reachable.");
    }
    return url.toString();
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateIpAddress(entry.address))
  ) {
    throw new Error("callback_url must be publicly reachable.");
  }

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
    const response = await fetch(callbackUrl, {
      method: "POST",
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
