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
