export interface GenerateImageParams {
  prompt: string;
  apiPrompt?: string;
  promptOptimization?: boolean;
  signal?: AbortSignal;
  moderationBlockRiskLevel?: ModerationBlockRiskLevel;
  size?: string;
  width?: number;
  height?: number;
  model?: string;
  gptModel?: string;
  thinking?: ThinkingLevel;
  n?: number;
  quality?: ImageQuality;
  moderation?: ImageModeration;
  outputFormat?: ImageOutputFormat;
  outputCompression?: number;
  mixWebFirst?: boolean;
  forceWebBackend?: boolean;
  requiresResponsesBackend?: boolean;
}

export interface GenerateImageResult {
  imageBase64?: string;
  imageUrl?: string;
  imageOutputs?: GeneratedImageOutput[];
  imageOutputCount?: number;
  revisedPrompt?: string;
  upstreamRevisedPrompt?: string;
  responseText?: string;
  responseThinking?: string;
  responseAgent?: string;
  agentEvents?: AgentRunEvent[];
  agentRoundCount?: number;
  webConversation?: ChatGptWebConversationState;
  backendMember?: StickyBackendMemberState;
  responsesPreviousResponse?: ResponsesPreviousResponseState;
  responsesUsage?: ResponsesTokenUsage;
  partialAgentError?: string;
  error?: string;
  upstreamResetAt?: string;
  retryAfterSeconds?: number;
}

export interface ResponsesTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

export interface GeneratedImageOutput {
  imageBase64?: string;
  imageUrl?: string;
  imageFileId?: string;
  webImageMessageId?: string;
  webImageGroupId?: string;
  generationId?: string;
  size?: string;
  revisedPrompt?: string;
  upstreamRevisedPrompt?: string;
  index?: number;
  outputRole?: "final" | "agent_draft" | "choice";
}

export interface PartialImageResult {
  imageBase64?: string;
  imageUrl?: string;
  index?: number;
  partialImageIndex?: number;
  final?: boolean;
}

export type AgentRunEventKind =
  | "message"
  | "reasoning"
  | "web_search"
  | "code_interpreter"
  | "image_generation"
  | "image_partial"
  | "tool";

export type AgentRunEventStatus =
  | "started"
  | "running"
  | "completed"
  | "failed";

export interface AgentRunEvent {
  id?: string;
  kind: AgentRunEventKind;
  status?: AgentRunEventStatus;
  title: string;
  detail?: string;
  imageBase64?: string;
  imageUrl?: string;
  index?: number;
  partialImageIndex?: number;
  timestamp?: string;
  toolType?: string;
}

export interface ImageGenerationCallbacks {
  onPartialImage?: (image: PartialImageResult) => Promise<void> | void;
  onTextDelta?: (delta: string) => Promise<void> | void;
  onThinkingDelta?: (delta: string) => Promise<void> | void;
  onAgentDelta?: (delta: string) => Promise<void> | void;
  onAgentEvent?: (event: AgentRunEvent) => Promise<void> | void;
}

export type ImageQuality = "auto" | "low" | "medium" | "high";
export type ImageModeration = "auto" | "low";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ModerationBlockRiskLevel = "low" | "medium" | "high";

export interface ImageInputFile {
  data: Buffer;
  name: string;
  type: string;
  url?: string;
  imageFileId?: string;
}

export interface ResponsesInputFile {
  data: Buffer;
  name: string;
  type: string;
  url?: string;
  fileId?: string;
}

export type ThinkingLevel =
  | "minimal"
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface EditImageParams {
  prompt: string;
  apiPrompt?: string;
  promptOptimization?: boolean;
  signal?: AbortSignal;
  moderationBlockRiskLevel?: ModerationBlockRiskLevel;
  images: ImageInputFile[];
  mask?: ImageInputFile;
  size?: string;
  model?: string;
  gptModel?: string;
  thinking?: ThinkingLevel;
  quality?: ImageQuality;
  n?: number;
  moderation?: ImageModeration;
  outputFormat?: ImageOutputFormat;
  outputCompression?: number;
  mixWebFirst?: boolean;
  forceWebBackend?: boolean;
  requiresResponsesBackend?: boolean;
}

export interface ChatImageParams {
  prompt: string;
  apiPrompt?: string;
  fileContext?: string;
  files?: ResponsesInputFile[];
  promptOptimization?: boolean;
  signal?: AbortSignal;
  moderationBlockRiskLevel?: ModerationBlockRiskLevel;
  images?: ImageInputFile[];
  history?: ChatHistoryMessage[];
  size?: string;
  model?: string;
  imageModel?: string;
  allowGpt55?: boolean;
  quality?: ImageQuality;
  n?: number;
  moderation?: ImageModeration;
  outputFormat?: ImageOutputFormat;
  outputCompression?: number;
  stream?: boolean;
  thinking?: ThinkingLevel;
  agentMode?: boolean;
  agentMaxRounds?: number;
  agentForceMaxRounds?: boolean;
  waterfallMode?: boolean;
  rawResponsesBody?: unknown;
  mixWebFirst?: boolean;
  requiresResponsesBackend?: boolean;
}

export interface ChatGptWebConversationState {
  conversationId: string;
  parentMessageId: string;
  accountId?: string;
  apiKeyId?: string;
  selectionMessageId?: string;
  selectedImageMessageId?: string;
}

export interface StickyBackendMemberState {
  type: "api" | "account";
  id: string;
  groupId?: string | null;
  accountBackend?: "web" | "responses";
}

export interface ResponsesPreviousResponseState {
  responseId: string;
  backendMember: StickyBackendMemberState;
  store: true;
  createdAt?: string;
}

export interface ChatHistoryVariant {
  text?: string;
  imageUrl?: string;
  imageFileId?: string;
  webImageMessageId?: string;
  webImageGroupId?: string;
  size?: string;
  timestamp?: string;
  webConversation?: ChatGptWebConversationState;
  backendMember?: StickyBackendMemberState;
  responsesPreviousResponse?: ResponsesPreviousResponseState;
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
  signal?: AbortSignal;
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
    apiInterfaceMode?: "images" | "responses" | "mixed";
    apiForceResponsesEndpoint?: boolean;
    billingGroupId?: string | null;
    billingMultiplier?: number;
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
