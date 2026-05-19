import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  getImageModel,
} from "./resolution";
import type {
  ApiConfig,
  EditImageParams,
  GenerateImageParams,
  ImageInputFile,
  ImageModeration,
  ImageQuality,
} from "./types";

type ResponsesImageRequest = {
  model: string;
  input: Array<{
    type: "message";
    role: "user";
    content: Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; image_url: string }
    >;
  }>;
  tools: Array<{
    type: "image_generation";
    action: "generate" | "edit";
    model: string;
    size?: string;
    quality?: ImageQuality;
    moderation?: ImageModeration;
    input_image_mask?: { image_url: string };
  }>;
  tool_choice: { type: "image_generation" };
  stream: boolean;
  store: boolean;
  parallel_tool_calls: boolean;
  instructions?: string;
};

function getDataUrl(image: ImageInputFile) {
  if (image.url?.startsWith("http://") || image.url?.startsWith("https://")) {
    return image.url;
  }
  return `data:${image.type || "image/png"};base64,${image.data.toString("base64")}`;
}

function getResponsesModel(config: ApiConfig) {
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
  return "Use the user's original image prompt exactly as written for image generation. Do not rewrite, expand, translate, polish, or optimize the prompt before calling the image_generation tool.";
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
  };

  if (size && size !== "auto") tool.size = size;
  const quality = normalizeQuality(params.quality);
  if (quality) tool.quality = quality;
  const moderation = normalizeModeration(params.moderation);
  if (moderation) tool.moderation = moderation;

  return {
    model: getResponsesModel(config),
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
    ...(getInstructions(params)
      ? { instructions: getInstructions(params) }
      : {}),
  };
}

export function buildResponsesImageEditRequest(
  config: ApiConfig,
  params: EditImageParams
): ResponsesImageRequest {
  const prompt = getPrompt(params);
  const size = params.size || DEFAULT_IMAGE_SIZE;
  const tool: ResponsesImageRequest["tools"][number] = {
    type: "image_generation",
    action: "edit",
    model: getToolModel(config, params.model),
  };

  if (size && size !== "auto") {
    tool.size = size;
  }
  const quality = normalizeQuality(params.quality);
  if (quality) tool.quality = quality;
  const moderation = normalizeModeration(params.moderation);
  if (moderation) tool.moderation = moderation;
  if (params.mask) {
    tool.input_image_mask = { image_url: getDataUrl(params.mask) };
  }

  return {
    model: getResponsesModel(config),
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...params.images.map((image) => ({
            type: "input_image" as const,
            image_url: getDataUrl(image),
          })),
        ],
      },
    ],
    tools: [tool],
    tool_choice: { type: "image_generation" },
    stream: true,
    store: false,
    parallel_tool_calls: true,
    ...(getInstructions(params)
      ? { instructions: getInstructions(params) }
      : {}),
  };
}
