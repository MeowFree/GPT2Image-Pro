import { describe, expect, it } from "vitest";

import {
  createExternalImageStreamResponse,
  createJsonKeepAliveResponse,
  toExternalGenerationUsage,
  toOpenAIErrorPayload,
} from "./images";

async function readFirstChunk(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("missing response body");
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value);
}

describe("external image stream response", () => {
  it("sets no-buffer headers for proxied SSE", async () => {
    const response = createExternalImageStreamResponse(async () => undefined);

    expect(response.headers.get("content-type")).toContain(
      "text/event-stream"
    );
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

describe("external API error classification", () => {
  it("maps plan limit errors to explicit request errors", () => {
    expect(
      toOpenAIErrorPayload("Batch image generation is not enabled for this plan.")
        .error
    ).toMatchObject({
      type: "invalid_request_error",
      code: "insufficient_plan",
      status: 403,
    });

    expect(toOpenAIErrorPayload("n must be between 1 and 10.").error).toMatchObject({
      type: "invalid_request_error",
      code: "plan_limit_exceeded",
      status: 400,
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
});
