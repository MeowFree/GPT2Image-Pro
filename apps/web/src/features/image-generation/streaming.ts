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
      };
      imageOutputs?: Array<{
        generationId?: string;
        imageUrl?: string;
        size?: string;
        revisedPrompt?: string;
        upstreamRevisedPrompt?: string;
        index?: number;
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

        const emit = async (event: ImageStreamEvent) => {
          write(`data: ${JSON.stringify(event)}\n\n`);
        };

        try {
          write(": open\n\n");
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
          if (!(closed || cancelled)) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        // The browser closed the EventSource/fetch stream; the route can stop
        // trying to enqueue keep-alive bytes.
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
