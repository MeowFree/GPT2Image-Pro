import { describe, expect, it } from "vitest";

import {
  buildChatCompletionAssistantContent,
  chatCompletionMessagesToChatParams,
} from "./chat-completions-utils";

describe("chat completions adapter utilities", () => {
  it("maps system, history, final user text, and image_url into chat params", () => {
    const params = chatCompletionMessagesToChatParams([
      { role: "system", content: "Use a clean poster style." },
      { role: "user", content: "Create a first draft." },
      {
        role: "assistant",
        content: "First draft created.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Refine this into a 4K hero image." },
          {
            type: "image_url",
            image_url: { url: "https://example.com/reference.png" },
          },
        ],
      },
    ]);

    expect(params.apiPrompt).toBe("Use a clean poster style.");
    expect(params.prompt).toBe("Refine this into a 4K hero image.");
    expect(params.promptImageUrls).toEqual([
      "https://example.com/reference.png",
    ]);
    expect(params.history).toEqual([
      { role: "user", text: "Create a first draft.", imageUrls: undefined },
      { role: "assistant", text: "First draft created.", imageUrls: undefined },
    ]);
  });

  it("adds generated image URLs to assistant content", () => {
    expect(
      buildChatCompletionAssistantContent({
        text: "Here is the result.",
        images: [{ url: "https://example.com/out.png" }],
      })
    ).toBe(
      "Here is the result.\n\n![generated image 1](https://example.com/out.png)"
    );
  });

  it("maps tool/function role into history with a Tool output prefix", () => {
    const params = chatCompletionMessagesToChatParams([
      { role: "user", content: "Look up the weather." },
      { role: "tool", content: "Sunny, 24C." },
      { role: "function", content: "Humidity 40%." },
      { role: "user", content: "Now draw it." },
    ]);

    expect(params.history).toEqual([
      { role: "user", text: "Look up the weather.", imageUrls: undefined },
      { role: "assistant", text: "Tool output:\nSunny, 24C." },
      { role: "assistant", text: "Tool output:\nHumidity 40%." },
    ]);
    expect(params.prompt).toBe("Now draw it.");
  });

  it("extracts string-form image_url parts", () => {
    const params = chatCompletionMessagesToChatParams([
      {
        role: "user",
        content: [
          { type: "text", text: "Use this." },
          { type: "image_url", image_url: "https://example.com/string.png" },
        ],
      },
    ]);

    expect(params.promptImageUrls).toEqual(["https://example.com/string.png"]);
  });

  it("flushes an earlier user message into history when followed by another user message", () => {
    const params = chatCompletionMessagesToChatParams([
      { role: "user", content: "First message." },
      { role: "user", content: "Second message." },
    ]);

    expect(params.history).toEqual([
      { role: "user", text: "First message.", imageUrls: undefined },
    ]);
    expect(params.prompt).toBe("Second message.");
  });

  it("falls back to 'Image generated.' when there is no text", () => {
    expect(
      buildChatCompletionAssistantContent({
        images: [{ b64_json: "data" }],
      })
    ).toBe("Image generated.");
  });

  it("omits assistant text when includeText is false", () => {
    expect(
      buildChatCompletionAssistantContent({
        text: "Suppressed narration.",
        images: [{ url: "https://example.com/out.png" }],
        includeText: false,
      })
    ).toBe("![generated image 1](https://example.com/out.png)");
  });
});
