export interface GenerateImageParams {
  prompt: string;
  size?: string;
  width?: number;
  height?: number;
  model?: string;
  n?: number;
  quality?: ImageQuality;
}

export interface GenerateImageResult {
  imageBase64?: string;
  imageUrl?: string;
  revisedPrompt?: string;
  error?: string;
}

export type ImageQuality = "auto" | "low" | "medium" | "high";

export interface ImageInputFile {
  data: Buffer;
  name: string;
  type: string;
  url?: string;
}

export interface EditImageParams {
  prompt: string;
  images: ImageInputFile[];
  mask?: ImageInputFile;
  size?: string;
  model?: string;
  quality?: ImageQuality;
  n?: number;
}

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
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
