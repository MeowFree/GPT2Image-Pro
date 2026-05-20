export interface GenerateImageParams {
  prompt: string;
  apiPrompt?: string;
  promptOptimization?: boolean;
  moderationBlockRiskLevel?: ModerationBlockRiskLevel;
  size?: string;
  width?: number;
  height?: number;
  model?: string;
  n?: number;
  quality?: ImageQuality;
  moderation?: ImageModeration;
}

export interface GenerateImageResult {
  imageBase64?: string;
  imageUrl?: string;
  revisedPrompt?: string;
  upstreamRevisedPrompt?: string;
  responseText?: string;
  responseThinking?: string;
  error?: string;
  upstreamResetAt?: string;
  retryAfterSeconds?: number;
}

export interface PartialImageResult {
  imageBase64?: string;
  imageUrl?: string;
  index?: number;
  partialImageIndex?: number;
}

export interface ImageGenerationCallbacks {
  onPartialImage?: (image: PartialImageResult) => Promise<void> | void;
  onTextDelta?: (delta: string) => Promise<void> | void;
  onThinkingDelta?: (delta: string) => Promise<void> | void;
}

export type ImageQuality = "auto" | "low" | "medium" | "high";
export type ImageModeration = "auto" | "low";
export type ModerationBlockRiskLevel = "low" | "medium" | "high";

export interface ImageInputFile {
  data: Buffer;
  name: string;
  type: string;
  url?: string;
}

export type ThinkingLevel = "none" | "low" | "medium" | "high" | "xhigh";

export interface EditImageParams {
  prompt: string;
  apiPrompt?: string;
  promptOptimization?: boolean;
  moderationBlockRiskLevel?: ModerationBlockRiskLevel;
  images: ImageInputFile[];
  mask?: ImageInputFile;
  size?: string;
  model?: string;
  quality?: ImageQuality;
  n?: number;
  moderation?: ImageModeration;
}

export interface ChatImageParams {
  prompt: string;
  apiPrompt?: string;
  promptOptimization?: boolean;
  moderationBlockRiskLevel?: ModerationBlockRiskLevel;
  images?: ImageInputFile[];
  history?: ChatHistoryMessage[];
  size?: string;
  model?: string;
  allowGpt55?: boolean;
  quality?: ImageQuality;
  n?: number;
  moderation?: ImageModeration;
  stream?: boolean;
  thinking?: ThinkingLevel;
  rawResponsesBody?: unknown;
}

export interface ChatHistoryVariant {
  text?: string;
  imageUrl?: string;
  size?: string;
  timestamp?: string;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  text?: string;
  imageUrls?: string[];
  variants?: ChatHistoryVariant[];
  activeVariant?: number;
  error?: string;
}

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  useStream?: boolean;
  contentSafetyEnabled?: boolean;
  headers?: Record<string, string>;
  backend?: {
    type: "platform" | "pool-api" | "pool-account" | "user-api";
    id?: string;
    groupId?: string | null;
    userId?: string;
    apiKeyId?: string;
    requestKind?: "image_generation" | "image_edit" | "chat" | "responses";
    accountBackend?: "web" | "responses";
    reportResult?: boolean;
  };
}

export interface GenerationRecord {
  id: string;
  prompt: string;
  revisedPrompt: string | null;
  model: string;
  size: string;
  status: "pending" | "completed" | "failed";
  imageUrl: string | null;
  creditsConsumed: number;
  createdAt: Date;
}
