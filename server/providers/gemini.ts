import { GoogleGenAI } from "@google/genai";
import {
  AIProvider,
  ProviderChatRequest,
  ProviderChatResponse,
  ProviderImageRequest,
  ProviderImageResponse,
  ProviderError,
  ProviderErrorType,
} from "./types.js";

export class GeminiProvider implements AIProvider {
  public id = "gemini";
  public name = "Google Gemini";
  
  public capabilities = {
    chat: true,
    imageGeneration: true,
    streaming: false,
  };

  public models = [
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image" },
  ];

  private getClient(apiKey: string, signal?: AbortSignal): GoogleGenAI {
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
        signal, // Propagate the AbortSignal into the HTTP client options
      } as any,
    });
  }

  private handleError(error: any): never {
    const errorMsg = error.message || String(error);
    const lowercaseMsg = errorMsg.toLowerCase();

    let type: ProviderErrorType = "UNKNOWN";
    let retrySafe = false;
    let retryAfter: number | undefined;

    // Check for rate limiting
    if (
      lowercaseMsg.includes("quota") ||
      lowercaseMsg.includes("limit") ||
      lowercaseMsg.includes("429") ||
      lowercaseMsg.includes("exhausted")
    ) {
      type = "RATE_LIMIT";
      retrySafe = true; // Safe to retry on a DIFFERENT key
      
      // Parse retry-after from error text if possible
      const match = errorMsg.match(/retry after (\d+)s/i);
      if (match) {
        retryAfter = parseInt(match[1], 10);
      }
    } 
    // Check for authentication
    else if (
      lowercaseMsg.includes("key not valid") ||
      lowercaseMsg.includes("403") ||
      lowercaseMsg.includes("unauthorized") ||
      lowercaseMsg.includes("api key") ||
      lowercaseMsg.includes("401")
    ) {
      type = "AUTH_ERROR";
      retrySafe = false; // Key is permanently bad, do not retry same key but rotation is managed by the server to skip this key.
    } 
    // Check for service unavailable (503)
    else if (
      lowercaseMsg.includes("503") ||
      lowercaseMsg.includes("unavailable") ||
      lowercaseMsg.includes("overloaded") ||
      lowercaseMsg.includes("502") ||
      lowercaseMsg.includes("bad gateway")
    ) {
      type = "SERVICE_UNAVAILABLE";
      retrySafe = true; // Pre-dispatch service issue, safe to retry/failover
    }
    // Check for timeout
    else if (
      lowercaseMsg.includes("timeout") ||
      lowercaseMsg.includes("deadline") ||
      lowercaseMsg.includes("504") ||
      error.name === "AbortError"
    ) {
      type = "TIMEOUT";
      retrySafe = false; // Ambiguous timeout - could have executed, do not retry
    }
    // Bad request
    else if (lowercaseMsg.includes("400") || lowercaseMsg.includes("bad request") || lowercaseMsg.includes("invalid argument")) {
      type = "BAD_REQUEST";
      retrySafe = false; // Invalid payload, do not retry
    }

    throw new ProviderError(
      `Gemini provider error: ${errorMsg}`,
      type,
      retrySafe,
      retryAfter
    );
  }

  public async chat(request: ProviderChatRequest, apiKey: string): Promise<ProviderChatResponse> {
    try {
      const ai = this.getClient(apiKey, request.signal);

      const apiConfig: any = {
        systemInstruction: request.systemInstruction || "You are a helpful assistant.",
        temperature: typeof request.temperature === "number" ? request.temperature : 0.7,
      };

      if (request.responseMimeType) {
        apiConfig.responseMimeType = request.responseMimeType;
      }
      if (request.responseSchema) {
        apiConfig.responseSchema = request.responseSchema;
      }

      // Format messages into Content format expected by GoogleGenAI
      const contents = request.messages.map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      }));

      const response = await ai.models.generateContent({
        model: request.model,
        contents,
        config: apiConfig,
      });

      return {
        text: response.text || "",
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  public async generateImage(request: ProviderImageRequest, apiKey: string): Promise<ProviderImageResponse> {
    try {
      const ai = this.getClient(apiKey, request.signal);

      const response = await ai.models.generateContent({
        model: request.model,
        contents: {
          parts: [{ text: request.prompt }],
        },
        config: {
          imageConfig: {
            aspectRatio: request.aspectRatio || "1:1",
            imageSize: request.imageSize || "1K",
          },
        } as any,
      });

      let base64 = "";
      const candidates = response.candidates;
      if (candidates && candidates[0] && candidates[0].content && candidates[0].content.parts) {
        for (const part of candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
            base64 = part.inlineData.data;
            break;
          }
        }
      }

      if (!base64) {
        throw new Error("No image was returned by the model.");
      }

      return {
        imageUrl: `data:image/png;base64,${base64}`,
      };
    } catch (error) {
      this.handleError(error);
    }
  }
}
export const geminiProvider = new GeminiProvider();
