export interface ProviderCapabilities {
  chat: boolean;
  imageGeneration: boolean;
  streaming: boolean;
}

export interface ProviderModel {
  id: string;
  name: string;
  maxTokens?: number;
}

export interface ProviderChatRequest {
  messages: Array<{ role: "user" | "model"; content: string }>;
  model: string;
  systemInstruction?: string;
  temperature?: number;
  responseMimeType?: string;
  responseSchema?: any;
  signal?: AbortSignal;
}

export interface ProviderChatResponse {
  text: string;
}

export interface ProviderImageRequest {
  prompt: string;
  model: string;
  imageSize?: string;
  aspectRatio?: string;
  signal?: AbortSignal;
}

export interface ProviderImageResponse {
  imageUrl: string;
}

export type ProviderErrorType =
  | "RATE_LIMIT" // 429
  | "AUTH_ERROR" // 401, 403
  | "SERVICE_UNAVAILABLE" // 503, 502
  | "BAD_REQUEST" // 400
  | "TIMEOUT" // 408, 504
  | "UNKNOWN";

export class ProviderError extends Error {
  public type: ProviderErrorType;
  public retrySafe: boolean; // Indicates if error is pre-dispatch and safe for retrying/rotating
  public retryAfter?: number; // In seconds, parsed from header if present

  constructor(message: string, type: ProviderErrorType, retrySafe: boolean, retryAfter?: number) {
    super(message);
    this.name = "ProviderError";
    this.type = type;
    this.retrySafe = retrySafe;
    this.retryAfter = retryAfter;
  }
}

export interface AIProvider {
  id: string;
  name: string;
  capabilities: ProviderCapabilities;
  models: ProviderModel[];
  
  chat(request: ProviderChatRequest, apiKey: string): Promise<ProviderChatResponse>;
  generateImage?(request: ProviderImageRequest, apiKey: string): Promise<ProviderImageResponse>;
}
