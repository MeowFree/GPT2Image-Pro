export interface GenerateImageParams {
  prompt: string;
  apiPrompt?: string;
  size?: string;
  width?: number;
  height?: number;
  model?: string;
  n?: number;
  quality?: ImageQuality;
  moderation?: ImageModeration;
}

export interface GenerateImageResult {
  imageBase64?: string;
  imageUrl?: string;
  revisedPrompt?: string;
  responseText?: string;
  error?: string;
}

export interface PartialImageResult {
  imageBase64?: string;
  imageUrl?: string;
  index?: number;
  partialImageIndex?: number;
}

export interface ImageGenerationCallbacks {
  onPartialImage?: (image: PartialImageResult) => Promise<void> | void;
}

export type ImageQuality = "auto" | "low" | "medium" | "high";
export type ImageModeration = "auto" | "low";

export interface ImageInputFile {
  data: Buffer;
  name: string;
  type: string;
  url?: string;
}

export interface EditImageParams {
  prompt: string;
  apiPrompt?: string;
  images: ImageInputFile[];
  mask?: ImageInputFile;
  size?: string;
  model?: string;
  quality?: ImageQuality;
  n?: number;
  moderation?: ImageModeration;
}

export interface ChatImageParams {
  prompt: string;
  apiPrompt?: string;
  images?: ImageInputFile[];
  size?: string;
  model?: string;
  quality?: ImageQuality;
  n?: number;
  moderation?: ImageModeration;
}

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  useStream?: boolean;
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
