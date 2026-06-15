import type { ChatHistoryMessage } from "@repo/image-generation/types";

export type ChatCompletionTextPart = {
  type: "text";
  text: string;
};

export type ChatCompletionImageUrlPart = {
  type: "image_url";
  image_url: string | { url?: string | null };
};

export type ChatCompletionContentPart =
  | ChatCompletionTextPart
  | ChatCompletionImageUrlPart
  | { type: string; [key: string]: unknown };

export type ChatCompletionMessageLike = {
  role: string;
  content?: string | ChatCompletionContentPart[] | null;
};

export type ChatCompletionImageData = {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
  prompt_repair_notice?: string;
  index?: number;
  generation_id?: string;
  generationId?: string;
};

function getImageUrl(value: ChatCompletionImageUrlPart["image_url"]) {
  if (typeof value === "string") return value.trim();
  return typeof value.url === "string" ? value.url.trim() : "";
}

export function getChatCompletionContentText(
  content: ChatCompletionMessageLike["content"]
) {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((part): part is ChatCompletionTextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function getChatCompletionContentImages(
  content: ChatCompletionMessageLike["content"]
) {
  if (!content || typeof content === "string") return [];
  return content
    .filter(
      (part): part is ChatCompletionImageUrlPart =>
        part.type === "image_url" && "image_url" in part
    )
    .map((part) => getImageUrl(part.image_url))
    .filter(Boolean);
}

export function chatCompletionMessagesToChatParams(
  messages: readonly ChatCompletionMessageLike[]
) {
  const systemTexts: string[] = [];
  const history: ChatHistoryMessage[] = [];
  let prompt = "";
  let promptImageUrls: string[] = [];

  const flushPromptToHistory = () => {
    if (!prompt && !promptImageUrls.length) return;
    history.push({
      role: "user",
      text: prompt,
      imageUrls: promptImageUrls.length ? promptImageUrls : undefined,
    });
    prompt = "";
    promptImageUrls = [];
  };

  for (const message of messages) {
    const role = message.role;
    const text = getChatCompletionContentText(message.content);
    const imageUrls = getChatCompletionContentImages(message.content);

    if (role === "system" || role === "developer") {
      if (text) systemTexts.push(text);
      continue;
    }

    if (role === "user") {
      flushPromptToHistory();
      prompt = text;
      promptImageUrls = imageUrls;
      continue;
    }

    if (role === "assistant") {
      flushPromptToHistory();
      if (text || imageUrls.length) {
        history.push({
          role: "assistant",
          text,
          imageUrls: imageUrls.length ? imageUrls : undefined,
        });
      }
      continue;
    }

    if ((role === "tool" || role === "function") && text) {
      flushPromptToHistory();
      history.push({
        role: "assistant",
        text: `Tool output:\n${text}`,
      });
    }
  }

  return {
    prompt: prompt.trim(),
    apiPrompt: systemTexts.join("\n\n").trim() || undefined,
    history,
    promptImageUrls,
  };
}

export function buildChatCompletionImageMarkdown(
  images: readonly ChatCompletionImageData[]
) {
  return images
    .map((image, index) =>
      image.url ? `![generated image ${index + 1}](${image.url})` : ""
    )
    .filter(Boolean)
    .join("\n");
}

export function buildChatCompletionAssistantContent(params: {
  text?: string;
  images: readonly ChatCompletionImageData[];
  includeText?: boolean;
}) {
  const parts: string[] = [];
  if (params.includeText !== false && params.text?.trim()) {
    parts.push(params.text.trim());
  }
  const imageMarkdown = buildChatCompletionImageMarkdown(params.images);
  if (imageMarkdown) parts.push(imageMarkdown);
  if (!parts.length && params.images.length) return "Image generated.";
  return parts.join("\n\n");
}
