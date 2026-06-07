import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createExternalImageStreamResponse,
  createJsonKeepAliveResponse,
  getExternalFinalImageOutputs,
  getImageBase64,
  getPublicImageUrl,
  IMAGE_JSON_KEEP_ALIVE_INITIAL_WAIT_MS,
  toExternalErrorStreamData,
  toExternalGenerationUsage,
  toOpenAIErrorPayload,
  toOpenAIImagesResponse,
} from "./images";

const storageMocks = vi.hoisted(() => {
  const getObjectMock = vi.fn();
  const getStorageProviderMock = vi.fn(async () => ({
    getObject: getObjectMock,
  }));

  return { getObjectMock, getStorageProviderMock };
});

vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: storageMocks.getStorageProviderMock,
}));

async function readFirstChunk(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("missing response body");
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value);
}

beforeEach(() => {
  storageMocks.getObjectMock.mockReset();
  storageMocks.getStorageProviderMock.mockClear();
  vi.unstubAllGlobals();
  vi.stubEnv("BETTER_AUTH_SECRET", "test-storage-signing-secret");
});

describe("external image stream response", () => {
  it("sets no-buffer headers for proxied SSE", async () => {
    const response = createExternalImageStreamResponse(async () => undefined);

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-transform");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe(
      "no-store"
    );
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });

  it("sends an initial padded chunk to encourage immediate flush", async () => {
    const response = createExternalImageStreamResponse(async () => undefined);
    const firstChunk = await readFirstChunk(response);

    expect(firstChunk).toContain(": open");
    expect(firstChunk.length).toBeGreaterThan(1024);
  });
});

describe("external JSON keep-alive response", () => {
  it("uses an early first-byte timeout for long image requests", () => {
    expect(IMAGE_JSON_KEEP_ALIVE_INITIAL_WAIT_MS).toBeLessThanOrEqual(2_000);
  });

  it("sends an initial padded whitespace chunk before slow JSON data", async () => {
    const response = await createJsonKeepAliveResponse(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true }), 50);
        }),
      { initialWaitMs: 0, keepAliveMs: 1_000 }
    );

    const firstChunk = await readFirstChunk(response);

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toContain("no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(firstChunk.trim()).toBe("");
    expect(firstChunk.length).toBeGreaterThan(1024);
  });
});

describe("external generation usage payload", () => {
  it("returns top-level credits and generation id for a single result", () => {
    expect(
      toExternalGenerationUsage([
        { generationId: "gen_1", creditsConsumed: 1.276 },
      ])
    ).toEqual({
      generation_id: "gen_1",
      generationId: "gen_1",
      credits_consumed: 1.28,
    });
  });

  it("returns total credits and all generation ids for batch results", () => {
    expect(
      toExternalGenerationUsage([
        { generationId: "gen_1", creditsConsumed: 1.27 },
        { generationId: "gen_2", creditsConsumed: 2.01 },
      ])
    ).toEqual({
      generation_ids: ["gen_1", "gen_2"],
      generationIds: ["gen_1", "gen_2"],
      credits_consumed: 3.28,
    });
  });
});

describe("external final image selection", () => {
  it("returns final outputs instead of agent drafts", async () => {
    const request = new Request("https://example.com/v1/images/generations");

    const payload = await toOpenAIImagesResponse(
      request,
      [
        {
          generationId: "gen_1",
          imageUrl: "/api/storage/generations/final.png",
          revisedPrompt: "top level prompt",
          creditsConsumed: 1,
          imageOutputs: [
            {
              imageUrl: "/api/storage/generations/draft.png",
              revisedPrompt: "draft prompt",
              outputRole: "agent_draft",
            },
            {
              imageUrl: "/api/storage/generations/final.png",
              revisedPrompt: "final prompt",
              outputRole: "final",
            },
          ],
        },
      ],
      "url",
      123
    );

    expect(payload).toMatchObject({
      created: 123,
      data: [
        {
          revised_prompt: "final prompt",
        },
      ],
      generation_id: "gen_1",
      credits_consumed: 1,
    });
    expect("data" in payload).toBe(true);
    if (!("data" in payload)) throw new Error("expected image response data");
    const url = new URL(payload.data[0]!.url!);
    expect(url.origin).toBe("https://example.com");
    expect(url.pathname).toBe("/api/storage/generations/final.png");
    expect(url.searchParams.get("sig")).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(url.searchParams.get("exp"))).toBeGreaterThan(
      Math.floor(Date.now() / 1000)
    );
  });

  it("signs same-origin absolute storage URLs before returning them to API clients", () => {
    const request = new Request("https://example.com/v1/images/edits");
    const publicUrl = getPublicImageUrl(
      request,
      "https://example.com/api/storage/generations/user/out.png"
    );

    const url = new URL(publicUrl!);
    expect(url.origin).toBe("https://example.com");
    expect(url.pathname).toBe("/api/storage/generations/user/out.png");
    expect(url.searchParams.get("sig")).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(url.searchParams.get("exp"))).toBeGreaterThan(
      Math.floor(Date.now() / 1000)
    );
  });

  it("falls back to the stored primary image when only draft outputs exist", () => {
    expect(
      getExternalFinalImageOutputs({
        generationId: "gen_1",
        imageUrl: "/api/storage/generations/final.png",
        revisedPrompt: "final prompt",
        imageOutputs: [
          {
            imageUrl: "/api/storage/generations/draft.png",
            outputRole: "agent_draft",
          },
        ],
      })
    ).toEqual([
      {
        imageUrl: "/api/storage/generations/final.png",
        revisedPrompt: "final prompt",
        generationId: "gen_1",
        outputRole: "final",
      },
    ]);
  });

  it("returns an error payload when an image result has no final image", async () => {
    const request = new Request("https://example.com/v1/images/generations");

    const payload = await toOpenAIImagesResponse(
      request,
      [
        {
          generationId: "gen_text",
          responseText: "The upstream refused to generate this image.",
          creditsConsumed: 0,
        },
      ],
      "url",
      123
    );

    expect(payload).toMatchObject({
      error: {
        message: "The upstream refused to generate this image.",
        code: "image_generation_failed",
      },
      generation_id: "gen_text",
      credits_consumed: 0,
    });
  });
});

describe("external image error payload", () => {
  it("sanitizes internal database query failures", () => {
    const payload = toOpenAIErrorPayload(
      'Failed query: select "id", "api_key" from "image_backend_api"\nparams: true'
    );

    expect(payload).toMatchObject({
      error: {
        message:
          "Internal backend database error while selecting an image backend. Please retry later.",
        type: "server_error",
        code: "internal_backend_error",
        status: 503,
      },
    });
    expect(payload.error.message).not.toContain("select ");
    expect(payload.error.message).not.toContain("image_backend_api");
    expect(payload.error.message).not.toContain("api_key");
  });
});

describe("external image base64 loading", () => {
  it("reads local storage URLs directly instead of fetching the public route", async () => {
    storageMocks.getObjectMock.mockResolvedValue(Buffer.from("image-bytes"));
    const request = new Request("https://example.com/v1/images/generations", {
      headers: { Authorization: "Bearer external-key" },
    });

    await expect(
      getImageBase64(request, "/api/storage/generations/user/out.png")
    ).resolves.toBe(Buffer.from("image-bytes").toString("base64"));

    expect(storageMocks.getStorageProviderMock).toHaveBeenCalledTimes(1);
    expect(storageMocks.getObjectMock).toHaveBeenCalledWith(
      "user/out.png",
      "generations"
    );
  });

  it("reads same-origin absolute storage URLs directly", async () => {
    storageMocks.getObjectMock.mockResolvedValue(Buffer.from("absolute-image"));
    const request = new Request("https://example.com/v1/images/generations");

    await expect(
      getImageBase64(
        request,
        "https://example.com/api/storage/generations/user/absolute.jpg"
      )
    ).resolves.toBe(Buffer.from("absolute-image").toString("base64"));

    expect(storageMocks.getObjectMock).toHaveBeenCalledWith(
      "user/absolute.jpg",
      "generations"
    );
  });

  it("does not forward external API authorization when fetching remote image URLs", async () => {
    const fetchMock = vi.fn(async () => new Response("remote-image"));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://example.com/v1/images/generations", {
      headers: { Authorization: "Bearer external-key" },
    });

    await expect(
      getImageBase64(request, "https://cdn.example.test/out.png")
    ).resolves.toBe(Buffer.from("remote-image").toString("base64"));

    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.test/out.png");
  });
});

describe("external API error classification", () => {
  it("maps plan limit errors to explicit request errors", () => {
    expect(
      toOpenAIErrorPayload(
        "Batch image generation is not enabled for this plan."
      ).error
    ).toMatchObject({
      type: "invalid_request_error",
      code: "insufficient_plan",
      status: 403,
    });

    expect(
      toOpenAIErrorPayload("n must be between 1 and 10.").error
    ).toMatchObject({
      type: "invalid_request_error",
      code: "plan_limit_exceeded",
      status: 400,
    });
  });

  it("maps insufficient credits (中文 CreditError) to a 402 billing error, not a 502 retryable upstream error", () => {
    // 真实文案来自 credits/core.ts 的 CreditError:"积分不足: 需要 X，可用 Y"。
    // 必须归为 402 insufficient_quota,否则落 502 upstream_error 兜底被客户端反复重试。
    expect(
      toOpenAIErrorPayload("积分不足: 需要 6.46，可用 5.21").error
    ).toMatchObject({
      type: "insufficient_quota",
      code: "insufficient_credits",
      status: 402,
    });
  });

  it("maps queue and concurrency failures to rate limit errors", () => {
    expect(
      toOpenAIErrorPayload(
        "Image generation concurrency limit reached for this plan. Your plan allows 2 concurrent image generation task(s)."
      ).error
    ).toMatchObject({
      type: "rate_limit_error",
      code: "image_generation_queue_busy",
      status: 429,
    });
  });

  it("maps upstream rate limits to rate limit errors", () => {
    expect(
      toOpenAIErrorPayload(
        "ChatGPT Web conversation failed: HTTP 429 Too many requests"
      ).error
    ).toMatchObject({
      type: "rate_limit_error",
      code: "rate_limit_exceeded",
      status: 429,
    });
  });

  it("maps loose upstream status text to the original HTTP status", () => {
    expect(
      toOpenAIErrorPayload("status_code=400, bad response status code 400")
        .error
    ).toMatchObject({
      type: "invalid_request_error",
      code: "upstream_http_400",
      status: 400,
    });
  });

  it("maps unsupported chat/image model errors to bad requests", () => {
    expect(
      toOpenAIErrorPayload("Unsupported chat model. Use gpt-5.4, gpt-5.4-mini.")
        .error
    ).toMatchObject({
      type: "invalid_request_error",
      code: "unsupported_model",
      status: 400,
    });
  });

  it("preserves upstream HTTP error status and metadata", () => {
    expect(
      toOpenAIErrorPayload(
        "Upstream Responses API returned HTTP 400: Input must be a list | invalid_request_error | invalid_request_error"
      ).error
    ).toMatchObject({
      type: "invalid_request_error",
      code: "invalid_request_error",
      status: 400,
    });

    expect(
      toOpenAIErrorPayload(
        "Upstream Responses API returned HTTP 429: The usage limit has been reached | usage_limit_reached"
      ).error
    ).toMatchObject({
      type: "rate_limit_error",
      code: "usage_limit_reached",
      status: 429,
    });
  });

  it("uses classified status and type for streamed error events", () => {
    const message =
      "Upstream Responses API returned HTTP 400: Transparent background is not supported for this model. | invalid_value | image_generation_user_error";
    const payload = toOpenAIErrorPayload(message, {
      generationId: "gen_1",
      creditsConsumed: 0,
    });

    expect(toExternalErrorStreamData(message, payload)).toMatchObject({
      type: "image_generation_user_error",
      code: "invalid_value",
      status: 400,
      message,
      generation_id: "gen_1",
      credits_consumed: 0,
      error: {
        type: "image_generation_user_error",
        code: "invalid_value",
        status: 400,
      },
    });
  });

  it("maps safety refusals to content policy violations", () => {
    expect(
      toOpenAIErrorPayload(
        "I’m sorry, but the edit request couldn’t be completed because the referenced image was flagged by the safety system."
      ).error
    ).toMatchObject({
      type: "invalid_request_error",
      code: "content_policy_violation",
      status: 400,
    });

    expect(
      toOpenAIErrorPayload(
        "Upstream Responses API returned HTTP 400: Your request was rejected by the safety system. safety_violations=[sexual]."
      ).error
    ).toMatchObject({
      type: "invalid_request_error",
      code: "content_policy_violation",
      status: 400,
    });

    expect(
      toOpenAIErrorPayload("I can't help create explicit sexual content.").error
    ).toMatchObject({
      type: "invalid_request_error",
      code: "content_policy_violation",
      status: 400,
    });

    expect(
      toOpenAIErrorPayload(
        "抱歉，我不能协助对这张包含露骨性内容的漫画进行上色。"
      ).error
    ).toMatchObject({
      type: "invalid_request_error",
      code: "content_policy_violation",
      status: 400,
    });
  });

  it("maps unavailable backend pool errors to service unavailable", () => {
    expect(
      toOpenAIErrorPayload("当前生图后端分组没有可用账号或 API").error
    ).toMatchObject({
      type: "server_error",
      code: "no_available_image_backend",
      status: 503,
    });
  });
});
