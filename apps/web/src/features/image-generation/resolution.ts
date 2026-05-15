export const DEFAULT_IMAGE_MODEL = "gpt-image-2";
export const LEGACY_IMAGE_MODEL = "gpt-image-1";
export const DEFAULT_IMAGE_SIZE = "1024x1024";
export const IMAGE_DIMENSION_STEP = 16;
export const MIN_IMAGE_DIMENSION = 256;
export const MAX_IMAGE_DIMENSION = 3840;
export const MAX_IMAGE_PIXELS = 3840 * 2160;
export const IMAGE_4K_BASE_CREDIT_COST = 10;
export const REFERENCE_CREDIT_PRICE_CNY = 0.05;
export const TEXT_MODERATION_PRICE_CNY = 0.0015;
export const IMAGE_MODERATION_PRICE_CNY = 0.003;

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
] as const;

export type ImageCreditCostOptions = {
  textModerationCount?: number;
  imageModerationCount?: number;
};

export function getImageCreditCostBreakdown(
  size?: string | null,
  options: ImageCreditCostOptions = {}
) {
  const normalizedSize = size || DEFAULT_IMAGE_SIZE;
  const dimensions =
    parseImageSize(normalizedSize) || parseImageSize(DEFAULT_IMAGE_SIZE);
  const pixels = dimensions
    ? dimensions.width * dimensions.height
    : MAX_IMAGE_PIXELS;
  const baseCredits =
    (pixels / MAX_IMAGE_PIXELS) * IMAGE_4K_BASE_CREDIT_COST;
  const textModerationCount = options.textModerationCount ?? 1;
  const imageModerationCount = options.imageModerationCount ?? 0;
  const moderationCny =
    textModerationCount * TEXT_MODERATION_PRICE_CNY +
    imageModerationCount * IMAGE_MODERATION_PRICE_CNY;
  const moderationCredits = moderationCny / REFERENCE_CREDIT_PRICE_CNY;
  const totalCredits = Math.ceil(baseCredits + moderationCredits);
  const moderationOnlyCredits =
    moderationCny > 0 ? Math.ceil(moderationCredits) : 0;

  return {
    baseCredits,
    imageModerationCount,
    moderationCny,
    moderationCredits,
    moderationOnlyCredits,
    pixels,
    textModerationCount,
    totalCredits,
  };
}

export function getImageCreditCost(
  size?: string | null,
  options: ImageCreditCostOptions = {}
) {
  return getImageCreditCostBreakdown(size, options).totalCredits;
}

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

  if (dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    return {
      valid: false,
      message: `Total pixels must be no more than ${MAX_IMAGE_PIXELS.toLocaleString()}.`,
    };
  }

  return { valid: true, dimensions };
}
