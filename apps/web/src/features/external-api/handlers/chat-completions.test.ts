import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateExternalApiRequest: vi.fn(),
  canUsePlanCapability: vi.fn(),
  getPlanLimits: vi.fn(),
  getUserPlan: vi.fn(),
  runBatchImageGeneration: vi.fn(),
  runImageGenerationForUser: vi.fn(),
  uploadTemporaryImageUrls: vi.fn(),
}));

vi.mock("@repo/shared/external-api/auth", () => ({
  authenticateExternalApiRequest: mocks.authenticateExternalApiRequest,
}));

vi.mock("@repo/shared/subscription/services/plan-capabilities", () => ({
  MAX_PLAN_BATCH_COUNT: 10_000,
  canUsePlanCapability: mocks.canUsePlanCapability,
  getPlanLimits: mocks.getPlanLimits,
}));

vi.mock("@repo/shared/subscription/services/user-plan", () => ({
  getUserPlan: mocks.getUserPlan,
}));

vi.mock("@/features/image-generation/operations", () => ({
  runImageGenerationForUser: mocks.runImageGenerationForUser,
}));

vi.mock("@/features/image-generation/batch-runner", () => ({
  runBatchImageGeneration: mocks.runBatchImageGeneration,
}));

vi.mock("@/features/image-generation/request-utils", () => ({
  uploadTemporaryImageUrls: mocks.uploadTemporaryImageUrls,
}));

type BatchRunMockParams = {
  count: number;
  generationIds?: string[];
  run: (generationId: string) => Promise<unknown>;
};

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
    mocks.runBatchImageGeneration.mockImplementation(
      async ({ count, generationIds, run }: BatchRunMockParams) => {
        const results = [];
        for (let index = 0; index < count; index += 1) {
          results.push(await run(generationIds?.[index] || `gen_${index + 1}`));
        }
        return results;
      }
    );
    mocks.uploadTemporaryImageUrls.mockResolvedValue(undefined);
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
    const call = mocks.runImageGenerationForUser.mock.calls[0];
    if (!call) throw new Error("expected image generation to be called");
    const [input, callbacks] = call;
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

    const call = mocks.runImageGenerationForUser.mock.calls[0];
    if (!call) throw new Error("expected image generation to be called");
    const [input] = call;
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

  it("passes prompt_repair=false through as moderationPromptRepair", async () => {
    const { postExternalChatCompletions } = await import("./chat-completions");

    const response = await postExternalChatCompletions(
      chatCompletionsRequest({
        model: "gpt-image-2",
        messages: [{ role: "user", content: "draw a poster" }],
        prompt_repair: false,
      }) as never
    );
    await response.json();

    const call = mocks.runImageGenerationForUser.mock.calls[0];
    if (!call) throw new Error("expected image generation to be called");
    const [input] = call;
    expect(input).toEqual(
      expect.objectContaining({ moderationPromptRepair: false })
    );
  });

  it("leaves moderationPromptRepair undefined when prompt_repair is omitted", async () => {
    const { postExternalChatCompletions } = await import("./chat-completions");

    const response = await postExternalChatCompletions(
      chatCompletionsRequest({
        model: "gpt-image-2",
        messages: [{ role: "user", content: "draw a poster" }],
      }) as never
    );
    await response.json();

    const call = mocks.runImageGenerationForUser.mock.calls[0];
    if (!call) throw new Error("expected image generation to be called");
    const [input] = call;
    expect(input.moderationPromptRepair).toBeUndefined();
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
    expect(mocks.runBatchImageGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        callbacks: expect.any(Function),
      })
    );
    expect(mocks.runImageGenerationForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: undefined,
        rawChatCompletionsBody: expect.objectContaining({ stream: true }),
        backendRequestKind: "chat",
      }),
      undefined
    );
  });

});
