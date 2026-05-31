export const DEFAULT_IMAGE_MODEL = "gpt-image-2";
export const LEGACY_IMAGE_MODEL = "gpt-image-1";
export const IMAGE_PROMPT_MAX_CHARACTERS = 32_000;
export const IMAGE_PROMPT_TOO_LONG_MESSAGE = `Prompt exceeds the ${IMAGE_PROMPT_MAX_CHARACTERS} character limit.`;
export const DEFAULT_IMAGE_SIZE = "1024x1024";
export const IMAGE_DIMENSION_STEP = 16;
export const MIN_IMAGE_DIMENSION = 256;
export const MAX_IMAGE_DIMENSION = 4096;

export type ImageDimensions = {
  width: number;
  height: number;
};

export function normalizeImageModel(model?: string | null) {
  if (!model || model === LEGACY_IMAGE_MODEL) return undefined;
  return model;
}

export const IMAGE_RESOLUTION_PRESETS = [
  { value: "1024x1024", label: "Square", detail: "1024 × 1024" },
  { value: "1536x1024", label: "Landscape", detail: "1536 × 1024" },
  { value: "1024x1536", label: "Portrait", detail: "1024 × 1536" },
  { value: "2048x2048", label: "2K Square", detail: "2048 × 2048" },
  { value: "2048x1152", label: "2K Wide", detail: "2048 × 1152" },
  { value: "3840x2160", label: "4K Wide", detail: "3840 × 2160" },
  { value: "2160x3840", label: "4K Tall", detail: "2160 × 3840" },
  { value: "4096x4096", label: "4K Square", detail: "4096 × 4096" },
] as const;

export function parseImageSize(size: string): ImageDimensions | null {
  const match = size
    .trim()
    .toLowerCase()
    .match(/^(\d{2,5})x(\d{2,5})$/);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;

  return { width, height };
}

export function normalizeImageSize(width: number, height: number) {
  return `${width}x${height}`;
}

export function isValidImageDimension(value: number) {
  return (
    Number.isInteger(value) &&
    value >= MIN_IMAGE_DIMENSION &&
    value <= MAX_IMAGE_DIMENSION &&
    value % IMAGE_DIMENSION_STEP === 0
  );
}

export function validateImageSize(
  size: string
):
  | { valid: true; dimensions: ImageDimensions }
  | { valid: false; message: string } {
  const dimensions = parseImageSize(size);
  if (!dimensions) {
    return { valid: false, message: "Use WIDTHxHEIGHT format." };
  }

  if (
    !isValidImageDimension(dimensions.width) ||
    !isValidImageDimension(dimensions.height)
  ) {
    return {
      valid: false,
      message: `Width and height must be between ${MIN_IMAGE_DIMENSION} and ${MAX_IMAGE_DIMENSION}px and divisible by ${IMAGE_DIMENSION_STEP}.`,
    };
  }

  return { valid: true, dimensions };
}
