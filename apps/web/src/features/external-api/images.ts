import type { ImageGenerationOperationResult } from "@/features/image-generation/operations";

type OpenAIImageData = {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
};

export type ExternalImageStreamEvent = {
  event?: string;
  data: unknown;
};

type JsonKeepAliveOptions = {
  keepAliveMs?: number;
  initialWaitMs?: number;
  status?: number;
};

export type ExternalApiErrorOptions = {
  type?: string;
  code?: string | null;
  status?: number;
  generationId?: string;
  creditsConsumed?: number;
};

function getRequestBaseUrl(request: Request) {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    new URL(request.url).origin
  );
}

export function getPublicImageUrl(request: Request, imageUrl?: string) {
  if (!imageUrl) return undefined;
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }

  return new URL(imageUrl, getRequestBaseUrl(request)).toString();
}

export async function getImageBase64(request: Request, imageUrl?: string) {
  if (!imageUrl) return undefined;

  const url =
    imageUrl.startsWith("http://") || imageUrl.startsWith("https://")
      ? imageUrl
      : new URL(imageUrl, getRequestBaseUrl(request)).toString();

  const authorization = request.headers.get("authorization");
  const response = await fetch(url, {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Failed to load generated image: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

export async function toOpenAIImageData(
  request: Request,
  result: ImageGenerationOperationResult,
  responseFormat: "url" | "b64_json"
): Promise<OpenAIImageData> {
  const data: OpenAIImageData = {};

  if (responseFormat === "b64_json") {
    data.b64_json = await getImageBase64(request, result.imageUrl);
  } else {
    data.url = getPublicImageUrl(request, result.imageUrl);
  }

  if (result.revisedPrompt) {
    data.revised_prompt = result.revisedPrompt;
  }

  return data;
}

export function openAIImageError(message: string, status = 400, code?: string) {
  return Response.json(
    toOpenAIErrorPayload(message, {
      type: "invalid_request_error",
      code: code ?? null,
      status,
    }),
    { status }
  );
}

export function wantsImageStreamResponse(request: Request, stream?: boolean) {
  if (stream) return true;
  return request.headers.get("accept")?.includes("text/event-stream") ?? false;
}

export function toOpenAIResponseImageItem(params: {
  id: string;
  b64Json: string;
  revisedPrompt?: string;
}) {
  return {
    id: params.id,
    type: "image_generation_call",
    status: "completed",
    result: params.b64Json,
    ...(params.revisedPrompt ? { revised_prompt: params.revisedPrompt } : {}),
  };
}

export function toOpenAIResponseTextItem(params: { id: string; text: string }) {
  return {
    id: params.id,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text: params.text,
        annotations: [],
      },
    ],
  };
}

export function createExternalImageStreamResponse(
  run: (emit: (event: ExternalImageStreamEvent) => Promise<void>) => Promise<void>
) {
  const encoder = new TextEncoder();
  const keepAliveMs = 15_000;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let cancelled = false;

  return new Response(
    new ReadableStream({
      async start(controller) {
        let closed = false;

        const write = (chunk: string) => {
          if (closed || cancelled) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };

        keepAlive = setInterval(() => {
          write(": ping\n\n");
        }, keepAliveMs);

        const emit = async ({ event, data }: ExternalImageStreamEvent) => {
          if (event) write(`event: ${event}\n`);
          write(
            `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`
          );
        };

        try {
          write(": open\n\n");
          await run(emit);
          await emit({ data: "[DONE]" });
        } catch (error) {
          await emit({
            event: "error",
            data: {
              type: "upstream_error",
              message:
                error instanceof Error ? error.message : "Image stream failed",
            },
          });
        } finally {
          if (keepAlive) {
            clearInterval(keepAlive);
            keepAlive = undefined;
          }
          if (!(closed || cancelled)) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        cancelled = true;
        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = undefined;
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    }
  );
}

function classifyExternalApiError(message: string) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("content failed moderation") ||
    normalized.includes("content blocked")
  ) {
    return {
      type: "invalid_request_error",
      code: "content_policy_violation",
      status: 400,
    };
  }

  if (
    normalized.includes("moderation") ||
    normalized.includes("aliyun") ||
    normalized.includes("green-cip") ||
    normalized.includes("readtimeout") ||
    normalized.includes("connecttimeout")
  ) {
    return {
      type: "upstream_error",
      code: "content_moderation_failed",
      status: 502,
    };
  }

  if (normalized.includes("insufficient credits")) {
    return {
      type: "insufficient_quota",
      code: "insufficient_credits",
      status: 402,
    };
  }

  if (normalized.includes("unsupported model")) {
    return {
      type: "invalid_request_error",
      code: "unsupported_model",
      status: 400,
    };
  }

  return {
    type: "upstream_error",
    code: "image_generation_failed",
    status: 502,
  };
}

export function toOpenAIErrorPayload(
  message: string,
  options?: ExternalApiErrorOptions
) {
  const classification = classifyExternalApiError(message);
  const status = options?.status ?? classification.status;
  const code =
    options && "code" in options ? options.code : classification.code;
  const generationId = options?.generationId;
  const creditsConsumed = options?.creditsConsumed;

  return {
    error: {
      message,
      type: options?.type ?? classification.type,
      code,
      status,
      ...(generationId ? { generation_id: generationId, generationId } : {}),
      ...(creditsConsumed !== undefined
        ? { credits_consumed: creditsConsumed }
        : {}),
    },
    ...(generationId ? { generation_id: generationId, generationId } : {}),
    ...(creditsConsumed !== undefined
      ? { credits_consumed: creditsConsumed }
      : {}),
  };
}

function isErrorPayload(data: unknown) {
  return Boolean(data && typeof data === "object" && "error" in data);
}

function getJsonStatus(data: unknown, fallback = 200) {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: { status?: unknown } }).error;
    if (typeof error?.status === "number") return error.status;
  }
  if (isErrorPayload(data)) return 400;
  return fallback;
}

export async function createJsonKeepAliveResponse(
  run: () => Promise<unknown>,
  options?: JsonKeepAliveOptions
) {
  const runResult = run().then(
    (data) => data ?? null,
    (error) =>
      toOpenAIErrorPayload(
        error instanceof Error ? error.message : "Image request failed"
      )
  );

  const initialWaitMs = options?.initialWaitMs ?? 1_000;
  const initialResult = await Promise.race([
    runResult,
    new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), initialWaitMs)
    ),
  ]);

  if (initialResult !== undefined) {
    return Response.json(initialResult, {
      status: getJsonStatus(initialResult, options?.status ?? 200),
      headers: {
        "Cache-Control": "no-store, no-transform",
      },
    });
  }

  const encoder = new TextEncoder();
  const keepAliveMs = options?.keepAliveMs ?? 15_000;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let cancelled = false;

  return new Response(
    new ReadableStream({
      async start(controller) {
        let closed = false;

        const write = (chunk: string) => {
          if (closed || cancelled) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };

        write("\n");
        keepAlive = setInterval(() => {
          write("\n");
        }, keepAliveMs);

        try {
          const data = await runResult;
          write(JSON.stringify(data));
        } finally {
          if (keepAlive) {
            clearInterval(keepAlive);
            keepAlive = undefined;
          }
          if (!(closed || cancelled)) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        cancelled = true;
        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = undefined;
        }
      },
    }),
    {
      status: options?.status ?? 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    }
  );
}
