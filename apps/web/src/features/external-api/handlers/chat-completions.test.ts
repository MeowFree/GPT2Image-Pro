import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateExternalApiRequest: vi.fn(),
  canUsePlanCapability: vi.fn(),
  getPlanLimits: vi.fn(),
  getUserPlan: vi.fn(),
  runImageGenerationForUser: vi.fn(),
}));

vi.mock("@/features/external-api/auth", () => ({
  authenticateExternalApiRequest: mocks.authenticateExternalApiRequest,
}));

vi.mock("@repo/shared/subscription/services/plan-capabilities", () => ({
  canUsePlanCapability: mocks.canUsePlanCapability,
  getPlanLimits: mocks.getPlanLimits,
}));

vi.mock("@repo/shared/subscription/services/user-plan", () => ({
  getUserPlan: mocks.getUserPlan,
}));

vi.mock("@/features/image-generation/operations", () => ({
  runImageGenerationForUser: mocks.runImageGenerationForUser,
}));

function chatCompletionsRequest(body: Record<string, unknown>) {
  return new Request("https://example.test/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-key",
    },
    body: JSON.stringify(body),
  });
}

describe("external chat completions handler streaming bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateExternalApiRequest.mockResolvedValue({
      userId: "user_1",
      apiKeyId: "key_1",
      moderationBlockRiskLevel: undefined,
    });
    mocks.getUserPlan.mockResolvedValue({ plan: "ultra" });
    mocks.canUsePlanCapability.mockResolvedValue(true);
    mocks.getPlanLimits.mockResolvedValue({
      maxBatchCount: 10,
      imageGenerationConcurrency: 2,
      maxChatContextChars: 10000,
      maxChatImages: 16,
      maxFileMb: 20,
      maxUploadMb: 100,
    });
    mocks.runImageGenerationForUser.mockResolvedValue({
      responseText: "hello",
      model: "gpt-5.4",
      generationId: "gen_1",
      creditsConsumed: 1,
    });
  });

  it("does not force upstream streaming for downstream non-stream callers", async () => {
    const { postExternalChatCompletions } = await import("./chat-completions");

    const response = await postExternalChatCompletions(
      chatCompletionsRequest({
        model: "gpt-5.4",
        messages: [{ role: "user", content: "hello" }],
      }) as never
    );
    const payload = await response.json();

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(payload.object).toBe("chat.completion");
    const [input, callbacks] = mocks.runImageGenerationForUser.mock.calls[0]!;
    expect(input).toEqual(
      expect.objectContaining({
        stream: undefined,
        rawChatCompletionsBody: expect.objectContaining({
          messages: [{ role: "user", content: "hello" }],
        }),
        backendRequestKind: "chat",
      })
    );
    expect(callbacks).toBeUndefined();
  });

  it("treats a top-level gpt-image model as the image model", async () => {
    const { postExternalChatCompletions } = await import("./chat-completions");

    const response = await postExternalChatCompletions(
      chatCompletionsRequest({
        model: "gpt-image-2",
        messages: [{ role: "user", content: "draw a poster" }],
      }) as never
    );
    await response.json();

    const [input] = mocks.runImageGenerationForUser.mock.calls[0]!;
    expect(input).toEqual(
      expect.objectContaining({
        model: undefined,
        imageModel: "gpt-image-2",
      })
    );
    expect(input.rawChatCompletionsBody).toEqual(
      expect.objectContaining({ model: undefined })
    );
  });

  it("does not force upstream streaming for downstream stream callers", async () => {
    const { postExternalChatCompletions } = await import("./chat-completions");

    const response = await postExternalChatCompletions(
      chatCompletionsRequest({
        model: "gpt-5.4",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      }) as never
    );
    await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(mocks.runImageGenerationForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: undefined,
        rawChatCompletionsBody: expect.objectContaining({ stream: true }),
        backendRequestKind: "chat",
      }),
      expect.any(Object)
    );
  });

});
