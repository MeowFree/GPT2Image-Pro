import { createHash, randomBytes } from "node:crypto";
import type { ApiConfig } from "./types";

export type OpenAIPromptCacheKeyOptions = {
  scope: string;
  model?: string;
  imageModel?: string;
  agentMode?: boolean;
  promptOptimization?: boolean;
  toolSignature?: string;
  // 本次请求的【每请求唯一盐值】(见 buildPromptCacheSalt)。必须并入 key,使 prompt_cache_key
  // 每请求唯一——否则同后端/同 model 的请求会得到相同 prompt_cache_key,若上游中转误把它当
  // 结果缓存键,就会(a)串图:不同输入返回同一张缓存图(实测 700/1000 串);(b)无法变体:用户
  // 传同一张图想要不同结果时被返回缓存的同一张。每请求唯一即可同时杜绝两者。
  inputSignature?: string;
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
    .update("gpt2image:openai-prompt-cache:v2")
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
    .update("\n")
    // 关键:并入每请求唯一盐,使 prompt_cache_key 每请求唯一 → 中和上游中转误把它当结果缓存
    // 键的行为:不同输入不串图,同一输入也每次新鲜出图。
    .update(options.inputSignature || "")
    .digest("hex")
    .slice(0, 32);

  return `g2i_${digest}`;
}

/**
 * 生成【每请求唯一】的盐值,作为 buildOpenAIPromptCacheKey 的 inputSignature。
 *
 * WHY 用随机盐而非内容哈希:prompt_cache_key 本是 OpenAI 的 KV 前缀缓存提示,不该被中转拿来
 * 缓存结果;既然某中转误用了它,就让 key 每请求唯一,彻底中和其结果缓存——
 * 不同输入不串图,且同一输入也每次重新生成(用户传同图想要不同结果)。代价:完全重复的请求
 * 不再命中中转结果缓存(各自重新生成),这正符合"同图要不同结果"的预期;OpenAI 自身仍会自动
 * 缓存前缀,KV 收益损失很小。
 */
export function buildPromptCacheSalt(): string {
  return randomBytes(16).toString("hex");
}

// 零宽字符表（渲染时不可见、对出图无可见影响）。每个字符承载 2 bit。
// 用显式 Unicode 转义而非字面量，避免源码里出现不可见字符难以审阅。
const ZERO_WIDTH_CHARS = ["\u200b", "\u200c", "\u200d", "\u2060"];

/**
 * 生成【每请求唯一】的零宽 nonce 字符串（不可见）。
 *
 * WHY：OpenAI 标准 /v1/images 端点不接受 prompt_cache_key（那是 Responses/Chat 的
 * 参数），故无法用随机盐的 prompt_cache_key 中和上游中转的结果缓存。images 直连路径
 * 对同一参考图+同一提示词会发出逐字节相同的请求体，若上游按请求体内容哈希缓存就会返回
 * 同一张旧图（客户反馈"同图同词出同图"）。把每请求唯一的零宽 nonce 追加进 prompt，使
 * 内容哈希每请求不同即可打掉该缓存，且对出图无可见影响。
 */
export function buildInvisibleNonce(): string {
  let out = "";
  for (const byte of randomBytes(8)) {
    out += ZERO_WIDTH_CHARS[byte & 0b11];
    out += ZERO_WIDTH_CHARS[(byte >> 2) & 0b11];
    out += ZERO_WIDTH_CHARS[(byte >> 4) & 0b11];
    out += ZERO_WIDTH_CHARS[(byte >> 6) & 0b11];
  }
  return out;
}

/**
 * 给【发往上游 images 端点】的 prompt 追加每请求唯一的零宽 nonce。
 *
 * 用途：仅用于 images 直连上游请求体（生图/改图），打掉上游按内容缓存。
 * 边界：绝不可用于审核文本或落库的 generation.prompt——只在构造上游请求体的那一刻包一层。
 */
export function appendImagesUpstreamNonce(prompt: string): string {
  return `${prompt}${buildInvisibleNonce()}`;
}
