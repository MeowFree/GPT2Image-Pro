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
  background?: ImageBackground;
  mixWebFirst?: boolean;
  forceWebBackend?: boolean;
  requiresResponsesBackend?: boolean;
  /** 透明背景抠图回退(显式开关,issue #27):仅 true 且 background=transparent 时,后端不支持
   * 透明则"不透明重生成 + 服务端 ISNet 抠图"得到透明结果;不开则透明直接透传、不支持即返回真实错误。 */
  transparentMatte?: boolean;
  /** 审核改写重试:显式 false 时本次失败不自动改写提示词重试,直接返回真实错误(issue #24)。 */
  moderationPromptRepair?: boolean;
}

export interface GenerateImageResult {
  imageBase64?: string;
  imageUrl?: string;
  imageOutputs?: GeneratedImageOutput[];
  imageOutputCount?: number;
  generationId?: string;
  revisedPrompt?: string;
  upstreamRevisedPrompt?: string;
  promptRepairNotice?: string;
  responseText?: string;
  model?: string;
  responseThinking?: string;
  responseAgent?: string;
  agentEvents?: AgentRunEvent[];
  agentRoundCount?: number;
  /** 是否为"生成即分层"产物(可导出分层 PSD)。 */
  layered?: boolean;
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
  promptRepairNotice?: string;
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
export type ImageBackground = "transparent" | "opaque" | "auto";
export type ModerationBlockRiskLevel = "low" | "medium" | "high";

export interface ImageInputFile {
  data: Buffer;
  name: string;
  type: string;
  url?: string;
  storageBucket?: string;
  storageKey?: string;
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
  background?: ImageBackground;
  mixWebFirst?: boolean;
  forceWebBackend?: boolean;
  requiresResponsesBackend?: boolean;
  /** 透明背景抠图回退(显式开关,issue #27):仅 true 且 background=transparent 时,后端不支持
   * 透明则"不透明重生成 + 服务端 ISNet 抠图"得到透明结果;不开则透明直接透传、不支持即返回真实错误。 */
  transparentMatte?: boolean;
  /** 审核改写重试:显式 false 时本次失败不自动改写提示词重试,直接返回真实错误(issue #24)。 */
  moderationPromptRepair?: boolean;
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
  background?: ImageBackground;
  stream?: boolean;
  thinking?: ThinkingLevel;
  agentMode?: boolean;
  agentMaxRounds?: number;
  agentForceMaxRounds?: boolean;
  /** 分层生成("生成即分层"):agent 先出整图、再逐层生成。仅 agentMode 下有效。 */
  layeredGeneration?: boolean;
  waterfallMode?: boolean;
  rawResponsesBody?: unknown;
  rawChatCompletionsBody?: unknown;
  chatCompletionsUpstreamMode?: "responses" | "chat_completions";
  mixWebFirst?: boolean;
  requiresResponsesBackend?: boolean;
  /** 透明背景抠图回退(显式开关,issue #27):仅 true 且 background=transparent 时,后端不支持
   * 透明则"不透明重生成 + 服务端 ISNet 抠图"得到透明结果;不开则透明直接透传、不支持即返回真实错误。 */
  transparentMatte?: boolean;
  /** 审核改写重试:显式 false 时本次失败不自动改写提示词重试,直接返回真实错误(issue #24)。 */
  moderationPromptRepair?: boolean;
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
    type: "platform" | "pool-api" | "pool-account" | "pool-adobe" | "user-api";
    id?: string;
    groupId?: string | null;
    userId?: string;
    apiKeyId?: string;
    requestKind?: "image_generation" | "image_edit" | "chat" | "responses";
    accountBackend?: "web" | "responses";
    apiInterfaceMode?: "images" | "responses" | "mixed";
    chatCompletionsUpstreamMode?: "responses" | "chat_completions";
    imagesUpstreamMode?: "images" | "responses";
    apiForceResponsesEndpoint?: boolean;
    // adobe（pool-adobe）专属：暴露的 Firefly 模型家族、默认宽高比/分辨率、是否支持
    // 视频。供 image-generation 派发 adobe 请求时选择 family 与映射缺省值。
    adobeEnabledModels?: string[] | null;
    adobeDefaultRatio?: string;
    adobeDefaultResolution?: string;
    adobeSupportsVideo?: boolean;
    billingGroupId?: string | null;
    billingMultiplier?: number;
    reportResult?: boolean;
    inflightLease?: boolean;
    inflightLeaseId?: string | null;
    inflightLeasePersisted?: boolean;
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
