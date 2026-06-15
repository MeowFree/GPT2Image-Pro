import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo/shared/security/dns-pin", () => ({
  fetchWithDnsPin: vi.fn(),
  SsrfBlockedError: class SsrfBlockedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SsrfBlockedError";
    }
  },
}));

import { fetchWithDnsPin } from "@repo/shared/security/dns-pin";
import {
  completeAsyncImageTask,
  createAsyncImageTask,
  postAsyncImageCallback,
  toAsyncImageTaskResponse,
  validateCallbackUrl,
} from "./async-image-tasks";

const mockFetchWithDnsPin = vi.mocked(fetchWithDnsPin);

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetchWithDnsPin.mockReset();
});

describe("external async image tasks", () => {
  it("creates a public processing payload without owner fields", () => {
    const task = createAsyncImageTask({
      userId: "user_1",
      apiKeyId: "key_1",
      model: "gpt-image-2",
      generationIds: ["gen_1"],
    });

    expect(toAsyncImageTaskResponse(task)).toMatchObject({
      id: expect.stringMatching(/^task_/),
      object: "image.generation",
      model: "gpt-image-2",
      status: "processing",
      generation_id: "gen_1",
      generationId: "gen_1",
    });
    expect(toAsyncImageTaskResponse(task)).not.toHaveProperty("userId");
    expect(toAsyncImageTaskResponse(task)).not.toHaveProperty("apiKeyId");
  });

  it("flattens completed image payload fields onto the task", () => {
    const task = createAsyncImageTask({
      userId: "user_1",
      model: "gpt-image-2",
      generationIds: ["gen_1", "gen_2"],
    });

    const completed = completeAsyncImageTask(task.id, {
      result: {
        created: 123,
        data: [{ url: "https://cdn.example.com/image.png" }],
        credits_consumed: 1.2,
      },
    });

    expect(completed && toAsyncImageTaskResponse(completed)).toMatchObject({
      id: task.id,
      object: "image",
      status: "completed",
      created: 123,
      data: [{ url: "https://cdn.example.com/image.png" }],
      credits_consumed: 1.2,
      generation_ids: ["gen_1", "gen_2"],
    });
  });

  it("rejects private callback URLs", async () => {
    await expect(
      validateCallbackUrl("https://127.0.0.1/callback")
    ).rejects.toThrow("publicly reachable");
  });

  it("rejects http callback URLs to keep results off plaintext", async () => {
    await expect(
      validateCallbackUrl("http://example.com/callback")
    ).rejects.toThrow("https");
  });

  it("posts callback payloads with the callback marker header", async () => {
    mockFetchWithDnsPin.mockResolvedValueOnce(new Response("ok"));
    const task = createAsyncImageTask({ userId: "user_1" });

    await postAsyncImageCallback("https://example.com/callback", task);

    expect(mockFetchWithDnsPin).toHaveBeenCalledWith(
      expect.stringContaining("https://example.com/callback"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Tokens-Callback": "true",
        }),
      })
    );
  });

  it("does not follow a callback redirect into a private address", async () => {
    mockFetchWithDnsPin.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      })
    );
    const task = createAsyncImageTask({ userId: "user_1" });

    await postAsyncImageCallback("https://example.com/callback", task);

    expect(mockFetchWithDnsPin).toHaveBeenCalledTimes(1);
  });
});
