import {
  normalizeImageBackground,
  normalizeOutputCompression,
  normalizeOutputFormat,
} from "./output-format";
import {
  AUTO_IMAGE_SIZE,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  getImageModel,
} from "./resolution";
import {
  resolvePromptImageReferences,
  withResponsesImageReferenceInstructions,
} from "./responses-native-state";
import type {
  ApiConfig,
  EditImageParams,
  GenerateImageParams,
  ImageBackground,
  ImageInputFile,
  ImageModeration,
  ImageOutputFormat,
  ImageQuality,
  ThinkingLevel,
} from "./types";

type ResponsesImageRequest = {
  model: string;
  input: Array<{
    type: "message";
    role: "user";
    content: Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; image_url: string }
      | { type: "input_image"; file_id: string }
    >;
  }>;
  tools: Array<{
    type: "image_generation";
    action: "generate" | "edit";
    model: string;
    partial_images?: number;
    size?: string;
    quality?: ImageQuality;
    moderation?: ImageModeration;
    output_format?: ImageOutputFormat;
    output_compression?: number;
    background?: ImageBackground;
    input_image_mask?: { image_url: string };
  }>;
  tool_choice: { type: "image_generation" };
  stream: boolean;
  store: boolean;
  parallel_tool_calls: boolean;
  reasoning: {
    effort: ThinkingLevel;
    summary: "auto";
  };
  include: string[];
  instructions?: string;
};

const RESPONSES_IMAGE_INSTRUCTIONS =
  "You are an image generation assistant. Use the image_generation tool to satisfy the user's request and return the generated image.";

const RESPONSES_IMAGE_ORIGINAL_PROMPT_INSTRUCTIONS =
  "Use the user's original image prompt exactly as written for image generation. Do not rewrite, expand, translate, polish, or optimize the prompt before calling the image_generation tool.";

function getDataUrl(image: ImageInputFile) {
  if (image.url?.startsWith("http://") || image.url?.startsWith("https://")) {
    return image.url;
  }
  return `data:${image.type || "image/png"};base64,${image.data.toString("base64")}`;
}

function getInputImageContent(image: ImageInputFile) {
  if (image.imageFileId?.trim()) {
    return { type: "input_image" as const, file_id: image.imageFileId.trim() };
  }
  return { type: "input_image" as const, image_url: getDataUrl(image) };
}

function referenceTag(refId: string, prompt?: string) {
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

function getEditReferenceLabel(
  refId: string,
  imageNumber: number,
  prompt?: string
) {
  return `@图${imageNumber} / ${referenceTag(refId, prompt)}`;
}

function getEditImageContent(images: ImageInputFile[]) {
  return images.flatMap((image, index) => {
    const imageNumber = index + 1;
    const refId = `edit-reference-${imageNumber}`;
    const label = getEditReferenceLabel(refId, imageNumber, image.name);
    return [
      {
        type: "input_text" as const,
        text: `The next source image is labeled ${label}. Use this label when the user refers to this exact source image.`,
      },
      getInputImageContent(image),
      {
        type: "input_text" as const,
        text: `The source image above is ${label}.`,
      },
    ];
  });
}

function getResponsesModel(config: ApiConfig, model?: string) {
  const requested = model?.trim();
  if (requested && !requested.startsWith("gpt-image-")) {
    return requested;
  }
  const configured = config.model?.trim();
  if (configured && !configured.startsWith("gpt-image-")) {
    return configured;
  }
  return "gpt-5.4-mini";
}

function getToolModel(config: ApiConfig, model?: string) {
  return getImageModel(model, config.model) || DEFAULT_IMAGE_MODEL;
}

function getPrompt(params: GenerateImageParams | EditImageParams) {
  if (params.promptOptimization === false) {
    return params.prompt;
  }
  return params.apiPrompt || params.prompt;
}

function getInstructions(params: GenerateImageParams | EditImageParams) {
  if (params.promptOptimization !== false) return undefined;
  return RESPONSES_IMAGE_ORIGINAL_PROMPT_INSTRUCTIONS;
}

function normalizeQuality(quality?: string): ImageQuality | undefined {
  if (
    quality === "low" ||
    quality === "medium" ||
    quality === "high" ||
    quality === "auto"
  ) {
    return quality;
  }
  return undefined;
}

function normalizeModeration(moderation?: string): ImageModeration | undefined {
  if (moderation === "auto" || moderation === "low") return moderation;
  return undefined;
}

function normalizeThinking(thinking?: string): ThinkingLevel {
  if (
    thinking === "minimal" ||
    thinking === "none" ||
    thinking === "low" ||
    thinking === "medium" ||
    thinking === "high" ||
    thinking === "xhigh"
  ) {
    return thinking;
  }
  return "medium";
}

export function buildResponsesImageGenerationRequest(
  config: ApiConfig,
  params: GenerateImageParams
): ResponsesImageRequest {
  const prompt = getPrompt(params);
  const size = params.size || DEFAULT_IMAGE_SIZE;
  const tool: ResponsesImageRequest["tools"][number] = {
    type: "image_generation",
    action: "generate",
    model: getToolModel(config, params.model),
    partial_images: 2,
  };

  if (size && size !== AUTO_IMAGE_SIZE) tool.size = size;
  const quality = normalizeQuality(params.quality);
  if (quality) tool.quality = quality;
  const moderation = normalizeModeration(params.moderation);
  if (moderation) tool.moderation = moderation;
  const outputFormat = normalizeOutputFormat(params.outputFormat);
  if (outputFormat) tool.output_format = outputFormat;
  const outputCompression = normalizeOutputCompression(
    params.outputCompression
  );
  if (outputCompression !== undefined) {
    tool.output_compression = outputCompression;
  }
  const background = normalizeImageBackground(params.background);
  if (background) tool.background = background;

  const instructions = getInstructions(params) || RESPONSES_IMAGE_INSTRUCTIONS;

  return {
    model: getResponsesModel(config, params.gptModel),
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
    tools: [tool],
    tool_choice: { type: "image_generation" },
    stream: true,
    store: false,
    parallel_tool_calls: true,
    reasoning: { effort: normalizeThinking(params.thinking), summary: "auto" },
    include: ["reasoning.encrypted_content"],
    instructions,
  };
}

export function buildResponsesImageEditRequest(
  config: ApiConfig,
  params: EditImageParams
): ResponsesImageRequest {
  const prompt = resolvePromptImageReferences({
    prompt: getPrompt(params),
    images: params.images,
  }).prompt.replace(/current-reference-/g, "edit-reference-");
  const size = params.size || DEFAULT_IMAGE_SIZE;
  const tool: ResponsesImageRequest["tools"][number] = {
    type: "image_generation",
    action: "edit",
    model: getToolModel(config, params.model),
    partial_images: 2,
  };

  if (size && size !== AUTO_IMAGE_SIZE) {
    tool.size = size;
  }
  const quality = normalizeQuality(params.quality);
  if (quality) tool.quality = quality;
  const moderation = normalizeModeration(params.moderation);
  if (moderation) tool.moderation = moderation;
  const outputFormat = normalizeOutputFormat(params.outputFormat);
  if (outputFormat) tool.output_format = outputFormat;
  const outputCompression = normalizeOutputCompression(
    params.outputCompression
  );
  if (outputCompression !== undefined) {
    tool.output_compression = outputCompression;
  }
  const background = normalizeImageBackground(params.background);
  if (background) tool.background = background;
  if (params.mask) {
    tool.input_image_mask = { image_url: getDataUrl(params.mask) };
  }

  const instructions = withResponsesImageReferenceInstructions(
    getInstructions(params) || RESPONSES_IMAGE_INSTRUCTIONS
  );

  return {
    model: getResponsesModel(config, params.gptModel),
    input: [
      {
        type: "message",
        role: "user",
        content: [
          ...getEditImageContent(params.images),
          { type: "input_text", text: `User edit request: ${prompt}` },
        ],
      },
    ],
    tools: [tool],
    tool_choice: { type: "image_generation" },
    stream: true,
    store: false,
    parallel_tool_calls: true,
    reasoning: { effort: normalizeThinking(params.thinking), summary: "auto" },
    include: ["reasoning.encrypted_content"],
    instructions,
  };
}
