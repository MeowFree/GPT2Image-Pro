import type {
  ChatHistoryMessage,
  ImageInputFile,
  ImageOutputFormat,
  ResponsesInputFile,
  ResponsesPreviousResponseState,
  StickyBackendMemberState,
} from "./types";
import { getInputImageUrl } from "./input-image-url";

export type ResponsesRequestContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; file_id?: never }
  | { type: "input_image"; file_id: string; image_url?: never }
  | { type: "input_file"; filename: string; file_data: string }
  | { type: "input_file"; file_id: string }
  | { type: "input_file"; file_url: string }
  | { type: "output_text"; text: string };

export type ResponsesRequestMessage = {
  role: "user" | "assistant";
  content: ResponsesRequestContent[];
};

export type ResponsesFunctionCallOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

export type ResponsesFunctionCallInput = {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
};

export type ResponsesRequestInputItem =
  | ResponsesRequestMessage
  | ResponsesFunctionCallInput
  | ResponsesFunctionCallOutput;

export type ResponsesImageReference = {
  refId: string;
  imageUrl?: string;
  imageFileId?: string;
  backendMember?: StickyBackendMemberState;
  prompt?: string;
};

export type ResponsesResultWithOutputLike = {
  responseText?: string;
  responseThinking?: string;
  responseAgent?: string;
  imageOutputs?: Array<{
    imageBase64?: string;
    imageUrl?: string;
  }>;
};

export const RESPONSES_IMAGE_REFERENCE_INSTRUCTIONS = [
  "Image reference labels:",
  "- Images may be accompanied by labels such as @图1, @第N轮图M, or XML tags like <ref id=\"...\" />.",
  "- Treat these labels as identifiers for the adjacent or previously stored input image, not as visible text to render into the image.",
  "- When the user mentions one of these labels, use the matching image as the visual reference for the request.",
  "- Do not ask the user to upload a labeled image again when the image is present in the current input or native Responses conversation state.",
].join("\n");

export function withResponsesImageReferenceInstructions(instructions: string) {
  return `${instructions}\n\n${RESPONSES_IMAGE_REFERENCE_INSTRUCTIONS}`;
}

export function sameStickyBackendMember(
  left: StickyBackendMemberState | undefined,
  right: StickyBackendMemberState | undefined
) {
  if (!left || !right) return false;
  return (
    left.type === right.type &&
    left.id === right.id &&
    left.accountBackend === right.accountBackend
  );
}

export const getDataUrl = getInputImageUrl;

export function imageBase64ToDataUrl(
  base64: string,
  outputFormat?: ImageOutputFormat
) {
  const mime =
    outputFormat === "jpeg"
      ? "image/jpeg"
      : outputFormat === "webp"
        ? "image/webp"
        : "image/png";
  return `data:${mime};base64,${base64}`;
}

export function isUsableInputImageUrl(url: string) {
  return (
    url.startsWith("data:image/") ||
    url.startsWith("http://") ||
    url.startsWith("https://")
  );
}

export function getInputImageContent(
  source: { imageUrl?: string; imageFileId?: string } | undefined
): Extract<ResponsesRequestContent, { type: "input_image" }> | null {
  const imageFileId = source?.imageFileId?.trim();
  if (imageFileId) return { type: "input_image", file_id: imageFileId };
  const imageUrl = source?.imageUrl?.trim();
  if (imageUrl && isUsableInputImageUrl(imageUrl)) {
    return { type: "input_image", image_url: imageUrl };
  }
  return null;
}

export function getInputFileContent(
  file: ResponsesInputFile
): Extract<ResponsesRequestContent, { type: "input_file" }> {
  const fileId = file.fileId?.trim();
  if (fileId) return { type: "input_file", file_id: fileId };
  const fileUrl = file.url?.trim();
  if (fileUrl?.startsWith("http://") || fileUrl?.startsWith("https://")) {
    return { type: "input_file", file_url: fileUrl };
  }
  const mime = file.type || "application/octet-stream";
  return {
    type: "input_file",
    filename: file.name || "attachment",
    file_data: `data:${mime};base64,${file.data.toString("base64")}`,
  };
}

export function referenceTag(refId: string, prompt?: string) {
  const safePrompt = prompt
    ?.slice(0, 500)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return safePrompt
    ? `<ref id="${refId}" prompt="${safePrompt}" />`
    : `<ref id="${refId}" />`;
}

function getReferenceAlias(refId: string) {
  const current = refId.match(/^current-reference-(\d+)$/);
  if (current) return `@图${current[1]}`;
  const history = refId.match(/^history-round-(\d+)-image-(\d+)$/);
  if (history) return `@第${history[1]}轮图${history[2]}`;
  const agentDraft = refId.match(/^agent-round-(\d+)-draft-(\d+)$/);
  if (agentDraft) return `Agent round ${agentDraft[1]} draft ${agentDraft[2]}`;
  const file = refId.match(/^current-file-(\d+)$/);
  if (file) return `@文件${file[1]}`;
  return refId;
}

function referenceLabel(refId: string, prompt?: string) {
  const alias = getReferenceAlias(refId);
  const tag = referenceTag(refId, prompt);
  return alias === refId ? tag : `${alias} / ${tag}`;
}

function addLabeledImageContent(
  content: ResponsesRequestContent[],
  imageContent: Extract<ResponsesRequestContent, { type: "input_image" }>,
  refId: string,
  prompt?: string
) {
  const label = referenceLabel(refId, prompt);
  content.push({
    type: "input_text",
    text: `The next image is labeled ${label}. Use this label when the user refers to this exact image later.`,
  });
  content.push(imageContent);
  content.push({
    type: "input_text",
    text: `The image above is ${label}.`,
  });
}

function buildTextOnlyReferenceNote(reference: ResponsesImageReference) {
  return `Use the previously stored image labeled ${referenceLabel(
    reference.refId,
    reference.prompt
  )} when the user refers to it. The image itself is already present in the native Responses conversation state; do not require it to be uploaded again.`;
}

export function getNextAssistantImageRoundIndex(
  history: ChatHistoryMessage[] | undefined
) {
  let roundIndex = 0;
  for (const message of history || []) {
    if (message.role !== "assistant" || message.error) continue;
    if (getHistoryImageVariants(message).length) roundIndex += 1;
  }
  return roundIndex + 1;
}

export function buildGeneratedImageReferenceInstruction(params: {
  roundIndex: number;
  existingImageCount?: number;
}) {
  const existingImageCount = Math.max(0, params.existingImageCount || 0);
  const nextImageIndex = existingImageCount + 1;
  const lines = [
    "Reference labels for this Chat/Agent image reply:",
    existingImageCount > 0
      ? `Images already generated in this reply are labeled @第${params.roundIndex}轮图1 through @第${params.roundIndex}轮图${existingImageCount}, with matching ref ids history-round-${params.roundIndex}-image-1 through history-round-${params.roundIndex}-image-${existingImageCount}.`
      : "",
    `Any new image outputs generated by this response are labeled in output order starting at @第${params.roundIndex}轮图${nextImageIndex}, with matching ref ids starting at history-round-${params.roundIndex}-image-${nextImageIndex}.`,
    "These labels are for future user references in the same native Responses conversation.",
  ].filter(Boolean);
  return lines.join("\n");
}

function historyVariantText(message: ChatHistoryMessage) {
  const variants = message.variants || [];
  const variant = variants[message.activeVariant || 0] || variants[0];
  const imageNote = variant?.imageUrl
    ? `\nGenerated image: ${variant.imageUrl}`
    : "";
  return `${variant?.text || message.text || ""}${imageNote}`;
}

export function getHistoryVariant(message: ChatHistoryMessage) {
  const variants = message.variants || [];
  return variants[message.activeVariant || 0] || variants[0];
}

function getHistoryImageVariants(message: ChatHistoryMessage) {
  return (message.variants || []).filter(
    (variant) => variant.imageUrl || variant.imageFileId
  );
}

function getHistoryImagePrompt(variant: {
  text?: string;
  imageUrl?: string;
  size?: string;
}) {
  return (
    variant.text ||
    (variant.imageUrl
      ? `Generated image${variant.size ? ` at ${variant.size}` : ""}: ${
          variant.imageUrl
        }`
      : undefined)
  );
}

export function collectHistoryImageReferences(
  history: ChatHistoryMessage[] | undefined,
  options?: { currentBackendMember?: StickyBackendMemberState }
) {
  const references: ResponsesImageReference[] = [];
  let roundIndex = 0;

  for (const message of history || []) {
    if (message.role !== "assistant" || message.error) continue;
    const imageVariants = getHistoryImageVariants(message);
    if (!imageVariants.length) continue;
    roundIndex += 1;

    for (const [imageIndex, variant] of imageVariants.entries()) {
      references.push({
        refId: `history-round-${roundIndex}-image-${imageIndex + 1}`,
        imageUrl: variant.imageUrl,
        imageFileId: sameStickyBackendMember(
          variant.backendMember,
          options?.currentBackendMember
        )
          ? variant.imageFileId
          : undefined,
        backendMember: variant.backendMember,
        prompt: getHistoryImagePrompt(variant),
      });
    }
  }

  return references;
}

export function resolvePromptImageReferences(params: {
  prompt: string;
  images?: ImageInputFile[];
  history?: ChatHistoryMessage[];
  currentBackendMember?: StickyBackendMemberState;
}) {
  const historyReferences = collectHistoryImageReferences(params.history, {
    currentBackendMember: params.currentBackendMember,
  });
  const historyByPosition = new Map<string, ResponsesImageReference>();
  for (const reference of historyReferences) {
    const match = reference.refId.match(/^history-round-(\d+)-image-(\d+)$/);
    if (!match) continue;
    historyByPosition.set(`${match[1]}:${match[2]}`, reference);
  }

  const referencedHistory = new Map<string, ResponsesImageReference>();
  let prompt = params.prompt.replace(
    /@(?:第)?(\d+)轮图(\d+)/g,
    (text, roundNumber: string, imageNumber: string) => {
      const reference = historyByPosition.get(`${roundNumber}:${imageNumber}`);
      if (!reference) return text;
      referencedHistory.set(reference.refId, reference);
      return referenceTag(reference.refId);
    }
  );

  prompt = prompt.replace(/@图(\d+)/g, (text, imageNumber: string) => {
    const imageIndex = Number(imageNumber) - 1;
    const image = params.images?.[imageIndex];
    if (!image) return text;
    return referenceTag(`current-reference-${imageIndex + 1}`, image.name);
  });

  return {
    prompt,
    historyImageReferences: Array.from(referencedHistory.values()),
  };
}

export function getLatestResponsesPreviousResponseState(
  history: ChatHistoryMessage[] | undefined
): ResponsesPreviousResponseState | undefined {
  for (let index = (history || []).length - 1; index >= 0; index -= 1) {
    const message = history?.[index];
    if (!message || message.role !== "assistant" || message.error) continue;
    const state = getHistoryVariant(message)?.responsesPreviousResponse;
    if (state?.responseId) return state;
    return undefined;
  }
  return undefined;
}

export function buildCurrentResponsesContent(
  prompt: string,
  images: ImageInputFile[] | undefined,
  files?: ResponsesInputFile[],
  options?: {
    includeImageEntities?: boolean;
    extraImageReferences?: ResponsesImageReference[];
    includeExtraImageEntities?: boolean;
    generatedImageReferenceInstruction?: string;
  }
): ResponsesRequestContent[] {
  const content: ResponsesRequestContent[] = [];
  if (options?.includeImageEntities === false) {
    content.push({ type: "input_text", text: prompt });
    if (options.generatedImageReferenceInstruction) {
      content.push({
        type: "input_text",
        text: options.generatedImageReferenceInstruction,
      });
    }
    return content;
  }

  for (const [index, image] of (images || []).entries()) {
    const refId = `current-reference-${index + 1}`;
    const imageContent = getInputImageContent({
      imageUrl: image.imageFileId ? undefined : getDataUrl(image),
      imageFileId: image.imageFileId,
    });
    if (imageContent) {
      addLabeledImageContent(content, imageContent, refId, image.name);
    }
  }
  for (const [index, file] of (files || []).entries()) {
    content.push(getInputFileContent(file));
    content.push({
      type: "input_text",
      text: referenceTag(`current-file-${index + 1}`, file.name),
    });
  }
  for (const reference of options?.extraImageReferences || []) {
    if (options?.includeExtraImageEntities === false) {
      content.push({
        type: "input_text",
        text: buildTextOnlyReferenceNote(reference),
      });
      continue;
    }
    const imageContent = getInputImageContent(reference);
    if (!imageContent) continue;
    addLabeledImageContent(content, imageContent, reference.refId, reference.prompt);
  }
  content.push({ type: "input_text", text: prompt });
  if (options?.generatedImageReferenceInstruction) {
    content.push({
      type: "input_text",
      text: options.generatedImageReferenceInstruction,
    });
  }
  return content;
}

export function buildResponsesInput(
  prompt: string,
  images: ImageInputFile[] | undefined,
  files: ResponsesInputFile[] | undefined,
  history: ChatHistoryMessage[] | undefined,
  options?: {
    includeHistoryImageEntities?: boolean;
    extraCurrentImageReferences?: ResponsesImageReference[];
    generatedImageReferenceInstruction?: string;
    currentBackendMember?: StickyBackendMemberState;
  }
): ResponsesRequestInputItem[] {
  const input: ResponsesRequestInputItem[] = [];
  const includeHistoryImageEntities =
    options?.includeHistoryImageEntities !== false;
  let assistantImageRoundIndex = 0;

  for (const message of history || []) {
    if (message.error) continue;

    if (message.role === "user") {
      const content: ResponsesRequestContent[] = [
        { type: "input_text", text: message.text || "" },
      ];
      if (includeHistoryImageEntities) {
        for (const [index, imageUrl] of (message.imageUrls || []).entries()) {
          const refId = `history-user-${input.length + 1}-image-${index + 1}`;
          const imageContent = getInputImageContent({ imageUrl });
          if (imageContent) {
            addLabeledImageContent(content, imageContent, refId);
          }
        }
      }
      input.push({ role: "user", content });
      continue;
    }

    const text = historyVariantText(message).trim();
    if (text) {
      input.push({
        role: "assistant",
        content: [{ type: "output_text", text }],
      });
    }
    const imageVariants = getHistoryImageVariants(message);
    if (imageVariants.length && includeHistoryImageEntities) {
      assistantImageRoundIndex += 1;
    }
    for (const [imageIndex, variant] of imageVariants.entries()) {
      if (!includeHistoryImageEntities) continue;
      const refId = `history-round-${assistantImageRoundIndex}-image-${
        imageIndex + 1
      }`;
      const imageContent = getInputImageContent({
        imageUrl: variant.imageUrl,
        imageFileId: sameStickyBackendMember(
          variant.backendMember,
          options?.currentBackendMember
        )
          ? variant.imageFileId
          : undefined,
      });
      if (!imageContent) continue;
      input.push({
        role: "user",
        content: (() => {
          const content: ResponsesRequestContent[] = [];
          addLabeledImageContent(
            content,
            imageContent,
            refId,
            getHistoryImagePrompt(variant) || text
          );
          return content;
        })(),
      });
    }
  }

  input.push({
    role: "user",
    content: buildCurrentResponsesContent(prompt, images, files, {
      extraImageReferences: options?.extraCurrentImageReferences,
      generatedImageReferenceInstruction:
        options?.generatedImageReferenceInstruction,
    }),
  });

  return input;
}

export function buildAgentContinuationInput(params: {
  baseInput: ResponsesRequestInputItem[];
  previousResult: ResponsesResultWithOutputLike;
  currentRound: number;
  maxRounds: number;
  outputFormat?: ImageOutputFormat;
  historyRoundIndex?: number;
  includeImageEntities?: boolean;
  functionCallItems?: Array<
    ResponsesFunctionCallInput | ResponsesFunctionCallOutput
  >;
}) {
  const input: ResponsesRequestInputItem[] = [
    ...params.baseInput,
    ...(params.functionCallItems || []),
  ];
  const previousContext = [
    params.previousResult.responseThinking?.trim()
      ? `Previous reasoning summary:\n${params.previousResult.responseThinking.trim()}`
      : "",
    params.previousResult.responseAgent?.trim()
      ? `Previous tool log:\n${params.previousResult.responseAgent.trim()}`
      : "",
    params.previousResult.responseText?.trim()
      ? `Previous assistant note:\n${params.previousResult.responseText.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (previousContext) {
    input.push({
      role: "assistant",
      content: [{ type: "output_text", text: previousContext }],
    });
  }

  const previousImages = (params.previousResult.imageOutputs || []).filter(
    (item) => item.imageBase64 || item.imageUrl
  );
  if (params.includeImageEntities !== false) {
    for (const [index, image] of previousImages.entries()) {
      const imageUrl =
        image.imageUrl ||
        (image.imageBase64
          ? imageBase64ToDataUrl(image.imageBase64, params.outputFormat)
          : undefined);
      const imageContent = getInputImageContent({ imageUrl });
      if (!imageContent) continue;
      const refId = `agent-round-${params.currentRound}-draft-${index + 1}`;
      const content: ResponsesRequestContent[] = [];
      addLabeledImageContent(
        content,
        imageContent,
        refId,
        `Draft image from Agent round ${params.currentRound}, version ${
          index + 1
        }. Use it as visual reference for critique and possible refinement.`
      );
      input.push({ role: "user", content });
    }
  } else if (previousImages.length) {
    input.push({
      role: "user",
      content: [
        {
          type: "input_text",
          text: `The previous native Responses output already contains ${previousImages.length} draft image(s) from Agent round ${params.currentRound}. Refer to them as ${previousImages
            .map((_, index) =>
              referenceLabel(`agent-round-${params.currentRound}-draft-${index + 1}`)
            )
            .join(", ")} without asking the user to upload them again.`,
        },
      ],
    });
  }

  const statusLines = [
    `Agent round ${params.currentRound} of ${params.maxRounds} finished.`,
    previousImages.length
      ? `It produced ${previousImages.length} draft image(s). Inspect the draft and either generate an improved next version or stop if the task is complete.`
      : "It produced no image. If the user requested an image and no required input is missing, execute image_generation now.",
    "When continuing, make the next action concrete. Do not repeat the same research summary.",
  ];
  if (params.historyRoundIndex) {
    statusLines.push(
      buildGeneratedImageReferenceInstruction({
        roundIndex: params.historyRoundIndex,
        existingImageCount: previousImages.length,
      })
    );
  }
  input.push({
    role: "user",
    content: [{ type: "input_text", text: statusLines.join("\n") }],
  });
  return input;
}

export type ContinueGenerationFunctionCallLike = {
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
};

function parseContinueGenerationReason(rawArguments: string | undefined) {
  if (!rawArguments?.trim()) return undefined;
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Record<string, unknown>).reason === "string"
    ) {
      return ((parsed as Record<string, unknown>).reason as string)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
    }
  } catch {
    return undefined;
  }
  return rawArguments.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function getContinueGenerationFunctionCalls(
  outputItems: ContinueGenerationFunctionCallLike[] | undefined
) {
  return (outputItems || []).flatMap((item) => {
    if (
      item.type !== "function_call" ||
      item.name !== "continue_generation" ||
      !item.call_id
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        callId: item.call_id,
        name: item.name,
        arguments: item.arguments || "{}",
        reason: parseContinueGenerationReason(item.arguments),
      },
    ];
  });
}

export function buildContinueGenerationFunctionCallItems(params: {
  outputItems: ContinueGenerationFunctionCallLike[] | undefined;
  includeFunctionCallInputs: boolean;
}): Array<ResponsesFunctionCallInput | ResponsesFunctionCallOutput> {
  return getContinueGenerationFunctionCalls(params.outputItems).flatMap(
    (call) => {
      const output: ResponsesFunctionCallOutput = {
        type: "function_call_output",
        call_id: call.callId,
        output: JSON.stringify({
          ok: true,
          continue: true,
          reason:
            call.reason ||
            "The Agent loop accepted this continue_generation request.",
        }),
      };
      if (!params.includeFunctionCallInputs) return [output];
      return [
        {
          type: "function_call",
          id: call.id,
          call_id: call.callId,
          name: call.name,
          arguments: call.arguments,
        },
        output,
      ];
    }
  );
}

export function isPreviousResponseStateError(error: string | undefined) {
  const message = error?.toLowerCase() || "";
  const referencesPreviousResponse =
    message.includes("previous_response_id") ||
    message.includes("previous response") ||
    message.includes("previous_response");
  return (
    referencesPreviousResponse ||
    (message.includes("response") && message.includes("not found")) ||
    (referencesPreviousResponse &&
      (message.includes("invalid_value") ||
        message.includes("invalid_request") ||
        message.includes("not found")))
  );
}

export function shouldEnableResponsesPreviousResponse(params: {
  settingEnabled: boolean;
  rawResponsesBody?: unknown;
  currentBackendMember?: StickyBackendMemberState;
  files?: ResponsesInputFile[];
}) {
  return Boolean(
    params.settingEnabled &&
      !params.rawResponsesBody &&
      !params.files?.length &&
      params.currentBackendMember?.accountBackend === "responses"
  );
}

export function isResponsesStoreUnsupportedError(error: string | undefined) {
  const message = error?.toLowerCase() || "";
  return message.includes("store") && message.includes("false");
}

export function resolveResponsesNativeState(params: {
  enabled: boolean;
  currentBackendMember?: StickyBackendMemberState;
  history?: ChatHistoryMessage[];
}) {
  const previousState = params.enabled
    ? getLatestResponsesPreviousResponseState(params.history)
    : undefined;
  const canUsePreviousResponseId =
    params.enabled &&
    Boolean(previousState?.responseId) &&
    sameStickyBackendMember(previousState?.backendMember, params.currentBackendMember);
  return {
    previousState,
    canUsePreviousResponseId,
    previousResponseId: canUsePreviousResponseId
      ? previousState?.responseId
      : undefined,
  };
}

export function buildPreviousResponseFallbackRequestBody(
  requestBody: Record<string, unknown>,
  fallbackInput: ResponsesRequestInputItem[]
): Record<string, unknown> & {
  input: ResponsesRequestInputItem[];
  previous_response_id: undefined;
} {
  return {
    ...requestBody,
    input: fallbackInput,
    previous_response_id: undefined,
  };
}

export function buildResponsesStoreFalseFallbackRequestBody(
  requestBody: Record<string, unknown>
): Record<string, unknown> & {
  store: false;
  previous_response_id: undefined;
} {
  return {
    ...requestBody,
    store: false,
    previous_response_id: undefined,
  };
}
