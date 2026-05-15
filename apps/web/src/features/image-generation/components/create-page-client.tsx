"use client";

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
  Coins,
  Download,
  Eraser,
  Eye,
  ImagePlus,
  Loader2,
  MessageSquare,
  RefreshCcw,
  Save,
  Send,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import Image from "next/image";
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
  creditsConsumed?: number;
  results?: ImageApiResult[];
};

type ImageStreamEvent =
  | {
      type: "partial_image";
      index?: number;
      partial_image_index?: number;
      b64_json?: string;
      url?: string;
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
  generationId: string;
  imageUrl: string;
  prompt: string;
  model: string;
  size: string;
  revisedPrompt?: string;
  responseText?: string;
  creditsConsumed?: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: ChatAttachmentPreview[];
  variants?: ChatVariant[];
  error?: string;
  createdAt: string;
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

const MAX_EDIT_IMAGES = 16;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_EDIT_REQUEST_BYTES = 75 * 1024 * 1024;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
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
const CHAT_STORAGE_KEY = "gpt2image_chat_messages_v1";
const CHAT_CONTEXT_MESSAGE_LIMIT = 8;

interface CreatePageClientProps {
  balance: number;
  recentGenerations: RecentGeneration[];
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

function getVariantSummary(variants?: ChatVariant[]) {
  if (!variants?.length) return "No image output.";
  return variants
    .map((variant, index) => {
      const revised =
        variant.revisedPrompt && variant.revisedPrompt !== variant.prompt
          ? ` Revised prompt: ${variant.revisedPrompt}`
          : "";
      return `Image ${index + 1}: ${variant.size}, model ${variant.model}.${revised}`;
    })
    .join("\n");
}

function buildChatContextPrompt(messages: ChatMessage[], prompt: string) {
  const contextMessages = messages
    .filter((message) => message.role === "user" || message.variants?.length)
    .slice(-CHAT_CONTEXT_MESSAGE_LIMIT);

  if (contextMessages.length === 0) return prompt;

  const context = contextMessages
    .map((message) => {
      if (message.role === "user") {
        const imageNote = message.attachments?.length
          ? ` (${message.attachments.length} reference image(s) attached)`
          : "";
        return `User${imageNote}: ${message.text}`;
      }
      return `Assistant: ${message.text}\n${getVariantSummary(message.variants)}`;
    })
    .join("\n\n");

  return [
    "Use the conversation context below to preserve intent, style, subjects, and requested changes.",
    "Conversation context:",
    context,
    "Current user request:",
    prompt,
  ].join("\n\n");
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
}: CreatePageClientProps) {
  const [activeMode, setActiveMode] = useState<ActiveMode>("text");
  const [prompt, setPrompt] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [chatPrompt, setChatPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
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
  const [editBatchCount, setEditBatchCount] = useState(1);
  const [editModel, setEditModel] = useState("default");
  const [useFirstImageSize, setUseFirstImageSize] = useState(true);
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
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const didLoadChatRef = useRef(false);
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
    ? getImageCreditCost(effectiveEditSize)
    : getImageCreditCost();
  const editBatchCreditCost = editImageCreditCost * editBatchCount;
  const chatEditImageCreditCost = chatEffectiveEditSize
    ? getImageCreditCost(chatEffectiveEditSize)
    : getImageCreditCost();
  const chatEditBatchCreditCost = chatEditImageCreditCost * editBatchCount;
  const sizeCheck = useMemo(() => validateImageSize(size), [size]);
  const customEditSizeCheck = useMemo(
    () => validateImageSize(customEditSize),
    [customEditSize]
  );
  const busy = isGenerating || isEditing || isChatGenerating;
  const firstPreviewUrl = editImages[0]?.previewUrl || null;
  const chatFirstPreviewUrl = chatAttachments[0]?.previewUrl || null;
  const editDisplaySize = effectiveEditSize || "Reference image";
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

  const clearStreamingPreview = () => {
    setStreamingPreviewUrl(null);
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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
      if (!raw) {
        didLoadChatRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as ChatMessage[];
      if (Array.isArray(parsed)) {
        setChatMessages(
          parsed.filter(
            (message) =>
              message &&
              (message.role === "user" || message.role === "assistant") &&
              typeof message.text === "string"
          )
        );
      }
    } catch {
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
    } finally {
      didLoadChatRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!didLoadChatRef.current) return;
    try {
      const persistedMessages = chatMessages.slice(-80).map((message) => ({
        ...message,
        attachments: message.attachments?.filter(
          (attachment) => !attachment.previewUrl.startsWith("blob:")
        ),
      }));
      window.localStorage.setItem(
        CHAT_STORAGE_KEY,
        JSON.stringify(persistedMessages)
      );
    } catch {
      /* ignore local storage quota errors */
    }
  }, [chatMessages]);

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
      creditsConsumed?: number;
    },
    resultPrompt: string,
    fallbackSize = size
  ): ChatVariant | null => {
    if (!data.imageUrl || !data.generationId) return null;

    const generationId = data.generationId;
    const imageUrl = data.imageUrl;
    const model = data.model || DEFAULT_IMAGE_MODEL;
    const resultSize = data.size || fallbackSize;
    const nextResult: ResultState = {
      generationId,
      imageUrl,
      prompt: resultPrompt,
      model,
      size: resultSize,
    };
    if (data.revisedPrompt) nextResult.revisedPrompt = data.revisedPrompt;

    setResult(nextResult);
    setBalance((b) => Math.max(0, b - (data.creditsConsumed || 0)));
    setRecent((prev) => [
      {
        id: generationId,
        prompt: resultPrompt,
        revisedPrompt: data.revisedPrompt || null,
        model,
        size: resultSize,
        creditsConsumed: data.creditsConsumed || 0,
        status: "completed",
        imageUrl,
        createdAt: new Date().toISOString(),
      },
      ...prev.slice(0, 5),
    ]);

    return {
      generationId,
      imageUrl,
      prompt: resultPrompt,
      model,
      size: resultSize,
      revisedPrompt: data.revisedPrompt,
      responseText: data.responseText,
      creditsConsumed: data.creditsConsumed,
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
    setBalance((b) => Math.max(0, b - creditsConsumed));
  };

  const showGenerationError = (
    message: string,
    options?: { creditsConsumed?: number }
  ) => {
    syncChargedCredits(options?.creditsConsumed);

    if (message.toLowerCase().includes("insufficient credits")) {
      toast.error("Insufficient credits", {
        description: "You don't have enough credits to generate an image.",
        action: {
          label: "Top up",
          onClick: () => {
            window.location.href = "/dashboard/credits/buy";
          },
        },
      });
      return;
    }

    toast.error("Generation failed", { description: message });
  };

  const addChatAttachments = (files: FileList | File[] | null) => {
    const imageFiles = Array.from(files || []);
    if (!imageFiles.length) return;

    const accepted: ChatAttachment[] = [];
    for (const file of imageFiles) {
      if (!isImageFile(file)) {
        toast.error("Unsupported file type", {
          description: "Use PNG, JPEG, or WebP images.",
        });
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error("File too large", {
          description: `${file.name} exceeds 25MB.`,
        });
        continue;
      }
      accepted.push({ file, previewUrl: URL.createObjectURL(file) });
    }

    if (!accepted.length) return;

    setChatAttachments((prev) => {
      const slots = MAX_EDIT_IMAGES - prev.length;
      if (slots <= 0) {
        for (const item of accepted) {
          revokePreview(item.previewUrl);
        }
        toast.error(`Attach up to ${MAX_EDIT_IMAGES} reference images`);
        return prev;
      }

      const next = accepted.slice(0, slots);
      for (const item of accepted.slice(slots)) {
        revokePreview(item.previewUrl);
      }
      if (accepted.length > slots) {
        toast.error(`Only ${slots} more reference image(s) can be added`);
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
      toast.success("Reference image is already attached");
      return;
    }
    if (chatAttachments.length >= MAX_EDIT_IMAGES) {
      toast.error(`Attach up to ${MAX_EDIT_IMAGES} reference images`);
      return;
    }

    try {
      const item = await urlToEditImageFile(imageUrl, name, sourceId);
      setChatAttachments((prev) => [...prev, item]);
      setActiveMode("chat");
      toast.success("Reference image attached to chat");
    } catch (error) {
      toast.error("Failed to attach image", {
        description:
          error instanceof Error ? error.message : "Could not load image.",
      });
    }
  };

  const attachResultToChat = async (variant?: ChatVariant) => {
    const imageUrl = variant?.imageUrl || result?.imageUrl;
    const id = variant?.generationId || result?.generationId;
    if (!imageUrl || !id) return;
    await attachImageUrlToChat(imageUrl, `gpt2image-${id}`, id);
  };

  const handleChatPaste = (event: React.ClipboardEvent) => {
    if (activeMode !== "chat" || isChatGenerating) return;

    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file && isImageFile(file)));

    if (!files.length) return;
    event.preventDefault();
    addChatAttachments(files);
  };

  const handleChatSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chatPrompt.trim()) {
      toast.error("Please enter a message");
      return;
    }

    const currentPrompt = chatPrompt.trim();
    const attachments = chatAttachments.map((item) => ({
      ...item,
      file: cloneFile(item.file),
    }));
    const isEditRequest = attachments.length > 0;
    const fallbackSize = isEditRequest ? chatEffectiveEditSize : size;
    const count = isEditRequest ? editBatchCount : batchCount;
    const cost = isEditRequest ? chatEditBatchCreditCost : textBatchCreditCost;

    if (balance < cost) {
      showGenerationError("Insufficient credits");
      return;
    }
    if (!isEditRequest && !sizeCheck.valid) {
      toast.error("Invalid resolution", { description: sizeCheck.message });
      return;
    }
    if (isEditRequest && !fallbackSize) {
      toast.error("Waiting for reference image size", {
        description: "The first reference image is still loading.",
      });
      return;
    }
    if (isEditRequest && !useFirstImageSize && !customEditSizeCheck.valid) {
      toast.error("Invalid resolution", {
        description: customEditSizeCheck.message,
      });
      return;
    }
    if (isEditRequest) {
      const totalUploadSize = attachments.reduce(
        (total, item) => total + item.file.size,
        0
      );
      if (totalUploadSize > MAX_EDIT_REQUEST_BYTES) {
        toast.error("Upload is too large", {
          description: `Reference images total ${formatMegabytes(totalUploadSize)}. Keep the total under ${formatMegabytes(MAX_EDIT_REQUEST_BYTES)}.`,
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
    const apiPrompt = buildChatContextPrompt(
      conversationBeforeSend,
      currentPrompt
    );

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
        text: isEditRequest ? "Editing image..." : "Generating image...",
        createdAt: new Date().toISOString(),
      },
    ]);
    setChatPrompt("");
    setResult(null);
    clearStreamingPreview();
    setIsChatGenerating(true);
    scrollChatToBottom();

    try {
      const formData = new FormData();
      formData.append("prompt", currentPrompt);
      formData.append("apiPrompt", apiPrompt);
      formData.append("quality", quality);
      formData.append("moderation", moderation);
      formData.append("size", fallbackSize || size);
      formData.append("count", String(count));
      formData.append("stream", "true");
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

      const data = await readImageStreamResponse(response);
      if (!response.ok || data.error) {
        showGenerationError(data.error || `API error: ${response.status}`, {
          creditsConsumed: data.creditsConsumed,
        });
        setChatMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  text: "Generation failed",
                  error: data.error || `API error: ${response.status}`,
                }
              : message
          )
        );
        return;
      }

      const variants = addSuccessfulResults(
        data,
        currentPrompt,
        fallbackSize || size
      );
      if (variants.length === 0) {
        const message = "API returned no image data";
        showGenerationError(message);
        setChatMessages((prev) =>
          prev.map((item) =>
            item.id === assistantMessageId
              ? { ...item, text: "Generation failed", error: message }
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
                  data.responseText ||
                  (variants.length > 1
                    ? `${variants.length} images generated`
                    : "Image generated"),
                variants,
              }
            : message
        )
      );
      clearChatAttachments();
      toast.success(
        variants.length > 1
          ? `${variants.length} images generated`
          : "Image generated"
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.";
      toast.error("Generation failed", { description: message });
      setChatMessages((prev) =>
        prev.map((item) =>
          item.id === assistantMessageId
            ? { ...item, text: "Generation failed", error: message }
            : item
        )
      );
    } finally {
      setIsChatGenerating(false);
      clearStreamingPreview();
      scrollChatToBottom();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }
    if (balance < textBatchCreditCost) {
      showGenerationError("Insufficient credits");
      return;
    }
    if (!sizeCheck.valid) {
      toast.error("Invalid resolution", { description: sizeCheck.message });
      return;
    }
    const currentPrompt = prompt.trim();
    setResult(null);
    clearStreamingPreview();
    setIsGenerating(true);
    try {
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: currentPrompt,
          size,
          stream: true,
          count: batchCount,
          moderation,
        }),
      });
      const data = await readImageStreamResponse(response);

      if (!response.ok || data.error) {
        showGenerationError(data.error || `API error: ${response.status}`, {
          creditsConsumed: data.creditsConsumed,
        });
        return;
      }

      const generatedCount = addSuccessfulResults(data, currentPrompt).length;
      toast.success(
        generatedCount > 1
          ? `${generatedCount} images generated`
          : "Image generated"
      );
    } catch (error) {
      toast.error("Generation failed", {
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred.",
      });
    } finally {
      setIsGenerating(false);
      clearStreamingPreview();
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPrompt.trim()) {
      toast.error("Please enter an edit prompt");
      return;
    }
    if (editImages.length === 0) {
      toast.error("Upload at least one source image");
      return;
    }
    if (maskPoints.length > 0 && !maskFile) {
      toast.error("Save the mask before editing");
      return;
    }
    if (!effectiveEditSize) {
      toast.error("Waiting for source image size", {
        description: "The first source image is still loading.",
      });
      return;
    }
    if (!useFirstImageSize && !customEditSizeCheck.valid) {
      toast.error("Invalid resolution", {
        description: customEditSizeCheck.message,
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
    if (totalUploadSize > MAX_EDIT_REQUEST_BYTES) {
      toast.error("Upload is too large", {
        description: `Source images and mask total ${formatMegabytes(totalUploadSize)}. Keep the total under ${formatMegabytes(MAX_EDIT_REQUEST_BYTES)}.`,
      });
      return;
    }

    const formData = new FormData();
    formData.append("prompt", editPrompt.trim());
    formData.append("quality", quality);
    if (editModel !== "default") {
      formData.append("model", editModel);
    }
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
        generatedCount > 1 ? `${generatedCount} images edited` : "Image edited"
      );
    } catch (error) {
      toast.error("Generation failed", {
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred.",
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
        toast.error("Unsupported file type", {
          description: "Use PNG, JPEG, or WebP images.",
        });
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error("File too large", {
          description: `${file.name} exceeds 25MB.`,
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
        toast.error(`Upload up to ${MAX_EDIT_IMAGES} source images`);
        return prev;
      }
      const next = accepted.slice(0, slots);
      for (const item of accepted.slice(slots)) {
        revokePreview(item.previewUrl);
      }
      if (accepted.length > slots) {
        toast.error(`Only ${slots} more source image(s) can be added`);
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
      toast.error("Mask must be a PNG file");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Mask is too large", {
        description: "Maximum size is 25MB.",
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
        toast.error("Mask dimensions must match the first source image", {
          description: `Expected ${firstImageSize.width}x${firstImageSize.height}.`,
        });
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
      toast.error("Failed to load mask image");
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
      toast.error("Draw a mask area first");
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
        toast.error("Failed to save mask");
        return;
      }
      const file = new File([blob], "generated-mask.png", {
        type: "image/png",
      });
      setMaskFile((prev) => {
        if (prev) revokePreview(prev.previewUrl);
        return { file, previewUrl };
      });
      toast.success("Mask saved");
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
      toast.success("Result added as reference image");
    } catch (error) {
      toast.error("Failed to use result as reference", {
        description:
          error instanceof Error ? error.message : "Could not load image.",
      });
    }
  };

  const selectRecentAsReference = async (generation: RecentGeneration) => {
    if (!generation.imageUrl) {
      toast.error("This image is not available yet");
      return;
    }

    const existingIndex = editImages.findIndex(
      (item) => item.sourceId === generation.id
    );
    if (existingIndex >= 0) {
      removeImage(existingIndex);
      toast.success("Reference image removed");
      return;
    }

    if (editImages.length >= MAX_EDIT_IMAGES) {
      toast.error(`Upload up to ${MAX_EDIT_IMAGES} source images`);
      return;
    }

    try {
      const item = await urlToEditImageFile(
        generation.imageUrl,
        `gpt2image-${generation.id}`,
        generation.id
      );
      setEditImages((prev) => [...prev, item]);
      toast.success("Reference image selected");
    } catch (error) {
      toast.error("Failed to use image as reference", {
        description:
          error instanceof Error ? error.message : "Could not load image.",
      });
    }
  };

  const openRecentPreview = (generation: RecentGeneration) => {
    if (!generation.imageUrl) {
      toast.error("This image is not available yet");
      return;
    }
    setSelectedRecentId(generation.id);
  };

  const handleRecentClick = (generation: RecentGeneration) => {
    if (activeMode === "chat") {
      if (!generation.imageUrl) {
        toast.error("This image is not available yet");
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

  const resolutionControls = (
    <div className="space-y-4 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div>
            <span className="text-sm font-medium text-foreground">
              Resolution
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              Width and height must be multiples of 16.
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
                    {preset.label}
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
                Width
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
                Height
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
                htmlFor="batch-count"
                className="text-xs font-medium text-muted-foreground"
              >
                Batch
              </label>
              <Select
                value={String(batchCount)}
                onValueChange={(value) => setBatchCount(Number(value))}
                disabled={busy}
              >
                <SelectTrigger id="batch-count" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BATCH_OPTIONS.map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {count} image{count > 1 ? "s" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="image-moderation"
                className="text-xs font-medium text-muted-foreground"
              >
                API moderation
              </label>
              <Select
                value={moderation}
                onValueChange={(value) =>
                  setModeration(value as ImageModeration)
                }
                disabled={busy}
              >
                <SelectTrigger id="image-moderation" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODERATION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
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
            Balance:{" "}
            <span className="font-medium text-foreground">{balance}</span> ·
            Cost:{" "}
            <span className="font-medium text-foreground">
              {textBatchCreditCost}
            </span>
            {batchCount > 1 ? ` for ${batchCount}` : "/image"}
          </span>
        </div>
      </div>
      {!sizeCheck.valid && (
        <p className="text-xs text-destructive">{sizeCheck.message}</p>
      )}
    </div>
  );

  const chatGenerationControls = (
    <div className="space-y-3 rounded-lg border border-border bg-background p-4">
      <div>
        <span className="text-sm font-medium text-foreground">
          Generate controls
        </span>
        <p className="mt-1 text-xs text-muted-foreground">
          Used when no reference image is attached.
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="chat-size-preset"
          className="text-xs font-medium text-muted-foreground"
        >
          Resolution
        </label>
        <Select
          value={
            IMAGE_RESOLUTION_PRESETS.some((preset) => preset.value === size)
              ? size
              : "custom"
          }
          onValueChange={(value) => {
            if (value !== "custom") {
              applyPreset(value);
            }
          }}
          disabled={busy}
        >
          <SelectTrigger id="chat-size-preset" className="w-full">
            <SelectValue placeholder={size} />
          </SelectTrigger>
          <SelectContent>
            {IMAGE_RESOLUTION_PRESETS.map((preset) => (
              <SelectItem key={preset.value} value={preset.value}>
                {preset.label} · {preset.detail}
              </SelectItem>
            ))}
            <SelectItem value="custom">Custom · {size}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <div className="space-y-1.5">
          <label
            htmlFor="chat-image-width"
            className="text-xs font-medium text-muted-foreground"
          >
            Width
          </label>
          <Input
            id="chat-image-width"
            type="number"
            min={256}
            max={MAX_IMAGE_DIMENSION}
            step={IMAGE_DIMENSION_STEP}
            value={width}
            onChange={(event) => setWidth(Number(event.target.value) || 0)}
            disabled={busy}
          />
        </div>
        <div className="pb-2 text-muted-foreground">x</div>
        <div className="space-y-1.5">
          <label
            htmlFor="chat-image-height"
            className="text-xs font-medium text-muted-foreground"
          >
            Height
          </label>
          <Input
            id="chat-image-height"
            type="number"
            min={256}
            max={MAX_IMAGE_DIMENSION}
            step={IMAGE_DIMENSION_STEP}
            value={height}
            onChange={(event) => setHeight(Number(event.target.value) || 0)}
            disabled={busy}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="chat-generate-batch"
          className="text-xs font-medium text-muted-foreground"
        >
          Batch
        </label>
        <Select
          value={String(batchCount)}
          onValueChange={(value) => setBatchCount(Number(value))}
          disabled={busy}
        >
          <SelectTrigger id="chat-generate-batch" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BATCH_OPTIONS.map((count) => (
              <SelectItem key={count} value={String(count)}>
                {count} image{count > 1 ? "s" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!sizeCheck.valid && (
        <p className="text-xs text-destructive">{sizeCheck.message}</p>
      )}
    </div>
  );

  const loading = busy;

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-12">
      <header className="mb-8 space-y-2">
        <h1 className="font-serif text-3xl font-semibold tracking-tight md:text-4xl">
          Create
        </h1>
        <p className="text-sm text-muted-foreground">
          Generate a new image from text, or transform uploaded images with a
          prompt.
        </p>
      </header>

      <Tabs
        value={activeMode}
        onValueChange={(value) => setActiveMode(value as ActiveMode)}
        className="mb-10"
      >
        <TabsList className="mb-4 border border-border bg-muted/40">
          <TabsTrigger value="text">
            <Wand2 className="h-4 w-4" />
            Text to image
          </TabsTrigger>
          <TabsTrigger value="image">
            <ImagePlus className="h-4 w-4" />
            Image to image
          </TabsTrigger>
          <TabsTrigger value="chat">
            <MessageSquare className="h-4 w-4" />
            Chat
          </TabsTrigger>
        </TabsList>

        <TabsContent value="text" className="mt-0">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image you want to create..."
              rows={5}
              disabled={isGenerating}
              className="resize-none border-input bg-background text-base"
            />
            {resolutionControls}
            <div className="flex justify-end">
              <Button type="submit" disabled={isGenerating || !prompt.trim()}>
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating
                  </>
                ) : (
                  <>
                    <ImagePlus className="mr-2 h-4 w-4" />
                    Generate
                  </>
                )}
              </Button>
            </div>
          </form>
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
              placeholder="Describe how to transform the uploaded image..."
              rows={5}
              disabled={isEditing}
              className="resize-none border-input bg-background text-base"
            />

            <div className="space-y-4 rounded-lg border border-border bg-background p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-sm font-medium text-foreground">
                    Source images
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Upload PNG, JPEG, or WebP. Up to {MAX_EDIT_IMAGES} images,
                    {` ${formatMegabytes(MAX_EDIT_REQUEST_BYTES)} total.`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isEditing || editImages.length >= MAX_EDIT_IMAGES}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload images
                </Button>
                {editImages.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={clearEditImages}
                    disabled={isEditing}
                  >
                    Clear all
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
                        alt={item.file.name || `Source image ${index + 1}`}
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
                      Optional mask
                    </span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Draw on the first source image or upload a PNG mask.
                      Transparent areas are edited.
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
                      {maskEditorOpen ? "Close editor" : "Draw mask"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => maskInputRef.current?.click()}
                      disabled={isEditing || !firstImageSize}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Upload mask
                    </Button>
                    {maskFile && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={clearMask}
                        disabled={isEditing}
                      >
                        Clear
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
                        alt="Source image for mask editing"
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
                        Brush {maskBrushSize}px
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
                          Clear mask
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={saveDrawnMask}
                          disabled={isEditing || maskPoints.length === 0}
                        >
                          <Save className="mr-2 h-4 w-4" />
                          Save mask
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {maskFile && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Saved mask
                    </p>
                    <div className="relative aspect-video w-44 overflow-hidden rounded-md border bg-muted">
                      <Image
                        src={maskFile.previewUrl}
                        alt="Mask preview"
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
                    Model
                  </label>
                  <Select
                    value={editModel}
                    onValueChange={setEditModel}
                    disabled={isEditing}
                  >
                    <SelectTrigger id="edit-model" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EDIT_MODEL_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="edit-quality"
                    className="text-sm font-medium text-foreground"
                  >
                    Quality
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
                          {option.label}
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
                    Batch
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
                          {count} image{count > 1 ? "s" : ""}
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
                      Use first image resolution
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        Default for edits. Turn off for outpainting or canvas
                        extension.
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
                                {preset.label}
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
                            Width
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
                            Height
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
                          {customEditSizeCheck.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                  <p>
                    Output size:{" "}
                    <span className="font-medium text-foreground">
                      {editDisplaySize}
                    </span>
                  </p>
                  <p className="mt-1">
                    Cost:{" "}
                    <span className="font-medium text-foreground">
                      {editBatchCreditCost}
                    </span>
                    {editBatchCount > 1 ? ` for ${editBatchCount}` : "/image"}
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
                    Editing
                  </>
                ) : (
                  <>
                    <ImagePlus className="mr-2 h-4 w-4" />
                    Edit image
                  </>
                )}
              </Button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="chat" className="mt-0">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex min-h-[620px] flex-col overflow-hidden rounded-lg border border-border bg-background">
              <div
                ref={chatMessagesRef}
                className="flex-1 space-y-5 overflow-y-auto px-4 py-4"
              >
                {chatMessages.length === 0 ? (
                  <div className="flex min-h-[320px] flex-col items-center justify-center text-center text-muted-foreground">
                    <MessageSquare className="mb-3 h-8 w-8" />
                    <p className="text-sm font-medium text-foreground">
                      Start a visual conversation
                    </p>
                    <p className="mt-1 max-w-md text-xs">
                      Send a prompt to generate images. Attach a reference image
                      or click a recent image to edit in auto mode.
                    </p>
                  </div>
                ) : (
                  chatMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${
                        message.role === "user"
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[88%] rounded-lg border px-3 py-3 text-sm ${
                          message.role === "user"
                            ? "border-primary/20 bg-primary text-primary-foreground"
                            : "border-border bg-muted/35 text-foreground"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">
                          {message.text}
                        </p>

                        {message.attachments &&
                          message.attachments.length > 0 && (
                            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                              {message.attachments.map((attachment) => (
                                <div
                                  key={attachment.id}
                                  className="relative aspect-square overflow-hidden rounded-md border bg-muted"
                                >
                                  <Image
                                    src={attachment.previewUrl}
                                    alt={attachment.name}
                                    fill
                                    sizes="96px"
                                    className="object-cover"
                                    unoptimized
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                        {message.error && (
                          <p className="mt-2 text-xs text-destructive">
                            {message.error}
                          </p>
                        )}

                        {message.variants && message.variants.length > 0 && (
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            {message.variants.map((variant) => (
                              <div
                                key={variant.generationId}
                                className="overflow-hidden rounded-md border bg-background"
                              >
                                <button
                                  type="button"
                                  className="group relative block w-full bg-muted"
                                  style={{
                                    aspectRatio: `${
                                      parseImageSize(variant.size)?.width ||
                                      defaultDimensions.width
                                    } / ${
                                      parseImageSize(variant.size)?.height ||
                                      defaultDimensions.height
                                    }`,
                                  }}
                                  onClick={() =>
                                    setSelectedRecentId(variant.generationId)
                                  }
                                  title="Open image preview"
                                >
                                  <Image
                                    src={variant.imageUrl}
                                    alt={variant.prompt}
                                    fill
                                    sizes="(max-width: 768px) 80vw, 320px"
                                    className="object-contain"
                                    unoptimized
                                  />
                                  <span className="absolute right-2 top-2 rounded bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                                    <Eye className="mr-1 inline h-3 w-3" />
                                    Preview
                                  </span>
                                </button>
                                <div className="flex flex-wrap gap-2 p-2">
                                  <Button asChild variant="outline" size="xs">
                                    <a
                                      href={variant.imageUrl}
                                      download
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <Download className="h-3 w-3" />
                                      Download
                                    </a>
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    onClick={() => attachResultToChat(variant)}
                                  >
                                    <RefreshCcw className="h-3 w-3" />
                                    Edit next
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}

                {isChatGenerating && (
                  <div className="flex justify-start">
                    <div className="rounded-lg border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                      Working...
                    </div>
                  </div>
                )}
              </div>

              <form
                onSubmit={handleChatSubmit}
                onPaste={handleChatPaste}
                className="border-t border-border p-3"
              >
                {chatAttachments.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {chatAttachments.map((item, index) => (
                      <div
                        key={`${item.file.name}-${item.previewUrl}`}
                        className="group relative h-16 w-16 overflow-hidden rounded-md border bg-muted"
                      >
                        <Image
                          src={item.previewUrl}
                          alt={item.file.name || `Reference ${index + 1}`}
                          fill
                          sizes="64px"
                          className="object-cover"
                          unoptimized
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-xs"
                          className="absolute right-1 top-1"
                          onClick={() => removeChatAttachment(index)}
                          disabled={isChatGenerating}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Textarea
                    value={chatPrompt}
                    onChange={(event) => setChatPrompt(event.target.value)}
                    placeholder={
                      chatAttachments.length > 0
                        ? "Describe the edit for the attached reference..."
                        : "Describe the image you want..."
                    }
                    rows={3}
                    disabled={isChatGenerating}
                    className="min-h-20 resize-none border-input bg-background text-base"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => chatImageInputRef.current?.click()}
                      disabled={
                        isChatGenerating ||
                        chatAttachments.length >= MAX_EDIT_IMAGES
                      }
                      title="Attach reference images"
                    >
                      <ImagePlus className="h-4 w-4" />
                    </Button>
                    <Button
                      type="submit"
                      size="icon"
                      disabled={isChatGenerating || !chatPrompt.trim()}
                      title="Send"
                    >
                      {isChatGenerating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <input
                    ref={chatImageInputRef}
                    type="file"
                    multiple
                    accept={IMAGE_ACCEPT}
                    className="sr-only"
                    onChange={(event) => {
                      addChatAttachments(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </div>
              </form>
            </div>

            <aside className="space-y-4">
              <div className="space-y-3 rounded-lg border border-border bg-background p-4">
                <div>
                  <span className="text-sm font-medium text-foreground">
                    Auto mode
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    No reference generates a new image. Attached references use
                    edit automatically.
                  </p>
                </div>

                <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                  <p>
                    Current action:{" "}
                    <span className="font-medium text-foreground">
                      {chatAttachments.length > 0 ? "Edit" : "Generate"}
                    </span>
                  </p>
                  <p className="mt-1">
                    Batch:{" "}
                    <span className="font-medium text-foreground">
                      {chatAttachments.length > 0 ? editBatchCount : batchCount}
                    </span>
                  </p>
                  <p className="mt-1">
                    Cost:{" "}
                    <span className="font-medium text-foreground">
                      {chatAttachments.length > 0
                        ? chatEditBatchCreditCost
                        : textBatchCreditCost}
                    </span>
                  </p>
                </div>

                {chatAttachments.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={clearChatAttachments}
                    disabled={isChatGenerating}
                  >
                    <X className="mr-2 h-4 w-4" />
                    Clear references
                  </Button>
                )}
              </div>

              {chatGenerationControls}

              <div className="space-y-3 rounded-lg border border-border bg-background p-4">
                <div>
                  <span className="text-sm font-medium text-foreground">
                    Edit controls
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used when references are attached.
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="chat-edit-batch"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Edit batch
                  </label>
                  <Select
                    value={String(editBatchCount)}
                    onValueChange={(value) => setEditBatchCount(Number(value))}
                    disabled={isChatGenerating}
                  >
                    <SelectTrigger id="chat-edit-batch" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BATCH_OPTIONS.map((count) => (
                        <SelectItem key={count} value={String(count)}>
                          {count} image{count > 1 ? "s" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <label
                  htmlFor="chat-use-source-size"
                  className="flex cursor-pointer items-start gap-2 text-sm font-medium text-foreground"
                >
                  <Checkbox
                    id="chat-use-source-size"
                    checked={useFirstImageSize}
                    onCheckedChange={(checked) =>
                      setUseFirstImageSize(checked === true)
                    }
                    disabled={isChatGenerating}
                    className="mt-0.5"
                  />
                  <span>
                    Use reference resolution
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {chatEffectiveEditSize || "Attach a reference image"}
                    </span>
                  </span>
                </label>
              </div>
            </aside>
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
                alt="Streaming preview"
                fill
                sizes="(max-width: 1024px) 100vw, 768px"
                className="object-contain"
                unoptimized
              />
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Previewing stream
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Generating your image...</p>
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
            title="Open image preview"
          >
            <Image
              src={result.imageUrl}
              alt={result.prompt}
              fill
              sizes="(max-width: 1024px) 100vw, 768px"
              className="object-contain"
              unoptimized
            />
            <span className="absolute right-2 top-2 rounded bg-background/90 px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-sm transition-opacity hover:opacity-100 focus:opacity-100 group-hover:opacity-100">
              <Eye className="mr-1 inline h-3.5 w-3.5" />
              Preview
            </span>
          </button>
          <div className="mx-auto max-w-2xl space-y-3">
            <p className="text-sm text-muted-foreground">{result.prompt}</p>
            <p className="text-xs text-muted-foreground">
              Model:{" "}
              <span className="font-medium text-foreground">
                {result.model}
              </span>{" "}
              · Resolution:{" "}
              <span className="font-medium text-foreground">{result.size}</span>
            </p>
            {result.revisedPrompt && result.revisedPrompt !== result.prompt && (
              <p className="text-xs italic text-muted-foreground">
                Revised: {result.revisedPrompt}
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
                  Download
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={useResultAsReference}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Edit this
              </Button>
            </div>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="font-serif text-xl font-semibold">Recent</h2>
            <p className="text-xs text-muted-foreground">
              {activeMode === "chat"
                ? "Click an image to attach it as the next chat reference."
                : activeMode === "image"
                  ? "Click an image to add or remove it as a reference."
                  : "Click an image to open the full preview."}
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
                      ? "Attach to chat"
                      : activeMode === "image"
                        ? "Use as reference image"
                        : "Open image preview"
                  }
                  onClick={() => handleRecentClick(g)}
                  disabled={!g.imageUrl}
                >
                  {g.imageUrl ? (
                    <Image
                      src={g.imageUrl}
                      alt={g.prompt}
                      fill
                      className="object-cover transition-transform group-hover:scale-105"
                      unoptimized
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
                        Attach to chat
                      </>
                    ) : activeMode === "image" ? (
                      selectedForEdit ? (
                        <>
                          <Check className="mr-1 h-3 w-3" />
                          Selected
                        </>
                      ) : (
                        <>
                          <ImagePlus className="mr-1 h-3 w-3" />
                          Use as reference
                        </>
                      )
                    ) : (
                      <>
                        <Eye className="mr-1 h-3 w-3" />
                        Preview
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
