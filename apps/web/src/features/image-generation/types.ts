export interface GenerateImageParams {
  prompt: string;
  size?: string;
  model?: string;
  n?: number;
}

export interface GenerateImageResult {
  imageBase64?: string;
  imageUrl?: string;
  revisedPrompt?: string;
  error?: string;
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
