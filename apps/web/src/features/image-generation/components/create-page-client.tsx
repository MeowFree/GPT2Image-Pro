"use client";

import {
  canUseChat,
  canUseGpt55Chat,
  canUsePromptOptimization,
  GPT52_CHAT_MODEL,
  GPT54_CHAT_MODEL,
  GPT54_MINI_CHAT_MODEL,
  GPT55_CHAT_MODEL,
  type RESPONSES_IMAGE_MODELS,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import { formatCredits } from "@repo/shared/credits/format";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui/components/tabs";
import { Textarea } from "@repo/ui/components/textarea";
import {
  Brush,
  Check,
  CircleHelp,
  Coins,
  ChevronDown,
  Download,
  Eraser,
  Eye,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  Maximize2,
  MessageSquare,
  Plus,
  RefreshCcw,
  Save,
  Send,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import Image from "next/image";
import { useLocale } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  getImageCreditCost,
  IMAGE_DIMENSION_STEP,
  IMAGE_RESOLUTION_PRESETS,
  MAX_IMAGE_DIMENSION,
  normalizeImageSize,
  parseImageSize,
  validateImageSize,
} from "../resolution";
import { ImageLightbox, type LightboxGeneration } from "./image-lightbox";

type RecentGeneration = {
  id: string;
  prompt: string;
  revisedPrompt: string | null;
  model: string;
  size: string;
  creditsConsumed: number;
  status: "pending" | "completed" | "failed";
  imageUrl: string | null;
  createdAt: string;
};

type ResultState = {
  generationId: string;
  imageUrl: string;
  prompt: string;
  model: string;
  size: string;
  revisedPrompt?: string;
};

type ImageApiResult = {
  error?: string;
  generationId?: string;
  imageUrl?: string;
  model?: string;
  size?: string;
  revisedPrompt?: string;
  responseText?: string;
  responseThinking?: string;
  creditsConsumed?: number;
  results?: ImageApiResult[];
};

type GenerationRequestError = Error & {
  creditsConsumed?: number;
};

type ImageStreamEvent =
  | {
      type: "partial_image";
      index?: number;
      partial_image_index?: number;
      b64_json?: string;
      url?: string;
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
  | ({ type: "completed" } & ImageApiResult)
  | ({ type: "error"; error: string } & ImageApiResult)
  | { type: "done" };

type EditImageFile = {
  file: File;
  previewUrl: string;
  sourceId?: string;
};

type ChatAttachment = EditImageFile;

type ChatAttachmentPreview = {
  id: string;
  name: string;
  previewUrl: string;
};

type ChatVariant = {
  generationId?: string;
  imageUrl?: string;
  prompt: string;
  model: string;
  size: string;
  revisedPrompt?: string;
  responseText?: string;
  responseThinking?: string;
  creditsConsumed?: number;
  createdAt?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: ChatAttachmentPreview[];
  variants?: ChatVariant[];
  activeVariant?: number;
  error?: string;
  createdAt: string;
};

type ChatConversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

type ChatStreamState = {
  messageId?: string;
  cardId?: string;
  text: string;
  thinking: string;
  imageUrl?: string;
};

type ChatViewMode = "chat" | "batch";
type ChatModel = (typeof RESPONSES_IMAGE_MODELS)[number];
type ChatThinkingLevel = "none" | "low" | "medium" | "high" | "xhigh";
type TextGenerationMode = "single" | "lines";

type BatchCard = {
  id: string;
  state: "loading" | "image" | "text" | "error";
  aspectRatio: string;
  prompt: string;
  size: string;
  streamText?: string;
  streamThinking?: string;
  imageUrl?: string;
  generationId?: string;
  text?: string;
  error?: string;
  model?: string;
  creditsConsumed?: number;
  saved?: boolean;
};

type MaskPoint = {
  x: number;
  y: number;
  size: number;
};

type ImageQuality = "auto" | "low" | "medium" | "high";
type ImageModeration = "auto" | "low";

type ActiveMode = "text" | "image" | "chat";

const defaultDimensions = parseImageSize(DEFAULT_IMAGE_SIZE) || {
  width: 1024,
  height: 1024,
};

const shouldOptimizeStoredImage = (imageUrl: string | undefined) =>
  Boolean(imageUrl?.startsWith("/api/storage/"));

const MAX_EDIT_IMAGES = 16;
const DEFAULT_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_EDIT_REQUEST_BYTES = 75 * 1024 * 1024;
const CHAT_TEXT_ONLY_CREDITS = 1;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const TEXT_MODEL_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "gpt-image-2", label: "GPT Image 2" },
  { value: "gpt-image-1.5", label: "GPT Image 1.5" },
  { value: "gpt-image-1-mini", label: "GPT Image 1 Mini" },
] as const;
const IMAGE_MODEL_OPTIONS = TEXT_MODEL_OPTIONS.filter(
  (option) => option.value !== "default"
);
const EDIT_MODEL_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "gpt-image-2", label: "GPT Image 2" },
  { value: "gpt-image-1.5", label: "GPT Image 1.5" },
  { value: "gpt-image-1-mini", label: "GPT Image 1 Mini" },
] as const;

const QUALITY_OPTIONS: Array<{ value: ImageQuality; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const MODERATION_OPTIONS: Array<{ value: ImageModeration; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
];
const BATCH_OPTIONS = [1, 2, 4, 6, 8, 10] as const;
const WATERFALL_LOAD_SIZE = 5;
const WATERFALL_MAX_CONCURRENT = WATERFALL_LOAD_SIZE * 3;
const CHAT_MODEL_OPTIONS: Array<{
  value: ChatModel;
  label: string;
  ultraOnly?: boolean;
}> = [
  { value: GPT54_CHAT_MODEL, label: "GPT-5.4" },
  { value: GPT54_MINI_CHAT_MODEL, label: "GPT-5.4 Mini" },
  { value: GPT52_CHAT_MODEL, label: "GPT-5.2" },
  { value: GPT55_CHAT_MODEL, label: "GPT-5.5", ultraOnly: true },
];
const CHAT_THINKING_OPTIONS: Array<{
  value: ChatThinkingLevel;
  label: string;
}> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "xHigh" },
  { value: "none", label: "None" },
];
const WATERFALL_ASPECT_RATIOS = ["1 / 1", "3 / 4", "4 / 3", "2 / 3"] as const;
const CHAT_SUGGESTIONS = [
  "A serene mountain lake at sunset, oil painting",
  "Minimalist logo for a tech startup",
  "Cyberpunk city street in the rain, neon lights",
  "Watercolor portrait of a cat wearing glasses",
] as const;
const CHAT_SUGGESTIONS_ZH = [
  "日落时宁静的山间湖泊，油画风格",
  "科技创业公司的极简标志",
  "雨夜霓虹灯下的赛博朋克城市街道",
  "戴眼镜的猫咪水彩肖像",
] as const;
const CHAT_STORAGE_KEY = "gpt2image_chat_messages_v1";
const CHAT_CONVERSATIONS_STORAGE_KEY = "gpt2image_chat_conversations_v1";
const CHAT_ACTIVE_CONVERSATION_STORAGE_KEY =
  "gpt2image_active_chat_conversation_v1";
const CHAT_CONTEXT_MESSAGE_LIMIT = 8;
const CHAT_CONVERSATION_LIMIT = 30;

const PRESET_LABELS_ZH: Record<string, string> = {
  "2K Square": "2K 方形",
  "2K Wide": "2K 宽屏",
  "4K Tall": "4K 竖屏",
  "4K Wide": "4K 宽屏",
  Landscape: "横向",
  Portrait: "纵向",
  Square: "方形",
};

interface CreatePageClientProps {
  balance: number;
  recentGenerations: RecentGeneration[];
  plan: SubscriptionPlan;
  uploadLimits: {
    maxFileSizeBytes: number;
    maxUploadBytes: number;
  };
}

function isImageFile(file: File) {
  return ["image/png", "image/jpeg", "image/webp"].includes(file.type);
}

function revokePreview(url: string) {
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function formatMegabytes(bytes: number) {
  return `${Math.ceil(bytes / 1024 / 1024)}MB`;
}

function imageStreamEventToPreviewUrl(event: ImageStreamEvent) {
  if (event.type !== "partial_image") return null;
  if (event.b64_json) return `data:image/png;base64,${event.b64_json}`;
  return event.url || null;
}

function createLocalId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneFile(file: File) {
  return new File([file], file.name, { type: file.type });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

function sanitizeChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const item = message as Partial<ChatMessage>;
    if (item.role !== "user" && item.role !== "assistant") return [];
    if (typeof item.text !== "string") return [];
    return [
      {
        id: typeof item.id === "string" ? item.id : createLocalId(),
        role: item.role,
        text: item.text,
        attachments: item.attachments,
        variants: item.variants,
        activeVariant: item.activeVariant,
        error: item.error,
        createdAt:
          typeof item.createdAt === "string"
            ? item.createdAt
            : new Date().toISOString(),
      },
    ];
  });
}

function sanitizePersistedChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-80).map((message) => ({
    ...message,
    attachments: message.attachments?.filter(
      (attachment) => !attachment.previewUrl.startsWith("blob:")
    ),
  }));
}

function createChatConversation(
  messages: ChatMessage[],
  title: string,
  id = createLocalId()
): ChatConversation {
  const now = new Date().toISOString();
  return {
    id,
    title,
    messages,
    createdAt: now,
    updatedAt: now,
  };
}

function sanitizeChatConversations(value: unknown): ChatConversation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((conversation) => {
    if (!conversation || typeof conversation !== "object") return [];
    const item = conversation as Partial<ChatConversation>;
    const messages = sanitizeChatMessages(item.messages);
    if (messages.length === 0) return [];
    const now = new Date().toISOString();
    return [
      {
        id: typeof item.id === "string" ? item.id : createLocalId(),
        title:
          typeof item.title === "string" && item.title.trim()
            ? item.title
            : "Untitled chat",
        messages,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now,
      },
    ];
  });
}

function getChatMessageSignature(message: ChatMessage) {
  return `${message.role}\u0000${message.id}\u0000${message.text}`;
}

function isConversationSnapshotOf(
  candidate: ChatConversation,
  target: ChatConversation
) {
  if (candidate.id === target.id) return true;
  if (candidate.messages.length > target.messages.length) return false;
  return candidate.messages.every(
    (message, index) =>
      getChatMessageSignature(message) ===
      getChatMessageSignature(target.messages[index] as ChatMessage)
  );
}

function compactChatConversations(conversations: ChatConversation[]) {
  const byCompleteness = [...conversations].sort((a, b) => {
    const messageCountDelta = b.messages.length - a.messages.length;
    if (messageCountDelta !== 0) return messageCountDelta;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  const compacted: ChatConversation[] = [];

  for (const conversation of byCompleteness) {
    if (
      compacted.some((existing) =>
        isConversationSnapshotOf(conversation, existing)
      )
    ) {
      continue;
    }
    compacted.push(conversation);
  }

  return compacted.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

function getChatConversationTitle(messages: ChatMessage[], fallback: string) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const title = firstUserMessage?.text.trim();
  if (!title) return fallback;
  return title.length > 48 ? `${title.slice(0, 48)}...` : title;
}

function getChatVariants(message: ChatMessage) {
  return message.variants || [];
}

function getActiveChatVariant(message: ChatMessage) {
  const variants = getChatVariants(message);
  return variants[message.activeVariant || 0] || variants[0] || null;
}

function getMessageImageUrls(message: ChatMessage) {
  return (message.attachments || [])
    .map((attachment) => attachment.previewUrl)
    .filter(
      (url) =>
        url.startsWith("data:image/") ||
        url.startsWith("http://") ||
        url.startsWith("https://")
    );
}

function toChatHistory(messages: ChatMessage[]) {
  return messages
    .filter(
      (message) =>
        message.role === "user" ||
        (message.role === "assistant" && message.variants?.length)
    )
    .slice(-CHAT_CONTEXT_MESSAGE_LIMIT)
    .map((message) => ({
      role: message.role,
      text: message.text,
      imageUrls: message.role === "user" ? getMessageImageUrls(message) : [],
      variants: message.variants?.map((variant) => ({
        text:
          variant.responseText ||
          variant.revisedPrompt ||
          (variant.imageUrl
            ? `Generated an image at ${variant.size}: ${variant.imageUrl}`
            : undefined),
        imageUrl: variant.imageUrl,
        size: variant.size,
        timestamp: variant.createdAt,
      })),
      activeVariant: message.activeVariant || 0,
      error: message.error,
    }));
}

async function urlToEditImageFile(
  imageUrl: string,
  name: string,
  sourceId?: string
): Promise<EditImageFile> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to load image: ${response.status}`);
  }

  const blob = await response.blob();
  const type = blob.type.startsWith("image/") ? blob.type : "image/png";
  const extension =
    type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
  const file = new File([blob], `${name}.${extension}`, { type });
  return {
    file,
    previewUrl: URL.createObjectURL(file),
    sourceId,
  };
}

export function CreatePageClient({
  balance: initialBalance,
  recentGenerations: initialRecent,
  plan,
  uploadLimits,
}: CreatePageClientProps) {
  const locale = useLocale();
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const imageCountLabel = (count: number) =>
    copy(`${count} image${count > 1 ? "s" : ""}`, `${count} 张图片`);
  const batchCostSuffix = (count: number) =>
    count > 1
      ? copy(` for ${count}`, `，共 ${count} 张`)
      : copy("/image", "/张");
  const presetLabel = (label: string) =>
    isZh ? PRESET_LABELS_ZH[label] || label : label;
  const editModelLabel = (label: string) =>
    label === "Default" ? copy("Default", "默认") : label;
  const textModelLabel = (label: string) =>
    label === "Default" ? copy("Default", "默认") : label;
  const qualityLabel = (qualityValue: ImageQuality) =>
    copy(
      QUALITY_OPTIONS.find((option) => option.value === qualityValue)?.label ||
        qualityValue,
      {
        auto: "自动",
        high: "高",
        low: "低",
        medium: "中",
      }[qualityValue]
    );
  const moderationLabel = (moderationValue: ImageModeration) =>
    copy(
      MODERATION_OPTIONS.find((option) => option.value === moderationValue)
        ?.label || moderationValue,
      {
        auto: "自动",
        low: "低",
      }[moderationValue]
    );
  const thinkingLabel = (value: ChatThinkingLevel) =>
    copy(
      CHAT_THINKING_OPTIONS.find((option) => option.value === value)?.label ||
        value,
      {
        high: "高",
        low: "低",
        medium: "中",
        none: "无",
        xhigh: "极高",
      }[value]
    );
  const helpMarker = (label: string, title: string) => (
    <span
      aria-label={title}
      className="inline-flex cursor-help items-center text-muted-foreground"
      role="img"
      title={title}
    >
      <CircleHelp className="h-3.5 w-3.5" />
      <span className="sr-only">{label}</span>
    </span>
  );
  const labelWithHelp = (label: string, title: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      {helpMarker(label, title)}
    </span>
  );
  const gptModelHelpText = copy(
    "Web backend: main ChatGPT conversation model; image model is sent separately. Codex/Responses backend: top-level Responses model. External image API may ignore this field.",
    "Web 后端：主 ChatGPT 对话模型，图片模型会单独传递；Codex/Responses 后端：顶层 Responses 模型；外接 image API 可能忽略此字段。"
  );
  const imageModelHelpText = copy(
    "Image model for generations/edits. Web backend maps it to force_paragen_model_slug; Codex/Responses uses it as the image_generation tool model; external image API receives it as the image model.",
    "生图/编辑图片模型。Web 后端会映射到 force_paragen_model_slug；Codex/Responses 会作为 image_generation 工具模型；外接 image API 会作为图片模型传递。"
  );
  const thinkingHelpText = copy(
    "Web backend uses this as paragen thinking level. If prompt optimization is off, Web thinking is forced to instant. Codex/Responses receives the selected effort when supported.",
    "Web 后端会作为 paragen 思考强度；关闭提示词优化时，Web 思考强度会强制为 instant；Codex/Responses 在支持时接收所选强度。"
  );
  const promptOptimizationHelpText = copy(
    "Turning this off is best effort: the platform sends the original prompt and uses instant on Web, but an upstream backend may still internally revise or interpret the prompt.",
    "关闭后是尽量少改动：平台会发送原始提示词，并让 Web 使用 instant；但上游后端仍可能在内部改写或理解提示词。"
  );
  const validationMessage = (message?: string) => {
    if (!message || !isZh) return message;
    if (message === "Use WIDTHxHEIGHT format.") {
      return "请使用 宽x高 格式。";
    }
    if (message.startsWith("Width and height must be between")) {
      return `宽和高必须在 256 到 ${MAX_IMAGE_DIMENSION}px 之间，并且能被 ${IMAGE_DIMENSION_STEP} 整除。`;
    }
    if (message.startsWith("Total pixels must be no more than")) {
      return "总像素不能超过 8,294,400。";
    }
    return message;
  };
  const chatAllowed = canUseChat(plan);
  const gpt55ChatAllowed = canUseGpt55Chat(plan);
  const promptOptimizationAllowed = canUsePromptOptimization(plan);
  const maxImageBytes =
    uploadLimits.maxFileSizeBytes || DEFAULT_MAX_IMAGE_BYTES;
  const maxEditRequestBytes =
    uploadLimits.maxUploadBytes || DEFAULT_MAX_EDIT_REQUEST_BYTES;
  const [activeMode, setActiveMode] = useState<ActiveMode>("text");
  const [prompt, setPrompt] = useState("");
  const [textMode, setTextMode] = useState<TextGenerationMode>("single");
  const [linePrompts, setLinePrompts] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [promptOptimization, setPromptOptimization] = useState(true);
  const [chatPrompt, setChatPrompt] = useState("");
  const [chatConversationId, setChatConversationId] = useState(() =>
    createLocalId()
  );
  const [chatConversations, setChatConversations] = useState<
    ChatConversation[]
  >([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [chatViewMode, setChatViewMode] = useState<ChatViewMode>("chat");
  const [chatStream, setChatStream] = useState<ChatStreamState | null>(null);
  const [retryingChatMessageId, setRetryingChatMessageId] = useState<
    string | null
  >(null);
  const [batchCards, setBatchCards] = useState<BatchCard[]>([]);
  const [batchPrompt, setBatchPrompt] = useState("");
  const [isBatchActive, setIsBatchActive] = useState(false);
  const [isBatchLoadingMore, setIsBatchLoadingMore] = useState(false);
  const [waterfallCreditsConsumed, setWaterfallCreditsConsumed] = useState(0);
  const [chatModel, setChatModel] = useState<ChatModel>(GPT54_CHAT_MODEL);
  const [chatThinking, setChatThinking] = useState<ChatThinkingLevel>("low");
  const [imageGptModel, setImageGptModel] = useState<ChatModel | "default">(
    "default"
  );
  const [imageThinking, setImageThinking] =
    useState<ChatThinkingLevel>("low");
  const [chatImageModel, setChatImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [chatFirstImageSize, setChatFirstImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [isChatGenerating, setIsChatGenerating] = useState(false);
  const [width, setWidth] = useState(defaultDimensions.width);
  const [height, setHeight] = useState(defaultDimensions.height);
  const [quality, setQuality] = useState<ImageQuality>("auto");
  const [moderation, setModeration] = useState<ImageModeration>("auto");
  const [batchCount, setBatchCount] = useState(1);
  const [lineBatchRepeatCount, setLineBatchRepeatCount] = useState(1);
  const [editBatchCount, setEditBatchCount] = useState(1);
  const [textModel, setTextModel] = useState("default");
  const [editModel, setEditModel] = useState("default");
  const [useFirstImageSize, setUseFirstImageSize] = useState(true);
  const [chatCustomResolutionOpen, setChatCustomResolutionOpen] =
    useState(false);
  const [editWidth, setEditWidth] = useState(defaultDimensions.width);
  const [editHeight, setEditHeight] = useState(defaultDimensions.height);
  const [editImages, setEditImages] = useState<EditImageFile[]>([]);
  const [maskFile, setMaskFile] = useState<EditImageFile | null>(null);
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const [maskPoints, setMaskPoints] = useState<MaskPoint[]>([]);
  const [maskBrushSize, setMaskBrushSize] = useState(32);
  const [firstImageSize, setFirstImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingPreviewUrl, setStreamingPreviewUrl] = useState<string | null>(
    null
  );
  const [balance, setBalance] = useState(initialBalance);
  const [result, setResult] = useState<ResultState | null>(null);
  const [recent, setRecent] = useState<RecentGeneration[]>(initialRecent);
  const [selectedRecentId, setSelectedRecentId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const chatImageInputRef = useRef<HTMLInputElement | null>(null);
  const batchImageInputRef = useRef<HTMLInputElement | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const chatConversationsRef = useRef<ChatConversation[]>([]);
  const didLoadChatRef = useRef(false);
  const batchLoadTriggerRef = useRef<HTMLDivElement | null>(null);
  const batchScrollRef = useRef<HTMLDivElement | null>(null);
  const batchActiveRequestsRef = useRef(0);
  const batchPromptRef = useRef("");
  const batchSizeRef = useRef(DEFAULT_IMAGE_SIZE);
  const batchLoadingMoreRef = useRef(false);
  const triggerBatchGenerationRef = useRef<
    ((options?: { retryCardId?: string }) => Promise<void>) | null
  >(null);
  const maskInputRef = useRef<HTMLInputElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastMaskPointRef = useRef<{ x: number; y: number } | null>(null);

  const size = useMemo(
    () => normalizeImageSize(width, height),
    [width, height]
  );
  const textImageCreditCost = useMemo(() => getImageCreditCost(size), [size]);
  const textBatchCreditCost = textImageCreditCost * batchCount;
  const linePromptItems = useMemo(
    () =>
      linePrompts
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    [linePrompts]
  );
  const lineBatchTotalCount = linePromptItems.length * lineBatchRepeatCount;
  const lineBatchCreditCost = textImageCreditCost * lineBatchTotalCount;
  const customEditSize = useMemo(
    () => normalizeImageSize(editWidth, editHeight),
    [editWidth, editHeight]
  );
  const effectiveEditSize = useMemo(() => {
    if (useFirstImageSize) {
      return firstImageSize
        ? normalizeImageSize(firstImageSize.width, firstImageSize.height)
        : null;
    }
    return customEditSize;
  }, [customEditSize, firstImageSize, useFirstImageSize]);
  const chatEffectiveEditSize = useMemo(() => {
    if (useFirstImageSize) {
      return chatFirstImageSize
        ? normalizeImageSize(
            chatFirstImageSize.width,
            chatFirstImageSize.height
          )
        : null;
    }
    return customEditSize;
  }, [chatFirstImageSize, customEditSize, useFirstImageSize]);
  const editImageCreditCost = effectiveEditSize
    ? getImageCreditCost(effectiveEditSize, {
        imageModerationCount: editImages.length,
      })
    : getImageCreditCost();
  const editBatchCreditCost = editImageCreditCost * editBatchCount;
  const chatEditImageCreditCost = chatEffectiveEditSize
    ? getImageCreditCost(chatEffectiveEditSize, {
        imageModerationCount: chatAttachments.length,
      })
    : getImageCreditCost();
  const chatSingleCreditCost =
    chatAttachments.length > 0 ? chatEditImageCreditCost : CHAT_TEXT_ONLY_CREDITS;
  const batchFallbackSize =
    chatAttachments.length > 0 && chatEffectiveEditSize
      ? chatEffectiveEditSize
      : size;
  const batchSingleCreditCost = getImageCreditCost(batchFallbackSize, {
    imageModerationCount: chatAttachments.length,
  });
  const formattedBalance = formatCredits(balance);
  const formattedTextBatchCreditCost = formatCredits(textBatchCreditCost);
  const formattedLineBatchCreditCost = formatCredits(lineBatchCreditCost);
  const formattedEditBatchCreditCost = formatCredits(editBatchCreditCost);
  const formattedChatSingleCreditCost = formatCredits(chatSingleCreditCost);
  const formattedBatchSingleCreditCost = formatCredits(batchSingleCreditCost);
  const formattedWaterfallCreditsConsumed = formatCredits(
    waterfallCreditsConsumed
  );
  const sizeCheck = useMemo(() => validateImageSize(size), [size]);
  const customEditSizeCheck = useMemo(
    () => validateImageSize(customEditSize),
    [customEditSize]
  );
  const chatSizeCheck = useMemo(
    () =>
      chatAttachments.length > 0 && !useFirstImageSize
        ? customEditSizeCheck
        : sizeCheck,
    [chatAttachments.length, customEditSizeCheck, sizeCheck, useFirstImageSize]
  );
  const busy = isGenerating || isEditing || isChatGenerating;
  const firstPreviewUrl = editImages[0]?.previewUrl || null;
  const chatFirstPreviewUrl = chatAttachments[0]?.previewUrl || null;
  const editDisplaySize = effectiveEditSize || copy("Reference image", "参考图片");
  const loadingSize =
    activeMode === "image" && effectiveEditSize
      ? effectiveEditSize
      : activeMode === "chat" &&
          chatAttachments.length > 0 &&
          chatEffectiveEditSize
        ? chatEffectiveEditSize
        : size;
  const loadingDimensions = parseImageSize(loadingSize) || {
    width,
    height,
  };
  const chatSuggestions = isZh ? CHAT_SUGGESTIONS_ZH : CHAT_SUGGESTIONS;
  const promptOptimizationField = (id: string, disabled = false) => (
    <label
      htmlFor={id}
      className={`flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm ${
        promptOptimizationAllowed
          ? "cursor-pointer text-foreground"
          : "cursor-not-allowed text-muted-foreground"
      }`}
    >
      <Checkbox
        id={id}
        checked={promptOptimizationAllowed ? promptOptimization : true}
        onCheckedChange={(checked) => setPromptOptimization(checked === true)}
        disabled={disabled || !promptOptimizationAllowed}
        className="mt-0.5"
      />
      <span>
        {labelWithHelp(
          copy("Prompt optimization", "提示词优化"),
          promptOptimizationHelpText
        )}
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          {promptOptimizationAllowed
            ? copy(
                "Turn this off to minimize prompt changes. Some backends may still interpret or revise the prompt internally.",
                "关闭后将尽量减少对提示词的改动，但部分后端仍可能在内部理解或优化提示词。"
              )
            : copy(
                "Pro plan or higher can reduce prompt changes.",
                "专业版或更高套餐可尽量减少提示词改动。"
              )}
        </span>
      </span>
    </label>
  );

  const renderGptModelSelect = (params: {
    id: string;
    value: ChatModel | "default";
    onChange: (value: ChatModel | "default") => void;
    disabled?: boolean;
    compact?: boolean;
    allowDefault?: boolean;
  }) => {
    const control = (
      <Select
        value={params.value}
        onValueChange={(value) =>
          params.onChange(value as ChatModel | "default")
        }
        disabled={params.disabled}
      >
        <SelectTrigger
          id={params.id}
          className={params.compact ? "h-8 w-[136px]" : "w-full"}
          title={gptModelHelpText}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {params.allowDefault && (
            <SelectItem value="default">
              {copy("Backend default", "后端默认")}
            </SelectItem>
          )}
          {CHAT_MODEL_OPTIONS.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.ultraOnly && !gpt55ChatAllowed}
            >
              {option.label}
              {option.ultraOnly && !gpt55ChatAllowed
                ? ` · ${copy("Ultra", "Ultra")}`
                : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );

    return control;
  };

  const renderThinkingSelect = (params: {
    id: string;
    value: ChatThinkingLevel;
    onChange: (value: ChatThinkingLevel) => void;
    disabled?: boolean;
    compact?: boolean;
  }) => {
    const control = (
      <Select
        value={params.value}
        onValueChange={(value) => params.onChange(value as ChatThinkingLevel)}
        disabled={params.disabled}
      >
        <SelectTrigger
          id={params.id}
          className={params.compact ? "h-8 w-[138px]" : "w-full"}
          title={thinkingHelpText}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CHAT_THINKING_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {copy("Thinking", "思考")} {thinkingLabel(option.value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );

    return control;
  };

  const clearStreamingPreview = () => {
    setStreamingPreviewUrl(null);
  };

  const resetChatConversation = () => {
    setChatMessages([]);
    setChatStream(null);
    setRetryingChatMessageId(null);
    clearStreamingPreview();
    window.localStorage.removeItem(CHAT_STORAGE_KEY);
  };

  const handleNewChat = () => {
    if (isChatGenerating) return;
    resetChatConversation();
    const nextId = createLocalId();
    setChatConversationId(nextId);
    window.localStorage.setItem(CHAT_ACTIVE_CONVERSATION_STORAGE_KEY, nextId);
    setChatPrompt("");
    clearChatAttachments();
    toast.success(copy("New chat started", "已新建对话"));
  };

  const handleClearChatHistory = () => {
    if (isChatGenerating) return;
    const nextConversations = chatConversations.filter(
      (conversation) => conversation.id !== chatConversationId
    );
    chatConversationsRef.current = nextConversations;
    setChatConversations(nextConversations);
    window.localStorage.setItem(
      CHAT_CONVERSATIONS_STORAGE_KEY,
      JSON.stringify(nextConversations)
    );
    resetChatConversation();
    const nextId = createLocalId();
    setChatConversationId(nextId);
    window.localStorage.setItem(CHAT_ACTIVE_CONVERSATION_STORAGE_KEY, nextId);
    setChatPrompt("");
    toast.success(copy("Chat history cleared", "对话记录已清理"));
  };

  const handleOpenChatConversation = (conversation: ChatConversation) => {
    if (isChatGenerating) return;
    setChatConversationId(conversation.id);
    window.localStorage.setItem(
      CHAT_ACTIVE_CONVERSATION_STORAGE_KEY,
      conversation.id
    );
    setChatMessages(conversation.messages);
    setChatStream(null);
    setRetryingChatMessageId(null);
    clearStreamingPreview();
    setChatPrompt("");
    clearChatAttachments();
    scrollChatToBottom();
  };

  const scrollChatToBottom = () => {
    requestAnimationFrame(() => {
      const element = chatMessagesRef.current;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  };

  const readImageStreamResponse = async (response: Response) => {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      return (await response.json()) as ImageApiResult;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { error: "API returned an empty stream" };
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const completed: ImageApiResult[] = [];
    let failed: ImageApiResult | null = null;

    const processBlock = (block: string) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();

      if (!data || data === "[DONE]") return;

      let event: ImageStreamEvent;
      try {
        event = JSON.parse(data) as ImageStreamEvent;
      } catch {
        return;
      }

      if (event.type === "partial_image") {
        const previewUrl = imageStreamEventToPreviewUrl(event);
        if (previewUrl) setStreamingPreviewUrl(previewUrl);
        return;
      }

      if (event.type === "text_delta" || event.type === "thinking_delta") {
        return;
      }

      if (event.type === "completed") {
        completed.push(event);
        return;
      }

      if (event.type === "error") {
        failed = event;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        processBlock(block);
      }
      if (done) break;
    }

    if (buffer.trim()) {
      processBlock(buffer);
    }

    if (completed.length === 1) {
      return completed[0] as ImageApiResult;
    }

    if (completed.length > 1) {
      return { results: completed };
    }

    return failed || { error: "API returned no image data" };
  };

  const runChatRequest = async ({
    prompt,
    attachments = [],
    fallbackSize,
    historyMessages,
    streamMessageId,
    streamCardId,
  }: {
    prompt: string;
    attachments?: ChatAttachment[];
    fallbackSize: string;
    historyMessages: ChatMessage[];
    streamMessageId?: string;
    streamCardId?: string;
  }) => {
    const formData = new FormData();
    formData.append("prompt", prompt);
    formData.append("history", JSON.stringify(toChatHistory(historyMessages)));
    formData.append("quality", quality);
    formData.append("moderation", moderation);
    formData.append("model", chatModel);
    formData.append("imageModel", chatImageModel);
    formData.append("thinking", chatThinking);
    formData.append("size", fallbackSize);
    formData.append("count", "1");
    formData.append("stream", "true");
    if (promptOptimizationAllowed) {
      formData.append("prompt_optimization", String(promptOptimization));
    }
    attachments.forEach(({ file }) => {
      formData.append(attachments.length === 1 ? "image" : "image[]", file);
    });

    const response = await fetch("/api/images/chat", {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
      },
      body: formData,
    });

    const createRequestError = (message: string, creditsConsumed?: number) => {
      const error = new Error(message) as GenerationRequestError;
      if (creditsConsumed !== undefined) {
        error.creditsConsumed = creditsConsumed;
      }
      return error;
    };

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      const data = (await response.json()) as ImageApiResult;
      if (!response.ok || data.error) {
        throw createRequestError(
          data.error || `API error: ${response.status}`,
          data.creditsConsumed
        );
      }
      return data;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("API returned an empty stream");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let failed: ImageApiResult | null = null;
    let completed: ImageApiResult | undefined;
    let text = "";
    let thinking = "";
    let previewUrl: string | undefined;

    const processBlock = (block: string) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();

      if (!data || data === "[DONE]") return;

      let event: ImageStreamEvent;
      try {
        event = JSON.parse(data) as ImageStreamEvent;
      } catch {
        return;
      }

      if (event.type === "text_delta") {
        text += event.delta;
        setChatStream({
          messageId: streamMessageId,
          cardId: streamCardId,
          text,
          thinking,
          imageUrl: previewUrl,
        });
        if (streamCardId) {
          setBatchCards((prev) =>
            prev.map((card) =>
              card.id === streamCardId &&
              (card.state === "loading" || card.state === "text")
                ? { ...card, state: "text", streamText: text }
                : card
            )
          );
        }
        return;
      }

      if (event.type === "thinking_delta") {
        thinking += event.delta;
        setChatStream({
          messageId: streamMessageId,
          cardId: streamCardId,
          text,
          thinking,
          imageUrl: previewUrl,
        });
        if (streamCardId) {
          setBatchCards((prev) =>
            prev.map((card) =>
              card.id === streamCardId &&
              (card.state === "loading" || card.state === "text")
                ? { ...card, streamThinking: thinking }
                : card
            )
          );
        }
        return;
      }

      if (event.type === "partial_image") {
        const nextPreviewUrl = imageStreamEventToPreviewUrl(event);
        if (nextPreviewUrl) {
          previewUrl = nextPreviewUrl;
          setStreamingPreviewUrl(nextPreviewUrl);
          setChatStream({
            messageId: streamMessageId,
            cardId: streamCardId,
            text,
            thinking,
            imageUrl: nextPreviewUrl,
          });
          if (streamCardId) {
            setBatchCards((prev) =>
              prev.map((card) =>
                card.id === streamCardId && card.state === "loading"
                  ? { ...card, imageUrl: nextPreviewUrl }
                  : card
              )
            );
          }
        }
        return;
      }

      if (event.type === "completed") {
        completed = event;
        return;
      }

      if (event.type === "error") {
        failed = event;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        processBlock(block);
      }
      if (done) break;
    }

    if (buffer.trim()) processBlock(buffer);

    const failedResult = failed as ImageApiResult | null;
    if (!response.ok || failedResult) {
      throw createRequestError(
        failedResult?.error || `API error: ${response.status}`,
        failedResult?.creditsConsumed
      );
    }

    if (!completed) {
      throw new Error("API returned no image data");
    }

    return {
      ...completed,
      responseText: completed.responseText || text || undefined,
      responseThinking: completed.responseThinking || thinking || undefined,
    };
  };

  useEffect(() => {
    try {
      const conversationRaw = window.localStorage.getItem(
        CHAT_CONVERSATIONS_STORAGE_KEY
      );
      const conversations = compactChatConversations(
        sanitizeChatConversations(
          conversationRaw ? JSON.parse(conversationRaw) : []
        )
      );

      const legacyRaw = window.localStorage.getItem(CHAT_STORAGE_KEY);
      const legacyMessages = sanitizeChatMessages(
        legacyRaw ? JSON.parse(legacyRaw) : []
      );
      const hasLegacyConversation =
        legacyMessages.length > 0 &&
        !conversations.some(
          (conversation) =>
            JSON.stringify(conversation.messages) ===
            JSON.stringify(legacyMessages)
        );
      const nextConversations = compactChatConversations(
        hasLegacyConversation
          ? [
              createChatConversation(
                legacyMessages,
                getChatConversationTitle(
                  legacyMessages,
                  isZh ? "历史对话" : "Previous chat"
                )
              ),
              ...conversations,
            ]
          : conversations
      );

      if (nextConversations.length > 0) {
        const sortedConversations = nextConversations
          .sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )
          .slice(0, CHAT_CONVERSATION_LIMIT);
        const activeConversationId = window.localStorage.getItem(
          CHAT_ACTIVE_CONVERSATION_STORAGE_KEY
        );
        const activeConversation =
          sortedConversations.find(
            (conversation) => conversation.id === activeConversationId
          ) || sortedConversations[0];
        chatConversationsRef.current = sortedConversations;
        setChatConversations(sortedConversations);
        setChatConversationId(activeConversation?.id || createLocalId());
        setChatMessages(activeConversation?.messages || []);
        if (activeConversation) {
          window.localStorage.setItem(
            CHAT_ACTIVE_CONVERSATION_STORAGE_KEY,
            activeConversation.id
          );
        }
      }
      window.localStorage.setItem(
        CHAT_CONVERSATIONS_STORAGE_KEY,
        JSON.stringify(nextConversations.slice(0, CHAT_CONVERSATION_LIMIT))
      );
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
      window.localStorage.removeItem(CHAT_CONVERSATIONS_STORAGE_KEY);
      window.localStorage.removeItem(CHAT_ACTIVE_CONVERSATION_STORAGE_KEY);
    } finally {
      didLoadChatRef.current = true;
    }
  }, [isZh]);

  useEffect(() => {
    if (!didLoadChatRef.current) return;
    try {
      if (chatMessages.length === 0) {
        window.localStorage.removeItem(CHAT_STORAGE_KEY);
        return;
      }
      const persistedMessages = sanitizePersistedChatMessages(chatMessages);
      const title = getChatConversationTitle(
        persistedMessages,
        isZh ? "未命名对话" : "Untitled chat"
      );
      const now = new Date().toISOString();
      const previousConversations = chatConversationsRef.current;
      const existing = previousConversations.find(
        (conversation) => conversation.id === chatConversationId
      );
      const current: ChatConversation = {
        id: chatConversationId,
        title,
        messages: persistedMessages,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      const nextConversations = compactChatConversations([
        current,
        ...previousConversations.filter(
          (conversation) => conversation.id !== chatConversationId
        ),
      ]).slice(0, CHAT_CONVERSATION_LIMIT);
      chatConversationsRef.current = nextConversations;
      setChatConversations(nextConversations);
      window.localStorage.setItem(
        CHAT_CONVERSATIONS_STORAGE_KEY,
        JSON.stringify(nextConversations)
      );
      window.localStorage.setItem(
        CHAT_ACTIVE_CONVERSATION_STORAGE_KEY,
        chatConversationId
      );
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      /* ignore local storage quota errors */
    }
  }, [chatConversationId, chatMessages, isZh]);

  useEffect(() => {
    if (!gpt55ChatAllowed && chatModel === GPT55_CHAT_MODEL) {
      setChatModel(GPT54_CHAT_MODEL);
    }
    if (!gpt55ChatAllowed && imageGptModel === GPT55_CHAT_MODEL) {
      setImageGptModel("default");
    }
  }, [chatModel, gpt55ChatAllowed, imageGptModel]);

  useEffect(() => {
    if (!firstPreviewUrl) {
      setFirstImageSize(null);
      setMaskEditorOpen(false);
      setMaskPoints([]);
      setMaskFile((prev) => {
        if (prev) revokePreview(prev.previewUrl);
        return null;
      });
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      const nextImageSize = {
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      };
      setFirstImageSize(nextImageSize);
      setMaskPoints([]);
      setMaskFile((prev) => {
        if (prev) revokePreview(prev.previewUrl);
        return null;
      });
    };
    img.onerror = () => {
      setFirstImageSize(null);
      setMaskEditorOpen(false);
    };
    img.src = firstPreviewUrl;
  }, [firstPreviewUrl]);

  useEffect(() => {
    if (!chatFirstPreviewUrl) {
      setChatFirstImageSize(null);
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      setChatFirstImageSize({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      });
    };
    img.onerror = () => {
      setChatFirstImageSize(null);
    };
    img.src = chatFirstPreviewUrl;
  }, [chatFirstPreviewUrl]);

  useEffect(() => {
    if (!useFirstImageSize || !firstImageSize) return;
    setEditWidth(firstImageSize.width);
    setEditHeight(firstImageSize.height);
  }, [firstImageSize, useFirstImageSize]);

  useEffect(() => {
    if (!useFirstImageSize || !chatFirstImageSize) return;
    setEditWidth(chatFirstImageSize.width);
    setEditHeight(chatFirstImageSize.height);
  }, [chatFirstImageSize, useFirstImageSize]);

  useEffect(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !firstImageSize) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(220, 38, 38, 0.46)";
    for (const point of maskPoints) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [maskPoints, firstImageSize]);

  const addSuccessfulResult = (
    data: {
      generationId?: string;
      imageUrl?: string;
      model?: string;
      size?: string;
      revisedPrompt?: string;
      responseText?: string;
      responseThinking?: string;
      creditsConsumed?: number;
    },
    resultPrompt: string,
    fallbackSize = size
  ): ChatVariant | null => {
    const model = data.model || DEFAULT_IMAGE_MODEL;
    const resultSize = data.size || fallbackSize;
    if (!data.imageUrl && !data.responseText) return null;

    if (data.imageUrl && data.generationId) {
      const nextResult: ResultState = {
        generationId: data.generationId,
        imageUrl: data.imageUrl,
        prompt: resultPrompt,
        model,
        size: resultSize,
      };
      if (data.revisedPrompt) nextResult.revisedPrompt = data.revisedPrompt;
      setResult(nextResult);
    }
    setBalance(
      (b) =>
        Math.round(Math.max(0, b - (data.creditsConsumed || 0)) * 100) / 100
    );
    if (data.imageUrl && data.generationId) {
      const generationId = data.generationId;
      setRecent((prev) => [
        {
          id: generationId,
          prompt: resultPrompt,
          revisedPrompt: data.revisedPrompt || null,
          model,
          size: resultSize,
          creditsConsumed: data.creditsConsumed || 0,
          status: "completed",
          imageUrl: data.imageUrl || null,
          createdAt: new Date().toISOString(),
        },
        ...prev.slice(0, 5),
      ]);
    }

    return {
      generationId: data.generationId,
      imageUrl: data.imageUrl,
      prompt: resultPrompt,
      model,
      size: resultSize,
      revisedPrompt: data.revisedPrompt,
      responseText: data.responseText,
      responseThinking: data.responseThinking,
      creditsConsumed: data.creditsConsumed,
      createdAt: new Date().toISOString(),
    };
  };

  const addSuccessfulResults = (
    data: ImageApiResult,
    resultPrompt: string,
    fallbackSize = size
  ) => {
    const successfulResults =
      data.results?.filter((item) => item.imageUrl && item.generationId) ||
      (data.imageUrl && data.generationId ? [data] : []);

    if (successfulResults.length === 0) return [];

    const variants: ChatVariant[] = [];
    for (const item of successfulResults.toReversed()) {
      const variant = addSuccessfulResult(item, resultPrompt, fallbackSize);
      if (variant) {
        variants.unshift(variant);
      }
    }

    return variants;
  };

  const syncChargedCredits = (creditsConsumed?: number) => {
    if (!creditsConsumed || creditsConsumed <= 0) return;
    setBalance(
      (b) => Math.round(Math.max(0, b - creditsConsumed) * 100) / 100
    );
  };

  const syncWaterfallCredits = (creditsConsumed?: number) => {
    if (!creditsConsumed || creditsConsumed <= 0) return;
    setWaterfallCreditsConsumed(
      (value) => Math.round((value + creditsConsumed) * 100) / 100
    );
  };

  const showGenerationError = (
    message: string,
    options?: { creditsConsumed?: number }
  ) => {
    syncChargedCredits(options?.creditsConsumed);

    if (message.toLowerCase().includes("insufficient credits")) {
      toast.error(copy("Insufficient credits", "积分不足"), {
        description: copy(
          "You don't have enough credits to generate an image.",
          "当前积分不足，无法生成图片。"
        ),
        action: {
          label: copy("Top up", "去充值"),
          onClick: () => {
            window.location.href = `/${locale}/dashboard/credits/buy`;
          },
        },
      });
      return;
    }

    toast.error(copy("Generation failed", "生成失败"), { description: message });
  };

  const addChatAttachments = async (files: FileList | File[] | null) => {
    const imageFiles = Array.from(files || []);
    if (!imageFiles.length) return;

    const accepted: ChatAttachment[] = [];
    for (const file of imageFiles) {
      if (!isImageFile(file)) {
        toast.error(copy("Unsupported file type", "不支持的文件类型"), {
          description: copy(
            "Use PNG, JPEG, or WebP images.",
            "请使用 PNG、JPEG 或 WebP 图片。"
          ),
        });
        continue;
      }
      if (file.size > maxImageBytes) {
        toast.error(copy("File too large", "文件过大"), {
          description: copy(
            `${file.name} exceeds ${formatMegabytes(maxImageBytes)}.`,
            `${file.name} 超过 ${formatMegabytes(maxImageBytes)}。`
          ),
        });
        continue;
      }
      try {
        accepted.push({ file, previewUrl: await readFileAsDataUrl(file) });
      } catch {
        toast.error(copy("Failed to load image", "图片加载失败"), {
          description:
            file.name ||
            copy(
              "Could not read the selected file.",
              "无法读取所选文件。"
            ),
        });
      }
    }

    if (!accepted.length) return;

    setChatAttachments((prev) => {
      const slots = MAX_EDIT_IMAGES - prev.length;
      if (slots <= 0) {
        for (const item of accepted) {
          revokePreview(item.previewUrl);
        }
        toast.error(
          copy(
            `Attach up to ${MAX_EDIT_IMAGES} reference images`,
            `最多可添加 ${MAX_EDIT_IMAGES} 张参考图片`
          )
        );
        return prev;
      }

      const next = accepted.slice(0, slots);
      for (const item of accepted.slice(slots)) {
        revokePreview(item.previewUrl);
      }
      if (accepted.length > slots) {
        toast.error(
          copy(
            `Only ${slots} more reference image(s) can be added`,
            `还可以再添加 ${slots} 张参考图片`
          )
        );
      }
      return [...prev, ...next];
    });
  };

  const removeChatAttachment = (index: number) => {
    setChatAttachments((prev) => {
      const target = prev[index];
      if (target) revokePreview(target.previewUrl);
      return prev.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const clearChatAttachments = () => {
    setChatAttachments((prev) => {
      for (const item of prev) {
        revokePreview(item.previewUrl);
      }
      return [];
    });
  };

  const attachImageUrlToChat = async (
    imageUrl: string,
    name: string,
    sourceId?: string
  ) => {
    if (chatAttachments.some((item) => item.sourceId === sourceId)) {
      toast.success(copy("Reference image is already attached", "参考图片已添加"));
      return;
    }
    if (chatAttachments.length >= MAX_EDIT_IMAGES) {
      toast.error(
        copy(
          `Attach up to ${MAX_EDIT_IMAGES} reference images`,
          `最多可添加 ${MAX_EDIT_IMAGES} 张参考图片`
        )
      );
      return;
    }

    try {
      const item = await urlToEditImageFile(imageUrl, name, sourceId);
      setChatAttachments((prev) => [...prev, item]);
      setActiveMode("chat");
      toast.success(copy("Reference image attached to chat", "参考图片已添加到对话"));
    } catch (error) {
      toast.error(copy("Failed to attach image", "添加图片失败"), {
        description:
          error instanceof Error
            ? error.message
            : copy("Could not load image.", "无法加载图片。"),
      });
    }
  };

  const attachResultToChat = async (variant?: ChatVariant) => {
    const imageUrl = variant?.imageUrl || result?.imageUrl;
    const id = variant?.generationId || result?.generationId;
    if (!imageUrl || !id) return;
    await attachImageUrlToChat(imageUrl, `gpt2image-${id}`, id);
  };

  const findPrecedingUserMessage = (assistantIndex: number) => {
    for (let index = assistantIndex - 1; index >= 0; index--) {
      const message = chatMessages[index];
      if (message?.role === "user") return message;
    }
    return null;
  };

  const handleChatVariantChange = (messageId: string, direction: -1 | 1) => {
    setChatMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId) return message;
        const variants = getChatVariants(message);
        const current = message.activeVariant || 0;
        return {
          ...message,
          activeVariant: Math.max(
            0,
            Math.min(variants.length - 1, current + direction)
          ),
        };
      })
    );
  };

  const handleChatRetry = async (assistantId: string) => {
    if (isChatGenerating) return;

    const assistantIndex = chatMessages.findIndex(
      (message) => message.id === assistantId
    );
    if (assistantIndex < 0) return;
    const userMessage = findPrecedingUserMessage(assistantIndex);
    if (!userMessage?.text) return;

    const assistantMessage = chatMessages[assistantIndex];
    if (!assistantMessage) return;
    const activeVariant = getActiveChatVariant(assistantMessage);
    const retrySize = activeVariant?.size || size;
    const historyMessages = chatMessages.slice(0, assistantIndex);

    setRetryingChatMessageId(assistantId);
    setIsChatGenerating(true);
    setChatStream({
      messageId: assistantId,
      text: "",
      thinking: "",
    });

    try {
      const data = await runChatRequest({
        prompt: userMessage.text,
        fallbackSize: retrySize,
        historyMessages,
        streamMessageId: assistantId,
      });
      const variant = addSuccessfulResult(data, userMessage.text, retrySize);
      if (!variant) {
        throw new Error(copy("API returned no image data", "接口未返回图片数据"));
      }

      setChatMessages((prev) =>
        prev.map((message) => {
          if (message.id !== assistantId) return message;
          const variants = [...getChatVariants(message), variant];
          return {
            ...message,
            error: undefined,
            text:
              variant.responseText ||
              (variant.imageUrl
                ? copy("Image generated", "图片已生成")
                : copy("Response generated", "回复已生成")),
            variants,
            activeVariant: variants.length - 1,
          };
        })
      );
      toast.success(copy("Variant generated", "新版本已生成"));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : copy("Retry failed.", "重试失败。");
      const creditsConsumed =
        error instanceof Error
          ? (error as GenerationRequestError).creditsConsumed
          : undefined;
      syncChargedCredits(creditsConsumed);
      toast.error(copy("Retry failed", "重试失败"), { description: message });
    } finally {
      setRetryingChatMessageId(null);
      setIsChatGenerating(false);
      setChatStream(null);
      clearStreamingPreview();
      scrollChatToBottom();
    }
  };

  const saveBatchCardToRecent = (card: BatchCard) => {
    if (!card.imageUrl || !card.generationId) return;

    setRecent((prev) => {
      if (prev.some((item) => item.id === card.generationId)) return prev;
      return [
        {
          id: card.generationId || createLocalId(),
          prompt: card.prompt,
          revisedPrompt: null,
          model: card.model || DEFAULT_IMAGE_MODEL,
          size: card.size,
          creditsConsumed: 0,
          status: "completed",
          imageUrl: card.imageUrl || null,
          createdAt: new Date().toISOString(),
        },
        ...prev.slice(0, 5),
      ];
    });
    setBatchCards((prev) =>
      prev.map((item) =>
        item.id === card.id ? { ...item, saved: true } : item
      )
    );
    toast.success(copy("Saved to recent", "已保存到最近生成"));
  };

  const handleBatchSuggestion = (suggestion: string) => {
    setBatchPrompt(suggestion);
  };

  const renderThinkingBlock = (thinking?: string, open = false) => {
    if (!thinking) return null;
    return (
      <details
        className="mb-3 rounded-md border border-border bg-background/70 p-2"
        open={open}
      >
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          {copy("Thinking", "思考过程")}
        </summary>
        <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
          {thinking}
        </p>
      </details>
    );
  };

  const renderChatStreamBubble = (messageId?: string) => {
    if (!chatStream || chatStream.messageId !== messageId) return null;
    return (
      <div className="rounded-lg border border-border bg-muted/35 px-3 py-3 text-sm text-foreground">
        {renderThinkingBlock(chatStream.thinking, true)}
        {chatStream.text && (
          <p className="whitespace-pre-wrap break-words leading-relaxed">
            {chatStream.text}
          </p>
        )}
        {chatStream.imageUrl && (
          <div className="relative mt-3 max-w-sm overflow-hidden rounded-md border bg-muted">
            <Image
              src={chatStream.imageUrl}
              alt={copy("Streaming preview", "流式预览")}
              width={320}
              height={320}
              className="h-auto w-full object-contain"
              unoptimized={!shouldOptimizeStoredImage(chatStream.imageUrl)}
            />
          </div>
        )}
        {!chatStream.text && !chatStream.imageUrl && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {copy("Generating...", "生成中...")}
          </div>
        )}
      </div>
    );
  };

  const renderChatInput = () => {
    const isEditChat = chatAttachments.length > 0;
    const activeChatSize =
      isEditChat && useFirstImageSize
        ? chatEffectiveEditSize || copy("Reference image", "参考图片")
        : isEditChat
          ? customEditSize
          : size;
    const selectedChatPreset =
      isEditChat && useFirstImageSize && chatEffectiveEditSize
        ? "reference"
        : typeof activeChatSize === "string" &&
            IMAGE_RESOLUTION_PRESETS.some(
              (preset) => preset.value === activeChatSize
            )
          ? activeChatSize
          : "custom";

    const applyChatPreset = (value: string) => {
      if (value === "reference") {
        setUseFirstImageSize(true);
        setChatCustomResolutionOpen(false);
        return;
      }

      if (value === "custom") {
        setChatCustomResolutionOpen(true);
        if (isEditChat) setUseFirstImageSize(false);
        return;
      }

      if (isEditChat) {
        applyEditPreset(value);
      } else {
        applyPreset(value);
      }
      setChatCustomResolutionOpen(false);
    };

    return (
      <form
        onSubmit={handleChatSubmit}
        onPaste={handleChatPaste}
        className="border-t border-border p-3"
      >
        {chatAttachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {chatAttachments.map((item, index) => (
              <button
                type="button"
                key={`${item.file.name}-${item.previewUrl}`}
                className="group relative h-12 w-12 overflow-hidden rounded-md border bg-muted"
                onClick={() => removeChatAttachment(index)}
                disabled={isChatGenerating}
                title={copy("Remove reference image", "移除参考图片")}
              >
                <Image
                  src={item.previewUrl}
                  alt={item.file.name || copy(`Reference ${index + 1}`, `参考图片 ${index + 1}`)}
                  fill
                  sizes="48px"
                  className="object-cover"
                  unoptimized
                />
                <span className="absolute inset-0 hidden items-center justify-center bg-background/70 group-hover:flex">
                  <X className="h-3.5 w-3.5 text-foreground" />
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mb-2 flex flex-wrap items-center gap-2">
          {renderGptModelSelect({
            id: "chat-gpt-model",
            value: chatModel,
            onChange: (value) => {
              if (value !== "default") setChatModel(value);
            },
            disabled: isChatGenerating,
            compact: true,
          })}
          <Select
            value={chatImageModel}
            onValueChange={setChatImageModel}
            disabled={isChatGenerating}
          >
            <SelectTrigger className="h-8 w-[138px]" title={imageModelHelpText}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMAGE_MODEL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {copy("Image", "图片")} {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {renderThinkingSelect({
            id: "chat-thinking",
            value: chatThinking,
            onChange: setChatThinking,
            disabled: isChatGenerating,
            compact: true,
          })}
          <Select
            value={selectedChatPreset}
            onValueChange={applyChatPreset}
            disabled={isChatGenerating}
          >
            <SelectTrigger className="h-8 w-[168px]">
              <SelectValue placeholder={activeChatSize} />
            </SelectTrigger>
            <SelectContent>
              {isEditChat && chatEffectiveEditSize && (
                <SelectItem value="reference">
                  {copy("Reference", "参考图")} · {chatEffectiveEditSize}
                </SelectItem>
              )}
              {IMAGE_RESOLUTION_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {presetLabel(preset.label)} · {preset.detail}
                </SelectItem>
              ))}
              <SelectItem value="custom">
                {copy("Custom", "自定义")} · {activeChatSize}
              </SelectItem>
            </SelectContent>
          </Select>
          {isEditChat && (
            <Button
              type="button"
              variant={useFirstImageSize ? "secondary" : "outline"}
              size="sm"
              onClick={() => setUseFirstImageSize((value) => !value)}
              disabled={isChatGenerating || !chatFirstImageSize}
            >
              {copy("Reference size", "参考图尺寸")}
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {copy("Cost", "费用")}{" "}
            <span className="font-medium text-foreground">
              {formattedChatSingleCreditCost}
            </span>
          </span>
        </div>
        <div className="mb-2">
          {promptOptimizationField("chat-prompt-optimization", isChatGenerating)}
        </div>

        {chatCustomResolutionOpen && (
          <div className="mb-2 rounded-md border border-border bg-muted/30 p-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <label
                  htmlFor="chat-width"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {copy("Width", "宽度")}
                </label>
                <Input
                  id="chat-width"
                  type="number"
                  min={256}
                  max={MAX_IMAGE_DIMENSION}
                  step={IMAGE_DIMENSION_STEP}
                  value={isEditChat ? editWidth : width}
                  onChange={(event) => {
                    const next = Number(event.target.value) || 0;
                    if (isEditChat) {
                      setUseFirstImageSize(false);
                      setEditWidth(next);
                    } else {
                      setWidth(next);
                    }
                  }}
                  disabled={isChatGenerating}
                  className="h-8 w-28"
                />
              </div>
              <div className="pb-2 text-muted-foreground">x</div>
              <div className="space-y-1">
                <label
                  htmlFor="chat-height"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {copy("Height", "高度")}
                </label>
                <Input
                  id="chat-height"
                  type="number"
                  min={256}
                  max={MAX_IMAGE_DIMENSION}
                  step={IMAGE_DIMENSION_STEP}
                  value={isEditChat ? editHeight : height}
                  onChange={(event) => {
                    const next = Number(event.target.value) || 0;
                    if (isEditChat) {
                      setUseFirstImageSize(false);
                      setEditHeight(next);
                    } else {
                      setHeight(next);
                    }
                  }}
                  disabled={isChatGenerating}
                  className="h-8 w-28"
                />
              </div>
              <div className="pb-2 text-xs text-muted-foreground">
                {activeChatSize}
              </div>
            </div>
            {!chatSizeCheck.valid && (
              <p className="mt-2 text-xs text-destructive">
                {validationMessage(chatSizeCheck.message)}
              </p>
            )}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => chatImageInputRef.current?.click()}
            disabled={
              isChatGenerating || chatAttachments.length >= MAX_EDIT_IMAGES
            }
            title={copy("Attach reference image", "添加参考图片")}
          >
            <ImagePlus className="h-4 w-4" />
          </Button>
          <Textarea
            value={chatPrompt}
            onChange={(event) => setChatPrompt(event.target.value)}
            placeholder={copy("Continue creating...", "继续描述你的创作...")}
            rows={1}
            disabled={isChatGenerating}
            className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-0 py-2 text-base shadow-none focus-visible:ring-0"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={isChatGenerating || !chatPrompt.trim()}
            title={copy("Send", "发送")}
          >
            {isChatGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
          <input
            ref={chatImageInputRef}
            type="file"
            multiple
            accept={IMAGE_ACCEPT}
            className="sr-only"
            onChange={(event) => {
              void addChatAttachments(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      </form>
    );
  };

  const addBatchAttachments = async (files: FileList | File[] | null) => {
    await addChatAttachments(files);
  };

  const getBatchFallbackSize = () => {
    if (chatAttachments.length > 0 && chatEffectiveEditSize) {
      return chatEffectiveEditSize;
    }
    return size;
  };

  const validateChatAttachments = (attachments: ChatAttachment[]) => {
    if (attachments.length === 0) return true;
    const totalUploadSize = attachments.reduce(
      (total, item) => total + item.file.size,
      0
    );
    if (totalUploadSize > maxEditRequestBytes) {
      toast.error(copy("Upload is too large", "上传内容过大"), {
        description: copy(
          `Reference images total ${formatMegabytes(totalUploadSize)}. Keep the total under ${formatMegabytes(maxEditRequestBytes)}.`,
          `参考图片总大小为 ${formatMegabytes(totalUploadSize)}，请控制在 ${formatMegabytes(maxEditRequestBytes)} 以内。`
        ),
      });
      return false;
    }
    if (!chatEffectiveEditSize) {
      toast.error(copy("Waiting for reference image size", "正在读取参考图片尺寸"), {
        description: copy(
          "The first reference image is still loading.",
          "第一张参考图片仍在加载。"
        ),
      });
      return false;
    }
    return true;
  };

  const triggerBatchGeneration = async (options?: { retryCardId?: string }) => {
    const currentPrompt = (batchPromptRef.current || batchPrompt).trim();
    if (!currentPrompt) return;

    const fallbackSize = batchSizeRef.current || getBatchFallbackSize();
    if (!validateImageSize(fallbackSize).valid) {
      toast.error(copy("Invalid resolution", "分辨率无效"));
      return;
    }

    const attachments = chatAttachments.map((item) => ({
      ...item,
      file: cloneFile(item.file),
    }));
    if (!validateChatAttachments(attachments)) return;

    const requestCount = options?.retryCardId ? 1 : WATERFALL_LOAD_SIZE;
    const available =
      WATERFALL_MAX_CONCURRENT - batchActiveRequestsRef.current;
    const loadSize = Math.min(requestCount, Math.max(available, 0));
    if (loadSize <= 0) return;

    const creditsPerRequest = getImageCreditCost(fallbackSize, {
      imageModerationCount: attachments.length,
    });
    const pendingCredits = batchActiveRequestsRef.current * creditsPerRequest;
    const requiredCredits = creditsPerRequest * loadSize + pendingCredits;
    if (balance < requiredCredits) {
      showGenerationError("Insufficient credits");
      return;
    }

    const cards: BatchCard[] = options?.retryCardId
      ? []
      : Array.from({ length: loadSize }, () => ({
          id: createLocalId(),
          state: "loading" as const,
          aspectRatio:
            WATERFALL_ASPECT_RATIOS[
              Math.floor(Math.random() * WATERFALL_ASPECT_RATIOS.length)
            ] || WATERFALL_ASPECT_RATIOS[0],
          prompt: currentPrompt,
          size: fallbackSize,
        }));

    if (cards.length > 0) {
      setBatchCards((prev) => [...prev, ...cards]);
    } else if (options?.retryCardId) {
      setBatchCards((prev) =>
        prev.map((card) =>
          card.id === options.retryCardId
            ? {
                ...card,
                state: "loading",
                error: undefined,
                streamText: undefined,
                streamThinking: undefined,
              }
            : card
        )
      );
    }

    const runCard = async (cardId: string) => {
      batchActiveRequestsRef.current += 1;
      try {
        const data = await runChatRequest({
          prompt: currentPrompt,
          attachments,
          fallbackSize,
          historyMessages: [],
          streamCardId: cardId,
        });
        const variant = addSuccessfulResult(data, currentPrompt, fallbackSize);
        syncWaterfallCredits(data.creditsConsumed);
        setBatchCards((prev) =>
          prev.map((card) =>
            card.id === cardId
              ? {
                  ...card,
                  state: data.imageUrl ? "image" : "text",
                  imageUrl: data.imageUrl,
                  generationId: data.generationId,
                  text: data.responseText || variant?.responseText,
                  streamText: undefined,
                  streamThinking: data.responseThinking,
                  model: data.model,
                  size: data.size || fallbackSize,
                  creditsConsumed: data.creditsConsumed,
                }
              : card
          )
        );
      } catch (error) {
        const creditsConsumed =
          error instanceof Error
            ? (error as GenerationRequestError).creditsConsumed
            : undefined;
        syncChargedCredits(creditsConsumed);
        syncWaterfallCredits(creditsConsumed);
        setBatchCards((prev) =>
          prev.map((card) =>
            card.id === cardId
              ? {
                  ...card,
                  state: "error",
                  error:
                    error instanceof Error
                      ? error.message
                      : copy("Generation failed", "生成失败"),
                  creditsConsumed,
                }
              : card
          )
        );
      } finally {
        batchActiveRequestsRef.current -= 1;
      }
    };

    if (options?.retryCardId) {
      void runCard(options.retryCardId);
      return;
    }

    cards.forEach((card) => {
      void runCard(card.id);
    });
  };
  triggerBatchGenerationRef.current = triggerBatchGeneration;

  const handleBatchSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const currentPrompt = batchPrompt.trim();
    if (!currentPrompt) {
      toast.error(copy("Please enter a prompt", "请输入提示词"));
      return;
    }
    batchPromptRef.current = currentPrompt;
    batchSizeRef.current = getBatchFallbackSize();
    batchActiveRequestsRef.current = 0;
    batchLoadingMoreRef.current = false;
    setBatchCards([]);
    setWaterfallCreditsConsumed(0);
    setIsBatchLoadingMore(false);
    setIsBatchActive(true);
    await triggerBatchGeneration();
  };

  useEffect(() => {
    if (
      !isBatchActive ||
      !batchLoadTriggerRef.current ||
      !batchScrollRef.current
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (!batchPromptRef.current || batchLoadingMoreRef.current) return;
        if (batchActiveRequestsRef.current >= WATERFALL_MAX_CONCURRENT) return;
        const triggerGeneration = triggerBatchGenerationRef.current;
        if (!triggerGeneration) return;
        batchLoadingMoreRef.current = true;
        setIsBatchLoadingMore(true);
        void triggerGeneration().finally(() => {
          batchLoadingMoreRef.current = false;
          setIsBatchLoadingMore(false);
        });
      },
      { root: batchScrollRef.current, threshold: 0.1 }
    );

    observer.observe(batchLoadTriggerRef.current);
    return () => observer.disconnect();
  }, [isBatchActive]);

  const handleChatPaste = (event: React.ClipboardEvent) => {
    if (activeMode !== "chat" || isChatGenerating) return;

    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file && isImageFile(file)));

    if (!files.length) return;
    event.preventDefault();
    void addChatAttachments(files);
  };

  const handleChatSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chatPrompt.trim()) {
      toast.error(copy("Please enter a message", "请输入消息"));
      return;
    }

    const currentPrompt = chatPrompt.trim();
    const attachments = chatAttachments.map((item) => ({
      ...item,
      file: cloneFile(item.file),
    }));
    const isEditRequest = attachments.length > 0;
    const fallbackSize = isEditRequest ? chatEffectiveEditSize : size;
    const cost = isEditRequest ? chatEditImageCreditCost : CHAT_TEXT_ONLY_CREDITS;

    if (balance < cost) {
      showGenerationError("Insufficient credits");
      return;
    }
    if (!isEditRequest && !sizeCheck.valid) {
      toast.error(copy("Invalid resolution", "分辨率无效"), {
        description: validationMessage(sizeCheck.message),
      });
      return;
    }
    if (isEditRequest && !fallbackSize) {
      toast.error(copy("Waiting for reference image size", "正在读取参考图片尺寸"), {
        description: copy(
          "The first reference image is still loading.",
          "第一张参考图片仍在加载。"
        ),
      });
      return;
    }
    if (isEditRequest && !useFirstImageSize && !customEditSizeCheck.valid) {
      toast.error(copy("Invalid resolution", "分辨率无效"), {
        description: validationMessage(customEditSizeCheck.message),
      });
      return;
    }
    if (isEditRequest) {
      const totalUploadSize = attachments.reduce(
        (total, item) => total + item.file.size,
        0
      );
      if (totalUploadSize > maxEditRequestBytes) {
        toast.error(copy("Upload is too large", "上传内容过大"), {
          description: copy(
            `Reference images total ${formatMegabytes(totalUploadSize)}. Keep the total under ${formatMegabytes(maxEditRequestBytes)}.`,
            `参考图片总大小为 ${formatMegabytes(totalUploadSize)}，请控制在 ${formatMegabytes(maxEditRequestBytes)} 以内。`
          ),
        });
        return;
      }
    }

    const attachmentPreviews = attachments.map((item) => ({
      id: item.sourceId || item.previewUrl,
      name: item.file.name,
      previewUrl: URL.createObjectURL(item.file),
    }));
    const userMessageId = createLocalId();
    const assistantMessageId = createLocalId();
    const conversationBeforeSend = chatMessages;
    setChatMessages((prev) => [
      ...prev,
      {
        id: userMessageId,
        role: "user",
        text: currentPrompt,
        attachments: attachmentPreviews,
        createdAt: new Date().toISOString(),
      },
      {
        id: assistantMessageId,
        role: "assistant",
        text: isEditRequest
          ? copy("Editing image...", "正在编辑图片...")
          : copy("Generating image...", "正在生成图片..."),
        createdAt: new Date().toISOString(),
      },
    ]);
    setChatPrompt("");
    setResult(null);
    clearStreamingPreview();
    setIsChatGenerating(true);
    scrollChatToBottom();

    try {
      const data = await runChatRequest({
        prompt: currentPrompt,
        attachments,
        fallbackSize: fallbackSize || size,
        historyMessages: conversationBeforeSend,
        streamMessageId: assistantMessageId,
      });
      const variant = addSuccessfulResult(
        data,
        currentPrompt,
        fallbackSize || size
      );
      if (!variant) {
        const message = copy("API returned no image data", "接口未返回图片数据");
        showGenerationError(message);
        setChatMessages((prev) =>
          prev.map((item) =>
            item.id === assistantMessageId
              ? { ...item, text: copy("Generation failed", "生成失败"), error: message }
              : item
          )
        );
        return;
      }

      setChatMessages((prev) =>
        prev.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                text:
                  variant.responseText ||
                  (variant.imageUrl
                    ? copy("Image generated", "图片已生成")
                    : copy("Response generated", "回复已生成")),
                variants: [variant],
                activeVariant: 0,
              }
            : message
        )
      );
      clearChatAttachments();
      toast.success(
        data.imageUrl
          ? copy("Image generated", "图片已生成")
          : copy("Response generated", "回复已生成")
      );
    } catch (error) {
      const creditsConsumed =
        error instanceof Error
          ? (error as GenerationRequestError).creditsConsumed
          : undefined;
      syncChargedCredits(creditsConsumed);
      const message =
        error instanceof Error
          ? error.message
          : copy("An unexpected error occurred.", "发生未知错误。");
      toast.error(copy("Generation failed", "生成失败"), { description: message });
      setChatMessages((prev) =>
        prev.map((item) =>
          item.id === assistantMessageId
            ? { ...item, text: copy("Generation failed", "生成失败"), error: message }
            : item
        )
      );
    } finally {
      setIsChatGenerating(false);
      setChatStream(null);
      clearStreamingPreview();
      scrollChatToBottom();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      toast.error(copy("Please enter a prompt", "请输入提示词"));
      return;
    }
    if (balance < textBatchCreditCost) {
      showGenerationError("Insufficient credits");
      return;
    }
    if (!sizeCheck.valid) {
      toast.error(copy("Invalid resolution", "分辨率无效"), {
        description: validationMessage(sizeCheck.message),
      });
      return;
    }
    const currentPrompt = prompt.trim();
    setResult(null);
    clearStreamingPreview();
    setIsGenerating(true);
    try {
      const data = await runTextGenerationRequest({
        prompt: currentPrompt,
        count: batchCount,
        stream: true,
      });

      const generatedCount = addSuccessfulResults(data, currentPrompt).length;
      toast.success(
        generatedCount > 1
          ? copy(
              `${generatedCount} images generated`,
              `已生成 ${generatedCount} 张图片`
            )
          : copy("Image generated", "图片已生成")
      );
    } catch (error) {
      const creditsConsumed =
        error instanceof Error
          ? (error as GenerationRequestError).creditsConsumed
          : undefined;
      syncChargedCredits(creditsConsumed);
      toast.error(copy("Generation failed", "生成失败"), {
        description:
          error instanceof Error
            ? error.message
            : copy("An unexpected error occurred.", "发生未知错误。"),
      });
    } finally {
      setIsGenerating(false);
      clearStreamingPreview();
    }
  };

  const runTextGenerationRequest = async (params: {
    prompt: string;
    count?: number;
    stream?: boolean;
  }) => {
    const response = await fetch("/api/images/generate", {
      method: "POST",
      headers: {
        Accept: params.stream ? "text/event-stream" : "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: params.prompt,
        size,
        stream: Boolean(params.stream),
        count: params.count || 1,
        quality,
        moderation,
        ...(textModel !== "default" ? { model: textModel } : {}),
        ...(imageGptModel !== "default" ? { gptModel: imageGptModel } : {}),
        thinking: imageThinking,
        ...(promptOptimizationAllowed ? { promptOptimization } : {}),
      }),
    });

    const data = params.stream
      ? await readImageStreamResponse(response)
      : ((await response.json()) as ImageApiResult);

    if (!response.ok || data.error) {
      const error = new Error(data.error || `API error: ${response.status}`);
      (error as GenerationRequestError).creditsConsumed = data.creditsConsumed;
      throw error;
    }

    return data;
  };

  const handleTextLineBatchSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (linePromptItems.length === 0) {
      toast.error(copy("Enter at least one prompt line", "请至少输入一行提示词"));
      return;
    }
    if (balance < lineBatchCreditCost) {
      showGenerationError("Insufficient credits");
      return;
    }
    if (!sizeCheck.valid) {
      toast.error(copy("Invalid resolution", "分辨率无效"), {
        description: validationMessage(sizeCheck.message),
      });
      return;
    }

    setResult(null);
    clearStreamingPreview();
    setIsGenerating(true);
    let generatedCount = 0;
    try {
      for (const itemPrompt of linePromptItems) {
        for (let repeatIndex = 0; repeatIndex < lineBatchRepeatCount; repeatIndex++) {
          const data = await runTextGenerationRequest({
            prompt: itemPrompt,
            count: 1,
            stream: false,
          });
          generatedCount += addSuccessfulResults(data, itemPrompt).length;
        }
      }

      toast.success(
        generatedCount > 1
          ? copy(
              `${generatedCount} images generated`,
              `已生成 ${generatedCount} 张图片`
            )
          : copy("Image generated", "图片已生成")
      );
    } catch (error) {
      const creditsConsumed =
        error instanceof Error
          ? (error as GenerationRequestError).creditsConsumed
          : undefined;
      syncChargedCredits(creditsConsumed);
      toast.error(copy("Generation failed", "生成失败"), {
        description:
          error instanceof Error
            ? error.message
            : copy("An unexpected error occurred.", "发生未知错误。"),
      });
    } finally {
      setIsGenerating(false);
      clearStreamingPreview();
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPrompt.trim()) {
      toast.error(copy("Please enter an edit prompt", "请输入编辑提示词"));
      return;
    }
    if (editImages.length === 0) {
      toast.error(copy("Upload at least one source image", "请至少上传一张源图片"));
      return;
    }
    if (maskPoints.length > 0 && !maskFile) {
      toast.error(copy("Save the mask before editing", "编辑前请先保存蒙版"));
      return;
    }
    if (!effectiveEditSize) {
      toast.error(copy("Waiting for source image size", "正在读取源图片尺寸"), {
        description: copy(
          "The first source image is still loading.",
          "第一张源图片仍在加载。"
        ),
      });
      return;
    }
    if (!useFirstImageSize && !customEditSizeCheck.valid) {
      toast.error(copy("Invalid resolution", "分辨率无效"), {
        description: validationMessage(customEditSizeCheck.message),
      });
      return;
    }
    if (balance < editBatchCreditCost) {
      showGenerationError("Insufficient credits");
      return;
    }
    const totalUploadSize =
      editImages.reduce((total, item) => total + item.file.size, 0) +
      (maskFile?.file.size || 0);
    if (totalUploadSize > maxEditRequestBytes) {
      toast.error(copy("Upload is too large", "上传内容过大"), {
        description: copy(
          `Source images and mask total ${formatMegabytes(totalUploadSize)}. Keep the total under ${formatMegabytes(maxEditRequestBytes)}.`,
          `源图片和蒙版总大小为 ${formatMegabytes(totalUploadSize)}，请控制在 ${formatMegabytes(maxEditRequestBytes)} 以内。`
        ),
      });
      return;
    }

    const formData = new FormData();
    formData.append("prompt", editPrompt.trim());
    formData.append("quality", quality);
    formData.append("moderation", moderation);
    if (editModel !== "default") {
      formData.append("model", editModel);
    }
    if (imageGptModel !== "default") {
      formData.append("gptModel", imageGptModel);
    }
    formData.append("thinking", imageThinking);
    if (useFirstImageSize) {
      formData.append("displaySize", effectiveEditSize);
    } else {
      formData.append("size", effectiveEditSize);
    }
    editImages.forEach(({ file }) => {
      formData.append(editImages.length === 1 ? "image" : "image[]", file);
    });
    if (maskFile) formData.append("mask", maskFile.file);
    formData.append("count", String(editBatchCount));
    if (promptOptimizationAllowed) {
      formData.append("prompt_optimization", String(promptOptimization));
    }

    setIsEditing(true);
    setResult(null);
    clearStreamingPreview();
    formData.append("stream", "true");
    try {
      const response = await fetch("/api/images/edit", {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
        },
        body: formData,
      });
      const data = await readImageStreamResponse(response);

      if (!response.ok || data.error) {
        showGenerationError(data.error || `API error: ${response.status}`, {
          creditsConsumed: data.creditsConsumed,
        });
        return;
      }

      const generatedCount = addSuccessfulResults(
        data,
        editPrompt,
        effectiveEditSize
      ).length;
      toast.success(
        generatedCount > 1
          ? copy(`${generatedCount} images edited`, `已编辑 ${generatedCount} 张图片`)
          : copy("Image edited", "图片已编辑")
      );
    } catch (error) {
      toast.error(copy("Generation failed", "生成失败"), {
        description:
          error instanceof Error
            ? error.message
            : copy("An unexpected error occurred.", "发生未知错误。"),
      });
    } finally {
      setIsEditing(false);
      clearStreamingPreview();
    }
  };

  const applyPreset = (presetValue: string) => {
    const preset = IMAGE_RESOLUTION_PRESETS.find(
      (item) => item.value === presetValue
    );
    if (!preset) return;
    const dimensions = parseImageSize(preset.value);
    if (!dimensions) return;
    setWidth(dimensions.width);
    setHeight(dimensions.height);
  };

  const applyEditPreset = (presetValue: string) => {
    const preset = IMAGE_RESOLUTION_PRESETS.find(
      (item) => item.value === presetValue
    );
    if (!preset) return;
    const dimensions = parseImageSize(preset.value);
    if (!dimensions) return;
    setUseFirstImageSize(false);
    setEditWidth(dimensions.width);
    setEditHeight(dimensions.height);
  };

  const addImages = (files: FileList | File[] | null) => {
    const imageFiles = Array.from(files || []);
    if (!imageFiles.length) return;

    const accepted: EditImageFile[] = [];
    for (const file of imageFiles) {
      if (!isImageFile(file)) {
        toast.error(copy("Unsupported file type", "不支持的文件类型"), {
          description: copy(
            "Use PNG, JPEG, or WebP images.",
            "请使用 PNG、JPEG 或 WebP 图片。"
          ),
        });
        continue;
      }
      if (file.size > maxImageBytes) {
        toast.error(copy("File too large", "文件过大"), {
          description: copy(
            `${file.name} exceeds ${formatMegabytes(maxImageBytes)}.`,
            `${file.name} 超过 ${formatMegabytes(maxImageBytes)}。`
          ),
        });
        continue;
      }
      accepted.push({ file, previewUrl: URL.createObjectURL(file) });
    }

    if (!accepted.length) return;
    setEditImages((prev) => {
      const slots = MAX_EDIT_IMAGES - prev.length;
      if (slots <= 0) {
        for (const item of accepted) {
          revokePreview(item.previewUrl);
        }
        toast.error(
          copy(
            `Upload up to ${MAX_EDIT_IMAGES} source images`,
            `最多可上传 ${MAX_EDIT_IMAGES} 张源图片`
          )
        );
        return prev;
      }
      const next = accepted.slice(0, slots);
      for (const item of accepted.slice(slots)) {
        revokePreview(item.previewUrl);
      }
      if (accepted.length > slots) {
        toast.error(
          copy(
            `Only ${slots} more source image(s) can be added`,
            `还可以再添加 ${slots} 张源图片`
          )
        );
      }
      return [...prev, ...next];
    });
  };

  const handleImagePaste = (event: React.ClipboardEvent) => {
    if (activeMode !== "image" || isEditing) return;

    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file && isImageFile(file)));

    if (!files.length) return;
    event.preventDefault();
    addImages(files);
  };

  const removeImage = (index: number) => {
    setEditImages((prev) => {
      const target = prev[index];
      if (target) revokePreview(target.previewUrl);
      return prev.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const clearEditImages = () => {
    setEditImages((prev) => {
      for (const item of prev) {
        revokePreview(item.previewUrl);
      }
      return [];
    });
    setMaskEditorOpen(false);
    setMaskPoints([]);
    clearMask();
  };

  const setMask = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.type !== "image/png") {
      toast.error(copy("Mask must be a PNG file", "蒙版必须是 PNG 文件"));
      return;
    }
    if (file.size > maxImageBytes) {
      toast.error(copy("Mask is too large", "蒙版文件过大"), {
        description: copy(
          `Maximum size is ${formatMegabytes(maxImageBytes)}.`,
          `最大支持 ${formatMegabytes(maxImageBytes)}。`
        ),
      });
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      if (
        firstImageSize &&
        (img.naturalWidth !== firstImageSize.width ||
          img.naturalHeight !== firstImageSize.height)
      ) {
        URL.revokeObjectURL(previewUrl);
        toast.error(
          copy(
            "Mask dimensions must match the first source image",
            "蒙版尺寸必须与第一张源图片一致"
          ),
          {
            description: copy(
              `Expected ${firstImageSize.width}x${firstImageSize.height}.`,
              `应为 ${firstImageSize.width}x${firstImageSize.height}。`
            ),
          }
        );
        return;
      }

      setMaskFile((prev) => {
        if (prev) revokePreview(prev.previewUrl);
        return { file, previewUrl };
      });
      setMaskPoints([]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      toast.error(copy("Failed to load mask image", "蒙版图片加载失败"));
    };
    img.src = previewUrl;
  };

  const clearMask = () => {
    setMaskFile((prev) => {
      if (prev) revokePreview(prev.previewUrl);
      return null;
    });
  };

  const clearDrawnMask = () => {
    setMaskPoints([]);
    clearMask();
  };

  const addMaskPoint = (x: number, y: number) => {
    setMaskPoints((prev) => [...prev, { x, y, size: maskBrushSize }]);
    clearMask();
  };

  const getMaskPointerPosition = (
    event:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const point =
      "touches" in event ? event.touches[0] || event.changedTouches[0] : event;
    if (!point) return null;
    return {
      x: ((point.clientX - rect.left) / rect.width) * canvas.width,
      y: ((point.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startMaskDrawing = (
    event:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => {
    event.preventDefault();
    const point = getMaskPointerPosition(event);
    if (!point) return;
    isDrawingRef.current = true;
    lastMaskPointRef.current = point;
    addMaskPoint(point.x, point.y);
  };

  const drawMaskLine = (
    event:
      | React.MouseEvent<HTMLCanvasElement>
      | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawingRef.current) return;
    event.preventDefault();
    const point = getMaskPointerPosition(event);
    const lastPoint = lastMaskPointRef.current;
    if (!point || !lastPoint) return;

    const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
    const angle = Math.atan2(point.y - lastPoint.y, point.x - lastPoint.x);
    const step = Math.max(1, maskBrushSize / 4);
    const nextPoints: MaskPoint[] = [];

    for (let i = step; i < distance; i += step) {
      nextPoints.push({
        x: lastPoint.x + Math.cos(angle) * i,
        y: lastPoint.y + Math.sin(angle) * i,
        size: maskBrushSize,
      });
    }
    nextPoints.push({ x: point.x, y: point.y, size: maskBrushSize });
    setMaskPoints((prev) => [...prev, ...nextPoints]);
    clearMask();
    lastMaskPointRef.current = point;
  };

  const stopMaskDrawing = () => {
    isDrawingRef.current = false;
    lastMaskPointRef.current = null;
  };

  const saveDrawnMask = () => {
    if (!firstImageSize || maskPoints.length === 0) {
      toast.error(copy("Draw a mask area first", "请先绘制蒙版区域"));
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = firstImageSize.width;
    canvas.height = firstImageSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "destination-out";
    for (const point of maskPoints) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
      ctx.fill();
    }

    const previewUrl = canvas.toDataURL("image/png");
    canvas.toBlob((blob) => {
      if (!blob) {
        toast.error(copy("Failed to save mask", "保存蒙版失败"));
        return;
      }
      const file = new File([blob], "generated-mask.png", {
        type: "image/png",
      });
      setMaskFile((prev) => {
        if (prev) revokePreview(prev.previewUrl);
        return { file, previewUrl };
      });
      toast.success(copy("Mask saved", "蒙版已保存"));
    }, "image/png");
  };

  const useResultAsReference = async () => {
    if (!result?.imageUrl) return;

    try {
      const item = await urlToEditImageFile(
        result.imageUrl,
        `gpt2image-${result.generationId}`,
        result.generationId
      );
      clearEditImages();
      setEditImages([item]);
      setActiveMode("image");
      setEditPrompt("");
      toast.success(copy("Result added as reference image", "结果已作为参考图片"));
    } catch (error) {
      toast.error(copy("Failed to use result as reference", "设置参考图片失败"), {
        description:
          error instanceof Error
            ? error.message
            : copy("Could not load image.", "无法加载图片。"),
      });
    }
  };

  const selectRecentAsReference = async (generation: RecentGeneration) => {
    if (!generation.imageUrl) {
      toast.error(copy("This image is not available yet", "这张图片暂不可用"));
      return;
    }

    const existingIndex = editImages.findIndex(
      (item) => item.sourceId === generation.id
    );
    if (existingIndex >= 0) {
      removeImage(existingIndex);
      toast.success(copy("Reference image removed", "参考图片已移除"));
      return;
    }

    if (editImages.length >= MAX_EDIT_IMAGES) {
      toast.error(
        copy(
          `Upload up to ${MAX_EDIT_IMAGES} source images`,
          `最多可上传 ${MAX_EDIT_IMAGES} 张源图片`
        )
      );
      return;
    }

    try {
      const item = await urlToEditImageFile(
        generation.imageUrl,
        `gpt2image-${generation.id}`,
        generation.id
      );
      setEditImages((prev) => [...prev, item]);
      toast.success(copy("Reference image selected", "参考图片已选择"));
    } catch (error) {
      toast.error(copy("Failed to use image as reference", "设置参考图片失败"), {
        description:
          error instanceof Error
            ? error.message
            : copy("Could not load image.", "无法加载图片。"),
      });
    }
  };

  const openRecentPreview = (generation: RecentGeneration) => {
    if (!generation.imageUrl) {
      toast.error(copy("This image is not available yet", "这张图片暂不可用"));
      return;
    }
    setSelectedRecentId(generation.id);
  };

  const handleRecentClick = (generation: RecentGeneration) => {
    if (activeMode === "chat") {
      if (!generation.imageUrl) {
        toast.error(copy("This image is not available yet", "这张图片暂不可用"));
        return;
      }
      void attachImageUrlToChat(
        generation.imageUrl,
        `gpt2image-${generation.id}`,
        generation.id
      );
      return;
    }

    if (activeMode === "image") {
      void selectRecentAsReference(generation);
      return;
    }
    openRecentPreview(generation);
  };

  const selectedRecent =
    recent.find((item) => item.id === selectedRecentId) ?? null;

  const textSettingsPanel = (mode: TextGenerationMode) => {
    const isLineMode = mode === "lines";
    const countValue = isLineMode ? lineBatchRepeatCount : batchCount;
    const setCountValue = isLineMode ? setLineBatchRepeatCount : setBatchCount;
    const formattedCost = isLineMode
      ? formattedLineBatchCreditCost
      : formattedTextBatchCreditCost;
    const costSuffix = isLineMode
      ? copy(
          ` for ${lineBatchTotalCount} total`,
          `，共 ${lineBatchTotalCount} 张`
        )
      : batchCostSuffix(batchCount);

    return (
    <div className="space-y-4 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <label
                htmlFor={`text-model-${mode}`}
                className="text-xs font-medium text-muted-foreground"
              >
                {labelWithHelp(copy("Image model", "图片模型"), imageModelHelpText)}
              </label>
              <Select
                value={textModel}
                onValueChange={setTextModel}
                disabled={busy}
              >
                <SelectTrigger
                  id={`text-model-${mode}`}
                  className="w-full"
                  title={imageModelHelpText}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEXT_MODEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {textModelLabel(option.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={`text-gpt-model-${mode}`}
                className="text-xs font-medium text-muted-foreground"
              >
                {labelWithHelp(copy("GPT model", "GPT 模型"), gptModelHelpText)}
              </label>
              {renderGptModelSelect({
                id: `text-gpt-model-${mode}`,
                value: imageGptModel,
                onChange: setImageGptModel,
                disabled: busy,
                allowDefault: true,
              })}
              <p className="text-[11px] leading-snug text-muted-foreground">
                {copy(
                  "Used by platform Web/Codex backend pools; external image APIs keep using the image model.",
                  "仅用于平台 Web/Codex 后端池；默认会沿用后端配置，外接 image API 仍按图片模型请求。"
                )}
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={`text-thinking-${mode}`}
                className="text-xs font-medium text-muted-foreground"
              >
                {labelWithHelp(copy("Thinking", "思考强度"), thinkingHelpText)}
              </label>
              {renderThinkingSelect({
                id: `text-thinking-${mode}`,
                value: imageThinking,
                onChange: setImageThinking,
                disabled: busy,
              })}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={isLineMode ? "line-repeat-count" : "batch-count"}
                className="text-xs font-medium text-muted-foreground"
              >
                {isLineMode
                  ? copy("Repeat each line", "每行重复")
                  : copy("Repeat prompt", "重复生成")}
              </label>
              <Select
                value={String(countValue)}
                onValueChange={(value) => setCountValue(Number(value))}
                disabled={busy}
              >
                <SelectTrigger
                  id={isLineMode ? "line-repeat-count" : "batch-count"}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BATCH_OPTIONS.map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {imageCountLabel(count)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <span className="text-sm font-medium text-foreground">
              {copy("Resolution", "分辨率")}
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              {copy(
                "Width and height must be multiples of 16.",
                "宽和高必须是 16 的倍数。"
              )}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {IMAGE_RESOLUTION_PRESETS.map((preset) => {
              const active = preset.value === size;
              return (
                <Button
                  key={preset.value}
                  type="button"
                  variant={active ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => applyPreset(preset.value)}
                  className="h-auto min-h-14 flex-col items-start justify-center gap-0.5 px-3 py-2 text-left"
                >
                  <span className="text-sm font-medium leading-tight">
                    {presetLabel(preset.label)}
                  </span>
                  <span className="text-[11px] leading-tight opacity-80">
                    {preset.detail}
                  </span>
                </Button>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <label
                htmlFor="image-width"
                className="text-xs font-medium text-muted-foreground"
              >
                {copy("Width", "宽度")}
              </label>
              <Input
                id="image-width"
                type="number"
                min={256}
                max={MAX_IMAGE_DIMENSION}
                step={IMAGE_DIMENSION_STEP}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value) || 0)}
                disabled={busy}
                className="w-32"
              />
            </div>
            <div className="pb-2 text-muted-foreground">x</div>
            <div className="space-y-1.5">
              <label
                htmlFor="image-height"
                className="text-xs font-medium text-muted-foreground"
              >
                {copy("Height", "高度")}
              </label>
              <Input
                id="image-height"
                type="number"
                min={256}
                max={MAX_IMAGE_DIMENSION}
                step={IMAGE_DIMENSION_STEP}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value) || 0)}
                disabled={busy}
                className="w-32"
              />
            </div>
            <div className="text-xs text-muted-foreground sm:pb-2">{size}</div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor={`image-quality-${mode}`}
                className="text-xs font-medium text-muted-foreground"
              >
                {copy("Quality", "质量")}
              </label>
              <Select
                value={quality}
                onValueChange={(value) => setQuality(value as ImageQuality)}
                disabled={busy}
              >
                <SelectTrigger id={`image-quality-${mode}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {qualityLabel(option.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={`image-oai-moderation-${mode}`}
                className="text-xs font-medium text-muted-foreground"
              >
                {copy("OAI moderation strength", "OAI 自身审核强度")}
              </label>
              <Select
                value={moderation}
                onValueChange={(value) =>
                  setModeration(value as ImageModeration)
                }
                disabled={busy}
              >
                <SelectTrigger
                  id={`image-oai-moderation-${mode}`}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODERATION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {moderationLabel(option.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground lg:justify-end">
          <Coins className="h-3.5 w-3.5" />
          <span>
            {copy("Balance", "余额")}:{" "}
            <span className="font-medium text-foreground">
              {formattedBalance}
            </span>{" "}
            · {copy("Cost", "费用")}:{" "}
            <span className="font-medium text-foreground">
              {formattedCost}
            </span>
            {costSuffix}
          </span>
        </div>
      </div>
      {!sizeCheck.valid && (
        <p className="text-xs text-destructive">
          {validationMessage(sizeCheck.message)}
        </p>
      )}
    </div>
    );
  };

  const loading = busy;

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-12">
      <header className="mb-8 space-y-2">
        <h1 className="font-serif text-3xl font-semibold tracking-tight md:text-4xl">
          {copy("Create", "创作")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {copy(
            "Generate a new image from text, or transform uploaded images with a prompt.",
            "用文字生成新图片，或通过提示词改造上传的图片。"
          )}
        </p>
      </header>

      <Tabs
        value={activeMode}
        onValueChange={(value) => {
          if (value === "chat" && !chatAllowed) {
            toast.error(copy("Chat requires Pro plan or higher.", "对话功能需要专业版或更高套餐。"));
            return;
          }
          setActiveMode(value as ActiveMode);
        }}
        className="mb-10"
      >
        <TabsList className="mb-4 border border-border bg-muted/40">
          <TabsTrigger value="text">
            <Wand2 className="h-4 w-4" />
            {copy("Text to image", "文生图")}
          </TabsTrigger>
          <TabsTrigger value="image">
            <ImagePlus className="h-4 w-4" />
            {copy("Image to image", "图生图")}
          </TabsTrigger>
          <TabsTrigger value="chat" disabled={!chatAllowed}>
            <MessageSquare className="h-4 w-4" />
            {copy("Chat", "对话")}
            {gpt55ChatAllowed && (
              <span className="text-[10px] text-muted-foreground">
                GPT-5.5
              </span>
            )}
            {!chatAllowed && (
              <span className="text-[10px] text-muted-foreground">Pro</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="text" className="mt-0">
          <Tabs
            value={textMode}
            onValueChange={(value) => setTextMode(value as TextGenerationMode)}
            className="space-y-4"
          >
            <TabsList className="border border-border bg-muted/40">
              <TabsTrigger value="single">
                {copy("Single prompt", "单提示词")}
              </TabsTrigger>
              <TabsTrigger value="lines">
                {copy("Line batch", "逐行批量")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="mt-0">
              <form onSubmit={handleSubmit} className="space-y-4">
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={copy(
                    "Describe the image you want to create...",
                    "描述你想创作的图片..."
                  )}
                  rows={5}
                  disabled={isGenerating}
                  className="resize-none border-input bg-background text-base"
                />
                {promptOptimizationField("text-prompt-optimization", isGenerating)}
                {textSettingsPanel("single")}
                <div className="flex justify-end">
                  <Button type="submit" disabled={isGenerating || !prompt.trim()}>
                    {isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {copy("Generating", "生成中")}
                      </>
                    ) : (
                      <>
                        <ImagePlus className="mr-2 h-4 w-4" />
                        {copy("Generate", "生成")}
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="lines" className="mt-0">
              <form onSubmit={handleTextLineBatchSubmit} className="space-y-4">
                <Textarea
                  value={linePrompts}
                  onChange={(e) => setLinePrompts(e.target.value)}
                  placeholder={copy(
                    "One prompt per line. Each line generates one image.",
                    "每行一个提示词，每行生成一张图片。"
                  )}
                  rows={8}
                  disabled={isGenerating}
                  className="resize-none border-input bg-background text-base"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {copy("Prompt lines", "提示词行数")}:{" "}
                    <span className="font-medium text-foreground">
                      {linePromptItems.length}
                    </span>
                  </span>
                  <span>
                    {copy("Total images", "总图片数")}:{" "}
                    <span className="font-medium text-foreground">
                      {lineBatchTotalCount}
                    </span>
                  </span>
                </div>
                {promptOptimizationField(
                  "text-line-prompt-optimization",
                  isGenerating
                )}
                {textSettingsPanel("lines")}
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={isGenerating || linePromptItems.length === 0}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {copy("Generating", "生成中")}
                      </>
                    ) : (
                      <>
                        <ImagePlus className="mr-2 h-4 w-4" />
                        {copy("Generate line batch", "生成逐行批量")}
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="image" className="mt-0">
          <form
            onSubmit={handleEditSubmit}
            onPaste={handleImagePaste}
            className="space-y-4"
          >
            <Textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder={copy(
                "Describe how to transform the uploaded image...",
                "描述如何改造上传的图片..."
              )}
              rows={5}
              disabled={isEditing}
              className="resize-none border-input bg-background text-base"
            />
            {promptOptimizationField("edit-prompt-optimization", isEditing)}

            <div className="space-y-4 rounded-lg border border-border bg-background p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-sm font-medium text-foreground">
                    {copy("Source images", "源图片")}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {copy(
                      `Upload PNG, JPEG, or WebP. Up to ${MAX_EDIT_IMAGES} images, ${formatMegabytes(maxEditRequestBytes)} total.`,
                      `上传 PNG、JPEG 或 WebP，最多 ${MAX_EDIT_IMAGES} 张，总大小不超过 ${formatMegabytes(maxEditRequestBytes)}。`
                    )}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isEditing || editImages.length >= MAX_EDIT_IMAGES}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {copy("Upload images", "上传图片")}
                </Button>
                {editImages.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={clearEditImages}
                    disabled={isEditing}
                  >
                    {copy("Clear all", "全部清除")}
                  </Button>
                )}
                <input
                  ref={imageInputRef}
                  type="file"
                  multiple
                  accept={IMAGE_ACCEPT}
                  className="sr-only"
                  onChange={(e) => {
                    addImages(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>

              {editImages.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
                  {editImages.map((item, index) => (
                    <div
                      key={`${item.file.name}-${item.previewUrl}`}
                      className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                    >
                      <span className="absolute left-1 top-1 z-10 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
                        {index + 1}
                      </span>
                      <Image
                        src={item.previewUrl}
                        alt={
                          item.file.name ||
                          copy(`Source image ${index + 1}`, `源图片 ${index + 1}`)
                        }
                        fill
                        sizes="160px"
                        className="object-cover"
                        unoptimized
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon-xs"
                        className="absolute right-1 top-1 opacity-95"
                        onClick={() => removeImage(index)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
              <div className="space-y-4 rounded-lg border border-border bg-background p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                  <span className="text-sm font-medium text-foreground">
                      {copy("Optional mask", "可选蒙版")}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                      {copy(
                        "Draw on the first source image or upload a PNG mask. Transparent areas are edited.",
                        "在第一张源图上绘制，或上传 PNG 蒙版。透明区域会被编辑。"
                      )}
                  </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setMaskEditorOpen((value) => !value)}
                      disabled={isEditing || !firstImageSize}
                    >
                      <Brush className="mr-2 h-4 w-4" />
                      {maskEditorOpen
                        ? copy("Close editor", "关闭编辑器")
                        : copy("Draw mask", "绘制蒙版")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => maskInputRef.current?.click()}
                      disabled={isEditing || !firstImageSize}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {copy("Upload mask", "上传蒙版")}
                    </Button>
                    {maskFile && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={clearMask}
                        disabled={isEditing}
                      >
                        {copy("Clear", "清除")}
                      </Button>
                    )}
                  </div>
                  <input
                    ref={maskInputRef}
                    type="file"
                    accept="image/png"
                    className="sr-only"
                    onChange={(e) => {
                      setMask(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
                {maskEditorOpen && firstPreviewUrl && firstImageSize && (
                  <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                    <div
                      className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-md border bg-muted"
                      style={{
                        aspectRatio: `${firstImageSize.width} / ${firstImageSize.height}`,
                      }}
                    >
                      <Image
                        src={firstPreviewUrl}
                        alt={copy(
                          "Source image for mask editing",
                          "用于蒙版编辑的源图片"
                        )}
                        fill
                        sizes="(max-width: 1024px) 100vw, 640px"
                        className="object-contain"
                        unoptimized
                      />
                      <canvas
                        ref={maskCanvasRef}
                        width={firstImageSize.width}
                        height={firstImageSize.height}
                        className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                        onMouseDown={startMaskDrawing}
                        onMouseMove={drawMaskLine}
                        onMouseUp={stopMaskDrawing}
                        onMouseLeave={stopMaskDrawing}
                        onTouchStart={startMaskDrawing}
                        onTouchMove={drawMaskLine}
                        onTouchEnd={stopMaskDrawing}
                      />
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <label
                        htmlFor="mask-brush-size"
                        className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
                      >
                        {copy("Brush", "画笔")} {maskBrushSize}px
                        <input
                          id="mask-brush-size"
                          type="range"
                          min={4}
                          max={128}
                          step={1}
                          value={maskBrushSize}
                          onChange={(event) =>
                            setMaskBrushSize(Number(event.target.value))
                          }
                          className="w-40 accent-primary"
                        />
                      </label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={clearDrawnMask}
                          disabled={isEditing}
                        >
                          <Eraser className="mr-2 h-4 w-4" />
                          {copy("Clear mask", "清除蒙版")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={saveDrawnMask}
                          disabled={isEditing || maskPoints.length === 0}
                        >
                          <Save className="mr-2 h-4 w-4" />
                          {copy("Save mask", "保存蒙版")}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {maskFile && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {copy("Saved mask", "已保存蒙版")}
                    </p>
                    <div className="relative aspect-video w-44 overflow-hidden rounded-md border bg-muted">
                      <Image
                        src={maskFile.previewUrl}
                        alt={copy("Mask preview", "蒙版预览")}
                        fill
                        sizes="176px"
                        className="object-contain"
                        unoptimized
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4 rounded-lg border border-border bg-background p-4">
                <div className="space-y-2">
                  <label
                    htmlFor="edit-model"
                    className="text-sm font-medium text-foreground"
                  >
                    {labelWithHelp(copy("Image model", "图片模型"), imageModelHelpText)}
                  </label>
                  <Select
                    value={editModel}
                    onValueChange={setEditModel}
                    disabled={isEditing}
                  >
                    <SelectTrigger
                      id="edit-model"
                      className="w-full"
                      title={imageModelHelpText}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EDIT_MODEL_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {editModelLabel(option.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="edit-gpt-model"
                    className="text-sm font-medium text-foreground"
                  >
                    {labelWithHelp(copy("GPT model", "GPT 模型"), gptModelHelpText)}
                  </label>
                  {renderGptModelSelect({
                    id: "edit-gpt-model",
                    value: imageGptModel,
                    onChange: setImageGptModel,
                    disabled: isEditing,
                    allowDefault: true,
                  })}
                  <p className="text-xs leading-snug text-muted-foreground">
                    {copy(
                      "Used by platform Web/Codex backend pools; external image APIs keep using the image model.",
                      "仅用于平台 Web/Codex 后端池；默认会沿用后端配置，外接 image API 仍按图片模型请求。"
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="edit-thinking"
                    className="text-sm font-medium text-foreground"
                  >
                    {labelWithHelp(copy("Thinking", "思考强度"), thinkingHelpText)}
                  </label>
                  {renderThinkingSelect({
                    id: "edit-thinking",
                    value: imageThinking,
                    onChange: setImageThinking,
                    disabled: isEditing,
                  })}
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="edit-quality"
                    className="text-sm font-medium text-foreground"
                  >
                    {copy("Quality", "质量")}
                  </label>
                  <Select
                    value={quality}
                    onValueChange={(value) => setQuality(value as ImageQuality)}
                    disabled={isEditing}
                  >
                    <SelectTrigger id="edit-quality" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUALITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {qualityLabel(option.value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="edit-oai-moderation"
                    className="text-sm font-medium text-foreground"
                  >
                    {copy("OAI moderation strength", "OAI 自身审核强度")}
                  </label>
                  <Select
                    value={moderation}
                    onValueChange={(value) =>
                      setModeration(value as ImageModeration)
                    }
                    disabled={isEditing}
                  >
                    <SelectTrigger id="edit-oai-moderation" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODERATION_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {moderationLabel(option.value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="edit-batch-count"
                    className="text-sm font-medium text-foreground"
                  >
                    {copy("Batch", "批量")}
                  </label>
                  <Select
                    value={String(editBatchCount)}
                    onValueChange={(value) => setEditBatchCount(Number(value))}
                    disabled={isEditing}
                  >
                    <SelectTrigger id="edit-batch-count" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BATCH_OPTIONS.map((count) => (
                        <SelectItem key={count} value={String(count)}>
                          {imageCountLabel(count)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3 rounded-md bg-muted/40 p-3">
                  <label
                    htmlFor="edit-use-source-size"
                    className="flex cursor-pointer items-start gap-2 text-sm font-medium text-foreground"
                  >
                    <Checkbox
                      id="edit-use-source-size"
                      checked={useFirstImageSize}
                      onCheckedChange={(checked) =>
                        setUseFirstImageSize(checked === true)
                      }
                      disabled={isEditing}
                      className="mt-0.5"
                    />
                    <span>
                      {copy("Use first image resolution", "使用第一张图片分辨率")}
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        {copy(
                          "Default for edits. Turn off for outpainting or canvas extension.",
                          "编辑默认使用该尺寸；扩图或扩展画布时可关闭。"
                        )}
                      </span>
                    </span>
                  </label>

                  {!useFirstImageSize && (
                    <div className="space-y-3 border-t border-border pt-3">
                      <div className="grid grid-cols-2 gap-2">
                        {IMAGE_RESOLUTION_PRESETS.map((preset) => {
                          const active = preset.value === customEditSize;
                          return (
                            <Button
                              key={preset.value}
                              type="button"
                              variant={active ? "default" : "outline"}
                              disabled={isEditing}
                              onClick={() => applyEditPreset(preset.value)}
                              className="h-auto min-h-12 flex-col items-start justify-center gap-0.5 px-2 py-2 text-left"
                            >
                              <span className="text-xs font-medium leading-tight">
                                {presetLabel(preset.label)}
                              </span>
                              <span className="text-[10px] leading-tight opacity-80">
                                {preset.detail}
                              </span>
                            </Button>
                          );
                        })}
                      </div>

                      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                        <div className="space-y-1.5">
                          <label
                            htmlFor="edit-width"
                            className="text-xs font-medium text-muted-foreground"
                          >
                            {copy("Width", "宽度")}
                          </label>
                          <Input
                            id="edit-width"
                            type="number"
                            min={256}
                            max={MAX_IMAGE_DIMENSION}
                            step={IMAGE_DIMENSION_STEP}
                            value={editWidth}
                            onChange={(event) =>
                              setEditWidth(Number(event.target.value) || 0)
                            }
                            disabled={isEditing}
                          />
                        </div>
                        <div className="pb-2 text-muted-foreground">x</div>
                        <div className="space-y-1.5">
                          <label
                            htmlFor="edit-height"
                            className="text-xs font-medium text-muted-foreground"
                          >
                            {copy("Height", "高度")}
                          </label>
                          <Input
                            id="edit-height"
                            type="number"
                            min={256}
                            max={MAX_IMAGE_DIMENSION}
                            step={IMAGE_DIMENSION_STEP}
                            value={editHeight}
                            onChange={(event) =>
                              setEditHeight(Number(event.target.value) || 0)
                            }
                            disabled={isEditing}
                          />
                        </div>
                      </div>

                      {!customEditSizeCheck.valid && (
                        <p className="text-xs text-destructive">
                          {validationMessage(customEditSizeCheck.message)}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                  <p>
                    {copy("Output size", "输出尺寸")}:{" "}
                    <span className="font-medium text-foreground">
                      {editDisplaySize}
                    </span>
                  </p>
                  <p className="mt-1">
                    {copy("Cost", "费用")}:{" "}
                    <span className="font-medium text-foreground">
                      {formattedEditBatchCreditCost}
                    </span>
                    {batchCostSuffix(editBatchCount)}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={
                  isEditing || !editPrompt.trim() || editImages.length === 0
                }
              >
                {isEditing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {copy("Editing", "编辑中")}
                  </>
                ) : (
                  <>
                    <ImagePlus className="mr-2 h-4 w-4" />
                    {copy("Edit image", "编辑图片")}
                  </>
                )}
              </Button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="chat" className="mt-0">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
                <Button
                  type="button"
                  variant={chatViewMode === "chat" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setChatViewMode("chat")}
                >
                  <MessageSquare className="h-4 w-4" />
                  {copy("Chat", "对话")}
                </Button>
                <Button
                  type="button"
                  variant={chatViewMode === "batch" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setChatViewMode("batch")}
                >
                  <ImagePlus className="h-4 w-4" />
                  {copy("Waterfall", "瀑布流")}
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {chatViewMode === "chat" && (
                  <>
                    <Select
                      value={chatConversationId}
                      onValueChange={(value) => {
                        const conversation = chatConversations.find(
                          (item) => item.id === value
                        );
                        if (conversation) {
                          handleOpenChatConversation(conversation);
                        }
                      }}
                      disabled={isChatGenerating || chatConversations.length === 0}
                    >
                      <SelectTrigger className="h-9 w-[180px] sm:w-[220px]">
                        <SelectValue
                          placeholder={copy("Chat history", "历史对话")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {chatConversations.map((conversation) => (
                          <SelectItem
                            key={conversation.id}
                            value={conversation.id}
                          >
                            {conversation.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleNewChat}
                      disabled={isChatGenerating}
                    >
                      <Plus className="h-4 w-4" />
                      {copy("New chat", "新对话")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleClearChatHistory}
                      disabled={isChatGenerating || chatMessages.length === 0}
                    >
                      <Trash2 className="h-4 w-4" />
                      {copy("Clear history", "清理记录")}
                    </Button>
                  </>
                )}
                {chatAttachments.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearChatAttachments}
                    disabled={isChatGenerating}
                  >
                    <X className="h-4 w-4" />
                    {copy("Clear references", "清除参考图")}
                  </Button>
                )}
              </div>
            </div>

            {chatViewMode === "chat" ? (
              <div className="flex min-h-[680px] flex-col overflow-hidden rounded-lg border border-border bg-background">
                <div
                  ref={chatMessagesRef}
                  className="flex-1 space-y-5 overflow-y-auto px-4 py-4"
                >
                  {chatMessages.length === 0 ? (
                    <div className="flex min-h-[420px] flex-col items-center justify-center text-center text-muted-foreground">
                      <MessageSquare className="mb-3 h-8 w-8" />
                      <p className="text-sm font-medium text-foreground">
                        {copy("Start a visual conversation", "开始视觉对话")}
                      </p>
                      <p className="mt-1 max-w-md text-xs">
                        {copy(
                          "Auto mode generates from text, edits attached images, and keeps the conversation as context.",
                          "Auto 模式会根据文字生成图片、编辑附件图片，并保留对话上下文。"
                        )}
                      </p>
                    </div>
                  ) : (
                    chatMessages.map((message) => {
                      const variants = getChatVariants(message);
                      const activeVariant = getActiveChatVariant(message);
                      const activeIndex = message.activeVariant || 0;
                      const isRetrying =
                        retryingChatMessageId === message.id && chatStream;

                      return (
                        <div
                          key={message.id}
                          className={`flex ${
                            message.role === "user"
                              ? "justify-end"
                              : "justify-start"
                          }`}
                        >
                          <div
                            className={`max-w-[88%] ${
                              message.role === "user"
                                ? "text-right"
                                : "text-left"
                            }`}
                          >
                            <div
                              className={`rounded-lg border px-3 py-3 text-sm ${
                                message.role === "user"
                                  ? "border-primary/20 bg-primary text-primary-foreground"
                                  : "border-border bg-muted/35 text-foreground"
                              }`}
                            >
                              {message.role === "user" ? (
                                <div className="flex flex-col gap-3">
                                  {message.attachments?.length ? (
                                    <div className="flex flex-wrap justify-end gap-2">
                                      {message.attachments.map((attachment) => (
                                        <div
                                          key={attachment.id}
                                          className="relative h-12 w-12 overflow-hidden rounded-md border border-primary-foreground/25 bg-muted"
                                        >
                                          <Image
                                            src={attachment.previewUrl}
                                            alt={attachment.name}
                                            fill
                                            sizes="48px"
                                            className="object-cover"
                                            unoptimized
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                  <p className="whitespace-pre-wrap break-words">
                                    {message.text}
                                  </p>
                                </div>
                              ) : isRetrying ? (
                                renderChatStreamBubble(message.id)
                              ) : message.error ? (
                                <p className="text-destructive">
                                  {message.error}
                                </p>
                              ) : activeVariant ? (
                                <div>
                                  {renderThinkingBlock(
                                    activeVariant.responseThinking
                                  )}
                                  {activeVariant.responseText && (
                                    <p
                                      className={`whitespace-pre-wrap break-words leading-relaxed ${
                                        activeVariant.imageUrl ? "mb-3" : ""
                                      }`}
                                    >
                                      {activeVariant.responseText}
                                    </p>
                                  )}
                                  {activeVariant.imageUrl && (
                                    <div className="overflow-hidden rounded-md border bg-background">
                                      <button
                                        type="button"
                                        className="group relative block w-full bg-muted"
                                        style={{
                                          aspectRatio: `${
                                            parseImageSize(activeVariant.size)
                                              ?.width || defaultDimensions.width
                                          } / ${
                                            parseImageSize(activeVariant.size)
                                              ?.height ||
                                            defaultDimensions.height
                                          }`,
                                        }}
                                        onClick={() => {
                                          if (activeVariant.generationId) {
                                            setSelectedRecentId(
                                              activeVariant.generationId
                                            );
                                          }
                                        }}
                                        title={copy("Open image preview", "打开图片预览")}
                                      >
                                        <Image
                                          src={activeVariant.imageUrl}
                                          alt={activeVariant.prompt}
                                          fill
                                          sizes="(max-width: 768px) 80vw, 420px"
                                          className="object-contain"
                                          unoptimized={
                                            !shouldOptimizeStoredImage(
                                              activeVariant.imageUrl
                                            )
                                          }
                                        />
                                        <span className="absolute right-2 top-2 rounded bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                                          <Eye className="mr-1 inline h-3 w-3" />
                                          {copy("Preview", "预览")}
                                        </span>
                                      </button>
                                      <div className="flex flex-wrap gap-2 p-2">
                                        <Button
                                          asChild
                                          variant="outline"
                                          size="xs"
                                        >
                                          <a
                                            href={activeVariant.imageUrl}
                                            download
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            <Download className="h-3 w-3" />
                                            {copy("Download", "下载")}
                                          </a>
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="xs"
                                          onClick={() =>
                                            attachResultToChat(activeVariant)
                                          }
                                        >
                                          <RefreshCcw className="h-3 w-3" />
                                          {copy("Edit next", "继续编辑")}
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                  {!activeVariant.responseText &&
                                    !activeVariant.imageUrl && (
                                      <p className="text-muted-foreground">
                                        {copy("Response generated", "回复已生成")}
                                      </p>
                                    )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {copy("Generating...", "生成中...")}
                                </div>
                              )}
                            </div>

                            {message.role === "assistant" && (
                              <div className="mt-2 flex items-center gap-2">
                                {variants.length > 1 && (
                                  <div className="inline-flex items-center rounded-md border border-border bg-background text-xs text-muted-foreground">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      disabled={
                                        isChatGenerating || activeIndex === 0
                                      }
                                      onClick={() =>
                                        handleChatVariantChange(message.id, -1)
                                      }
                                      title={copy("Previous variant", "上一个版本")}
                                    >
                                      <ChevronLeft className="h-3 w-3" />
                                    </Button>
                                    <span className="px-2">
                                      {activeIndex + 1} / {variants.length}
                                    </span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      disabled={
                                        isChatGenerating ||
                                        activeIndex >= variants.length - 1
                                      }
                                      onClick={() =>
                                        handleChatVariantChange(message.id, 1)
                                      }
                                      title={copy("Next variant", "下一个版本")}
                                    >
                                      <ChevronRight className="h-3 w-3" />
                                    </Button>
                                  </div>
                                )}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled={isChatGenerating}
                                  onClick={() => handleChatRetry(message.id)}
                                  title={
                                    message.error
                                      ? copy("Retry generation", "重试生成")
                                      : copy("Generate another variant", "再生成一个版本")
                                  }
                                >
                                  <RefreshCcw className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}

                  {chatStream && !retryingChatMessageId && (
                    <div className="flex justify-start">
                      <div className="max-w-[88%]">
                        {renderChatStreamBubble(undefined)}
                      </div>
                    </div>
                  )}
                </div>

                {renderChatInput()}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border bg-background">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {renderGptModelSelect({
                      id: "batch-gpt-model",
                      value: chatModel,
                      onChange: (value) => {
                        if (value !== "default") setChatModel(value);
                      },
                      compact: true,
                    })}
                    <Select
                      value={chatImageModel}
                      onValueChange={setChatImageModel}
                    >
                      <SelectTrigger
                        className="h-8 w-[138px]"
                        title={imageModelHelpText}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {IMAGE_MODEL_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {copy("Image", "图片")} {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {renderThinkingSelect({
                      id: "batch-thinking",
                      value: chatThinking,
                      onChange: setChatThinking,
                      compact: true,
                    })}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    {promptOptimizationField(
                      "batch-prompt-optimization",
                      isBatchActive
                    )}
                    <div className="text-xs text-muted-foreground">
                      {copy("Per image", "单张预计")}{" "}
                      <span className="font-medium text-foreground">
                        {formattedBatchSingleCreditCost}
                      </span>
                      {isBatchActive && (
                        <>
                          {" "}
                          <span className="text-muted-foreground">/</span>{" "}
                          {copy("Used", "已用")}{" "}
                          <span className="font-medium text-foreground">
                            {formattedWaterfallCreditsConsumed}
                          </span>
                        </>
                      )}
                      {" "}
                      <span className="text-muted-foreground">/</span>{" "}
                      {copy("Balance", "余额")}{" "}
                      <span className="font-medium text-foreground">
                        {formattedBalance}
                      </span>{" "}
                    </div>
                  </div>
                </div>

                {!isBatchActive ? (
                  <div className="mx-auto flex min-h-[560px] max-w-3xl flex-col justify-center px-4 py-10">
                    <div className="mb-5 text-center">
                      <h2 className="font-serif text-2xl font-semibold tracking-tight">
                        {copy(
                          "What world will you flood with art?",
                          "你想让哪个世界充满图像？"
                        )}
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {copy("One prompt, endless creations", "一个提示词，瀑布生成灵感")}
                      </p>
                    </div>
                    <form
                      onSubmit={handleBatchSubmit}
                      onPaste={handleChatPaste}
                      className="space-y-3"
                    >
                      {chatAttachments.length > 0 && (
                        <div className="flex flex-wrap justify-center gap-2">
                          {chatAttachments.map((item, index) => (
                            <button
                              type="button"
                              key={`${item.file.name}-${item.previewUrl}`}
                              className="relative h-12 w-12 overflow-hidden rounded-md border bg-muted"
                              onClick={() => removeChatAttachment(index)}
                              title={copy("Remove reference image", "移除参考图片")}
                            >
                              <Image
                                src={item.previewUrl}
                                alt={item.file.name}
                                fill
                                sizes="48px"
                                className="object-cover"
                                unoptimized
                              />
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => batchImageInputRef.current?.click()}
                          disabled={chatAttachments.length >= MAX_EDIT_IMAGES}
                          title={copy("Attach reference image", "添加参考图片")}
                        >
                          <ImagePlus className="h-4 w-4" />
                        </Button>
                        <Textarea
                          value={batchPrompt}
                          onChange={(event) =>
                            setBatchPrompt(event.target.value)
                          }
                          placeholder={copy(
                            "Describe the images you want to generate...",
                            "描述你想生成的图片..."
                          )}
                          rows={1}
                          className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-0 py-2 text-base shadow-none focus-visible:ring-0"
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault();
                              event.currentTarget.form?.requestSubmit();
                            }
                          }}
                        />
                        <Button
                          type="submit"
                          size="icon-sm"
                          disabled={!batchPrompt.trim()}
                          title={copy("Start waterfall", "开始瀑布流")}
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                        <input
                          ref={batchImageInputRef}
                          type="file"
                          multiple
                          accept={IMAGE_ACCEPT}
                          className="sr-only"
                          onChange={(event) => {
                            void addBatchAttachments(event.target.files);
                            event.target.value = "";
                          }}
                        />
                      </div>
                    </form>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {chatSuggestions.map((suggestion) => (
                        <Button
                          key={suggestion}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="max-w-full"
                          onClick={() => handleBatchSuggestion(suggestion)}
                          title={suggestion}
                        >
                          <span className="truncate">
                            {suggestion.length > 40
                              ? `${suggestion.slice(0, 40)}...`
                              : suggestion}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div
                    ref={batchScrollRef}
                    className="max-h-[760px] overflow-y-auto p-3"
                  >
                    <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
                      {batchCards.map((card) => (
                        <div
                          key={card.id}
                          className={`mb-3 break-inside-avoid overflow-hidden rounded-lg border bg-muted/30 ${
                            card.state === "error"
                              ? "border-destructive/30"
                              : "border-border"
                          }`}
                          style={
                            card.aspectRatio &&
                            (card.state === "loading" ||
                              (card.state === "image" && !card.imageUrl))
                              ? { aspectRatio: card.aspectRatio }
                              : undefined
                          }
                        >
                          {card.state === "loading" && !card.imageUrl && (
                            <div className="flex h-full min-h-40 items-center justify-center text-muted-foreground">
                              <Loader2 className="h-5 w-5 animate-spin" />
                            </div>
                          )}

                          {card.imageUrl && (
                            <button
                              type="button"
                              className="group relative block w-full bg-muted"
                              onClick={() => {
                                if (card.generationId) {
                                  setSelectedRecentId(card.generationId);
                                }
                              }}
                              title={copy("Open image preview", "打开图片预览")}
                            >
                              <Image
                                src={card.imageUrl}
                                alt={card.prompt}
                                width={640}
                                height={640}
                                className="h-auto w-full object-cover"
                                unoptimized={
                                  !shouldOptimizeStoredImage(card.imageUrl)
                                }
                              />
                              {card.state === "loading" && (
                                <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm">
                                  <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                                  {copy("Streaming", "流式生成中")}
                                </span>
                              )}
                              {card.state === "image" && (
                                <div className="absolute inset-x-2 bottom-2 hidden items-center justify-end gap-1 group-hover:flex">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="icon-xs"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      saveBatchCardToRecent(card);
                                    }}
                                    disabled={card.saved}
                                    title={copy("Save to recent", "保存到最近生成")}
                                  >
                                    <Save className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    asChild
                                    variant="secondary"
                                    size="icon-xs"
                                    title={copy("Download", "下载")}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <a
                                      href={card.imageUrl}
                                      download
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <Download className="h-3 w-3" />
                                    </a>
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="icon-xs"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (card.generationId) {
                                        setSelectedRecentId(card.generationId);
                                      }
                                    }}
                                    title={copy("Fullscreen", "全屏")}
                                  >
                                    <Maximize2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              )}
                            </button>
                          )}

                          {card.state === "text" && (
                            <div className="p-3 text-sm leading-relaxed">
                              {renderThinkingBlock(card.streamThinking)}
                              <p className="whitespace-pre-wrap break-words">
                                {card.text || card.streamText || ""}
                              </p>
                            </div>
                          )}

                          {card.state === "error" && (
                            <div className="space-y-3 p-3 text-sm text-destructive">
                              <p className="break-words">
                                {card.error || copy("Generation failed", "生成失败")}
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  triggerBatchGeneration({
                                    retryCardId: card.id,
                                  })
                                }
                              >
                                <RefreshCcw className="h-4 w-4" />
                                {copy("Retry", "重试")}
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div
                      ref={batchLoadTriggerRef}
                      className="flex h-20 flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
                    >
                      {isBatchLoadingMore ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {copy("Generating...", "生成中...")}
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-4 w-4" />
                          {copy("Scroll to generate more", "继续下拉生成更多")}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {loading && (
        <div
          className="mb-10 flex max-w-2xl items-center justify-center overflow-hidden rounded-lg border border-dashed bg-muted/30"
          style={{
            aspectRatio: `${loadingDimensions.width} / ${loadingDimensions.height}`,
          }}
        >
          {streamingPreviewUrl ? (
            <div className="relative h-full w-full">
              <Image
                src={streamingPreviewUrl}
                alt={copy("Streaming preview", "流式预览")}
                fill
                sizes="(max-width: 1024px) 100vw, 768px"
                className="object-contain"
                unoptimized={!shouldOptimizeStoredImage(streamingPreviewUrl)}
              />
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {copy("Previewing stream", "正在预览流式结果")}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">
                {copy("Generating your image...", "正在生成图片...")}
              </p>
            </div>
          )}
        </div>
      )}

      {result && !loading && (
        <section className="mb-10 space-y-4">
          <button
            type="button"
            onClick={() =>
              setSelectedRecentId(
                recent.some((item) => item.id === result.generationId)
                  ? result.generationId
                  : null
              )
            }
            className="group relative mx-auto block w-full max-w-2xl overflow-hidden rounded-lg border bg-muted"
            style={{
              aspectRatio: `${parseImageSize(result.size)?.width || width} / ${parseImageSize(result.size)?.height || height}`,
            }}
            title={copy("Open image preview", "打开图片预览")}
          >
            <Image
              src={result.imageUrl}
              alt={result.prompt}
              fill
              sizes="(max-width: 1024px) 100vw, 768px"
              className="object-contain"
              unoptimized={!shouldOptimizeStoredImage(result.imageUrl)}
            />
            <span className="absolute right-2 top-2 rounded bg-background/90 px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-sm transition-opacity hover:opacity-100 focus:opacity-100 group-hover:opacity-100">
              <Eye className="mr-1 inline h-3.5 w-3.5" />
              {copy("Preview", "预览")}
            </span>
          </button>
          <div className="mx-auto max-w-2xl space-y-3">
            <p className="text-sm text-muted-foreground">{result.prompt}</p>
            <p className="text-xs text-muted-foreground">
              {copy("Model", "模型")}:{" "}
              <span className="font-medium text-foreground">
                {result.model}
              </span>{" "}
              · {copy("Resolution", "分辨率")}:{" "}
              <span className="font-medium text-foreground">{result.size}</span>
            </p>
            {result.revisedPrompt && result.revisedPrompt !== result.prompt && (
              <p className="text-xs italic text-muted-foreground">
                {copy("Revised", "优化提示词")}: {result.revisedPrompt}
              </p>
            )}
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <a
                  href={result.imageUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {copy("Download", "下载")}
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={useResultAsReference}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                {copy("Edit this", "编辑这张")}
              </Button>
            </div>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="font-serif text-xl font-semibold">
              {copy("Recent", "最近生成")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {activeMode === "chat"
                ? copy(
                    "Click an image to attach it as the next chat reference.",
                    "点击图片可作为下一轮对话参考图。"
                  )
                : activeMode === "image"
                  ? copy(
                      "Click an image to add or remove it as a reference.",
                      "点击图片可添加或移除为参考图。"
                    )
                  : copy(
                      "Click an image to open the full preview.",
                      "点击图片打开完整预览。"
                    )}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {recent.map((g) => {
              const selectedForEdit = editImages.some(
                (item) => item.sourceId === g.id
              );
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`group relative aspect-square overflow-hidden rounded-md border bg-muted text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    selectedForEdit && activeMode === "image"
                      ? "border-primary ring-2 ring-primary/50"
                      : "hover:border-foreground/40"
                  }`}
                  title={
                    activeMode === "chat"
                      ? copy("Attach to chat", "添加到对话")
                      : activeMode === "image"
                        ? copy("Use as reference image", "作为参考图片")
                        : copy("Open image preview", "打开图片预览")
                  }
                  onClick={() => handleRecentClick(g)}
                  disabled={!g.imageUrl}
                >
                  {g.imageUrl ? (
                    <Image
                      src={g.imageUrl}
                      alt={g.prompt}
                      fill
                      sizes="80px"
                      className="object-cover transition-transform group-hover:scale-105"
                      unoptimized={!shouldOptimizeStoredImage(g.imageUrl)}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImagePlus className="h-6 w-6" />
                    </div>
                  )}
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    {activeMode === "chat" ? (
                      <>
                        <MessageSquare className="mr-1 h-3 w-3" />
                        {copy("Attach to chat", "添加到对话")}
                      </>
                    ) : activeMode === "image" ? (
                      selectedForEdit ? (
                        <>
                          <Check className="mr-1 h-3 w-3" />
                          {copy("Selected", "已选择")}
                        </>
                      ) : (
                        <>
                          <ImagePlus className="mr-1 h-3 w-3" />
                          {copy("Use as reference", "作为参考图")}
                        </>
                      )
                    ) : (
                      <>
                        <Eye className="mr-1 h-3 w-3" />
                        {copy("Preview", "预览")}
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {selectedRecent && (
        <ImageLightbox
          generation={selectedRecent as LightboxGeneration}
          imageUrl={selectedRecent.imageUrl}
          open={selectedRecentId !== null}
          onClose={() => setSelectedRecentId(null)}
          onDelete={(id) => {
            setRecent((prev) => prev.filter((item) => item.id !== id));
            setEditImages((prev) => {
              const next = prev.filter((item) => item.sourceId !== id);
              for (const item of prev) {
                if (item.sourceId === id) revokePreview(item.previewUrl);
              }
              return next;
            });
          }}
        />
      )}
    </div>
  );
}
