import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingBoolean: vi.fn(async () => false),
  getRuntimeSettingNumber: vi.fn(async (_key: string, fallback: number) => fallback),
  getRuntimeSettingString: vi.fn(async () => ""),
}));

import type { ApiConfig } from "./types";

const encoder = new TextEncoder();

function sseBlock(event: string, data: Record<string, unknown>) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("Responses streaming parser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes custom chat model names through for pool API responses backends", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { getResponsesModel } = await import("./service");
    const config: ApiConfig = {
      baseUrl: "https://api.example.test/v1",
      apiKey: "test-key",
      model: "gpt-image-2",
      backend: {
        type: "pool-api",
        id: "api_1",
        groupId: "group_1",
        requestKind: "chat",
        apiInterfaceMode: "mixed",
        reportResult: false,
      },
    };

    await expect(
      getResponsesModel(config, "platform-codex-model")
    ).resolves.toBe("platform-codex-model");
  });

  it("ignores image model names as chat models for pool API responses backends", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { getResponsesModel } = await import("./service");
    const config: ApiConfig = {
      baseUrl: "https://api.example.test/v1",
      apiKey: "test-key",
      model: "gpt-image-2",
      backend: {
        type: "pool-api",
        id: "api_1",
        groupId: "group_1",
        requestKind: "chat",
        apiInterfaceMode: "mixed",
        reportResult: false,
      },
    };

    await expect(getResponsesModel(config, "gpt-image-2")).resolves.toBe(
      "gpt-5.4"
    );
  });

  it("parses stream=true Responses bodies incrementally even when content-type is wrong", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { generateChatImage } = await import("./service");
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
      },
    });
    const fetchMock = vi.fn(async () => {
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    let resolveFirstDelta!: () => void;
    const firstDelta = new Promise<void>((resolve) => {
      resolveFirstDelta = resolve;
    });
    const deltas: string[] = [];
    const config: ApiConfig = {
      baseUrl: "https://api.example.test/v1",
      apiKey: "test-key",
    };

    const resultPromise = generateChatImage(
      config,
      {
        prompt: "hello",
        model: "gpt-5.4",
        stream: true,
      },
      {
        onTextDelta: (delta) => {
          deltas.push(delta);
          resolveFirstDelta();
        },
      }
    );

    controller?.enqueue(
      encoder.encode(
        sseBlock("response.output_text.delta", {
          type: "response.output_text.delta",
          delta: "hello",
        })
      )
    );

    await firstDelta;
    expect(deltas).toEqual(["hello"]);

    controller?.enqueue(
      encoder.encode(
        sseBlock("response.completed", {
          type: "response.completed",
          response: { id: "resp_test", output: [] },
        })
      )
    );
    controller?.close();

    await expect(resultPromise).resolves.toMatchObject({
      responseText: "hello",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/v1/responses",
      expect.objectContaining({
        body: expect.stringContaining('"stream":true'),
      })
    );
  });

  it("closes streamed image generation task when final image only arrives in response.completed", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { generateChatImage } = await import("./service");
    const imageBase64 = Buffer.from("final-image").toString("base64");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            sseBlock("response.output_item.added", {
              type: "response.output_item.added",
              item: {
                id: "ig_1",
                type: "image_generation_call",
                status: "in_progress",
              },
            }) +
              sseBlock("response.image_generation_call.in_progress", {
                type: "response.image_generation_call.in_progress",
                item_id: "ig_1",
              }) +
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
              })
          )
        );
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      })
    );

    const agentEvents: Array<{
      id?: string;
      status?: string;
      title?: string;
      toolType?: string;
    }> = [];
    const result = await generateChatImage(
      {
        baseUrl: "https://api.example.test/v1",
        apiKey: "test-key",
      },
      {
        prompt: "make an image",
        model: "gpt-5.4",
        stream: true,
      },
      {
        onAgentEvent: (event) => {
          agentEvents.push(event);
        },
      }
    );

    expect(result.imageBase64).toBe(imageBase64);
    expect(result.agentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ig_1",
          status: "completed",
          title: "最终图片已生成",
          toolType: "image_generation_call",
        }),
      ])
    );
    expect(agentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ig_1",
          status: "running",
          toolType: "image_generation_call",
        }),
      ])
    );
  });
});
