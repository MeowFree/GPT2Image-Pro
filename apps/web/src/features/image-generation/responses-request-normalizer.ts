export type ResponsesStreamRequestBody = Record<string, unknown> & {
  stream?: boolean;
  tools?: unknown[];
  prompt_cache_key?: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isImageGenerationTool(value: unknown) {
  return isPlainRecord(value) && value.type === "image_generation";
}

function isWebSearchTool(value: unknown) {
  return isPlainRecord(value) && value.type === "web_search";
}

function isCodeInterpreterTool(value: unknown) {
  return isPlainRecord(value) && value.type === "code_interpreter";
}

function normalizeResponsesImageTool(
  value: unknown,
  fallback: Record<string, unknown>
) {
  const tool = isPlainRecord(value) ? { ...value } : {};
  for (const [key, fallbackValue] of Object.entries(fallback)) {
    if (tool[key] === undefined && fallbackValue !== undefined) {
      tool[key] = fallbackValue;
    }
  }
  tool.type = "image_generation";
  return tool;
}

export function normalizeResponsesImageRequestBody(
  rawBody: Record<string, unknown>,
  options: {
    fallbackTool: Record<string, unknown>;
    additionalTools?: Record<string, unknown>[];
    instructions: string;
    stream: boolean;
    defaultToolChoice?: unknown;
  }
): ResponsesStreamRequestBody {
  const body: Record<string, unknown> = {
    ...rawBody,
    store: false,
    instructions:
      typeof rawBody.instructions === "string" && rawBody.instructions
        ? rawBody.instructions
        : options.instructions,
    stream: options.stream,
  };
  if (
    body.tool_choice === undefined &&
    options.defaultToolChoice !== undefined
  ) {
    body.tool_choice = options.defaultToolChoice;
  }

  const tools = Array.isArray(rawBody.tools) ? rawBody.tools : [];
  const imageToolIndex = tools.findIndex(isImageGenerationTool);
  if (imageToolIndex >= 0) {
    body.tools = tools.map((item, index) =>
      index === imageToolIndex
        ? normalizeResponsesImageTool(item, options.fallbackTool)
        : item
    );
  } else {
    body.tools = [
      ...tools,
      normalizeResponsesImageTool(undefined, options.fallbackTool),
    ];
  }
  for (const additionalTool of options.additionalTools || []) {
    if (
      additionalTool.type === "web_search" &&
      (body.tools as unknown[]).some(isWebSearchTool)
    ) {
      continue;
    }
    if (
      additionalTool.type === "code_interpreter" &&
      (body.tools as unknown[]).some(isCodeInterpreterTool)
    ) {
      continue;
    }
    (body.tools as unknown[]).push(additionalTool);
  }

  delete body.size;
  delete body.quality;
  delete body.moderation;
  delete body.output_format;
  delete body.output_compression;

  return body as ResponsesStreamRequestBody;
}
