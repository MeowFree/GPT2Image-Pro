import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingBoolean: vi.fn(async () => false),
  getRuntimeSettingNumber: vi.fn(
    async (_key: string, fallback: number) => fallback
  ),
  getRuntimeSettingString: vi.fn(async () => ""),
}));

vi.mock("@repo/shared/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

const backendPoolMock = vi.hoisted(() => {
  class ImageBackendPoolUnavailableError extends Error {}
  return {
    ImageBackendPoolUnavailableError,
    acquireImageBackendInflight: vi.fn(),
    releaseImageBackendInflight: vi.fn(),
    isImageBackendSwitchableError: vi.fn((error?: string | null) =>
      (error || "").includes("terminated")
    ),
    reportImageBackendResult: vi.fn(async (input: { success: boolean }) => ({
      success: input.success,
      retryable: !input.success,
      switchable: !input.success,
    })),
    resolveImageBackendPoolConfig: vi.fn(),
  };
});

vi.mock("@/features/image-backend-pool/service", () => backendPoolMock);

vi.mock("./chatgpt-web", () => ({
  generateImageWithChatGptWeb: vi.fn(async () => ({ error: "terminated" })),
  editImageWithChatGptWeb: vi.fn(async () => ({ error: "terminated" })),
}));

function sseBlock(event: string, data: Record<string, unknown>) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("image service Web-first fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("falls back to Responses when force Web exhausts Web candidates", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { generateImage } = await import("./service");
    const imageBase64 = Buffer.from("codex-fallback-image").toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          sseBlock("response.completed", {
            type: "response.completed",
            response: {
              id: "resp_test",
              output: [
                {
                  id: "ig_1",
                  type: "image_generation_call",
                  status: "completed",
                  result: imageBase64,
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }
        );
      })
    );

    backendPoolMock.resolveImageBackendPoolConfig
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        config: {
          baseUrl: "https://api.example.test/v1",
          apiKey: "codex-key",
          model: "gpt-5.4",
          backend: {
            type: "pool-account",
            id: "codex-1",
            groupId: "group-1",
            userId: "user-1",
            requestKind: "image_generation",
            accountBackend: "responses",
            reportResult: true,
          },
        },
      });

    const result = await generateImage(
      {
        baseUrl: "https://chatgpt.com",
        apiKey: "web-key",
        backend: {
          type: "pool-account",
          id: "web-1",
          groupId: "group-1",
          userId: "user-1",
          requestKind: "image_generation",
          accountBackend: "web",
          reportResult: true,
        },
      },
      {
        prompt: "make an icon",
        model: "gpt-image-2",
        size: "1024x1024",
        forceWebBackend: true,
      }
    );

    expect(result.imageBase64).toBe(imageBase64);
    expect(
      backendPoolMock.resolveImageBackendPoolConfig
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        accountBackendPreference: "web",
        accountBackendPreferenceMode: "mixed-only",
      })
    );
    expect(
      backendPoolMock.resolveImageBackendPoolConfig
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        accountBackendPreference: "responses",
        accountBackendPreferenceMode: "mixed-only",
      })
    );
  });

  it("retries another pool member when Responses returns text but no final image", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { generateImage } = await import("./service");
    const imageBase64 = Buffer.from("second-member-image").toString("base64");
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response(
          sseBlock("response.completed", {
            type: "response.completed",
            response: {
              id: "resp_text_only",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "已生成图片。" }],
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }
        );
      }
      return new Response(
        sseBlock("response.completed", {
          type: "response.completed",
          response: {
            id: "resp_image",
            output: [
              {
                id: "ig_1",
                type: "image_generation_call",
                status: "completed",
                result: imageBase64,
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    backendPoolMock.resolveImageBackendPoolConfig.mockResolvedValueOnce({
      config: {
        baseUrl: "https://api.example.test/v1",
        apiKey: "codex-key-2",
        model: "gpt-5.4",
        backend: {
          type: "pool-account",
          id: "codex-2",
          groupId: "group-1",
          userId: "user-1",
          requestKind: "image_generation",
          accountBackend: "responses",
          reportResult: true,
        },
      },
    });

    const result = await generateImage(
      {
        baseUrl: "https://api.example.test/v1",
        apiKey: "codex-key-1",
        model: "gpt-5.4",
        backend: {
          type: "pool-account",
          id: "codex-1",
          groupId: "group-1",
          userId: "user-1",
          requestKind: "image_generation",
          accountBackend: "responses",
          reportResult: true,
        },
      },
      {
        prompt: "make an icon",
        model: "gpt-image-2",
        size: "1024x1024",
      }
    );

    expect(result.imageBase64).toBe(imageBase64);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(backendPoolMock.reportImageBackendResult).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "codex-1",
        success: false,
        error: expect.stringContaining("Upstream returned no image output"),
      })
    );
    expect(backendPoolMock.resolveImageBackendPoolConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        excludedMemberKeys: ["account:codex-1"],
      })
    );
  });
});
