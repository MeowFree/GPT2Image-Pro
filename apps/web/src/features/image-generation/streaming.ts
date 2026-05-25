import type { AgentRunEvent } from "./types";

export type ImageStreamEvent =
  | {
      type: "partial_image";
      index?: number;
      partial_image_index?: number;
      b64_json?: string;
      url?: string;
      final?: boolean;
    }
  | {
      type: "text_delta";
      index?: number;
      delta: string;
    }
  | {
      type: "thinking_delta";
      index?: number;
      delta: string;
    }
  | {
      type: "agent_delta";
      index?: number;
      delta: string;
    }
  | {
      type: "agent_event";
      index?: number;
      event: AgentRunEvent;
    }
  | {
      type: "completed";
      generationId?: string;
      imageUrl?: string;
      imageFileId?: string;
      model?: string;
      size?: string;
      revisedPrompt?: string;
      responseText?: string;
      responseThinking?: string;
      responseAgent?: string;
      agentEvents?: AgentRunEvent[];
      agentRoundCount?: number;
      webConversation?: {
        conversationId: string;
        parentMessageId: string;
        accountId?: string;
        apiKeyId?: string;
        selectionMessageId?: string;
        selectedImageMessageId?: string;
      };
      backendMember?: {
        type: "api" | "account";
        id: string;
        groupId?: string | null;
        accountBackend?: "web" | "responses";
      };
      responsesPreviousResponse?: {
        responseId: string;
        backendMember: {
          type: "api" | "account";
          id: string;
          groupId?: string | null;
          accountBackend?: "web" | "responses";
        };
        store: true;
        createdAt?: string;
      };
      imageOutputs?: Array<{
        generationId?: string;
        imageUrl?: string;
        imageFileId?: string;
        webImageMessageId?: string;
        webImageGroupId?: string;
        size?: string;
        revisedPrompt?: string;
        upstreamRevisedPrompt?: string;
        index?: number;
        outputRole?: "final" | "agent_draft" | "choice";
      }>;
      creditsConsumed?: number;
    }
  | {
      type: "error";
      error: string;
      generationId?: string;
      creditsConsumed?: number;
    }
  | {
      type: "done";
    };

export function createImageStreamResponse(
  run: (
    emit: (event: ImageStreamEvent) => Promise<void>
  ) => Promise<ImageStreamEvent | null | undefined>
) {
  const encoder = new TextEncoder();
  const keepAliveMs = 5_000;
  const flushPadding = `: ${" ".repeat(2048)}\n\n`;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  return new Response(
    new ReadableStream({
      async start(controller) {
        const write = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };

        keepAlive = setInterval(() => {
          write(`: ping ${Date.now()}\n\n${flushPadding}`);
        }, keepAliveMs);

        const emit = async (event: ImageStreamEvent) => {
          write(
            `data: ${JSON.stringify(event)}\n\n: flush ${Date.now()}\n\n${flushPadding}`
          );
        };

        try {
          write(`: open ${Date.now()}\n\n${flushPadding}`);
          const finalEvent = await run(emit);
          if (finalEvent) {
            await emit(finalEvent);
          }
        } catch (error) {
          await emit({
            type: "error",
            error: error instanceof Error ? error.message : "Streaming failed",
          });
        } finally {
          if (keepAlive) {
            clearInterval(keepAlive);
            keepAlive = undefined;
          }
          await emit({ type: "done" });
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        // The browser closed the fetch stream. Stop writing bytes, but let the
        // route's async work continue; dashboard tab switches keep UI state in
        // the create runtime store.
        closed = true;
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
        "CDN-Cache-Control": "no-store",
        "Cloudflare-CDN-Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      },
    }
  );
}
