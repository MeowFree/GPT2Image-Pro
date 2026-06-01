import { createHash } from "node:crypto";
import type { ApiConfig } from "./types";

export type OpenAIPromptCacheKeyOptions = {
  scope: string;
  model?: string;
  imageModel?: string;
  agentMode?: boolean;
  promptOptimization?: boolean;
  toolSignature?: string;
};

function backendScope(config: ApiConfig) {
  const backend = config.backend;
  if (!backend?.id) return backend?.type || "direct";
  return [
    backend.type,
    backend.id,
    backend.accountBackend,
    backend.apiInterfaceMode,
    backend.imagesUpstreamMode,
    backend.chatCompletionsUpstreamMode,
  ]
    .filter(Boolean)
    .join(":");
}

export function buildOpenAIPromptCacheKey(
  config: ApiConfig,
  options: OpenAIPromptCacheKeyOptions
) {
  const digest = createHash("sha256")
    .update("gpt2image:openai-prompt-cache:v1")
    .update("\n")
    .update(backendScope(config))
    .update("\n")
    .update(options.scope)
    .update("\n")
    .update(options.model || "")
    .update("\n")
    .update(options.imageModel || "")
    .update("\n")
    .update(options.agentMode ? "agent" : "standard")
    .update("\n")
    .update(options.promptOptimization === false ? "original" : "optimized")
    .update("\n")
    .update(options.toolSignature || "")
    .digest("hex")
    .slice(0, 32);

  return `g2i_${digest}`;
}
