import { AIProvider } from "./types.js";
import { geminiProvider } from "./gemini.js";

class ProviderRegistry {
  private providers: Map<string, AIProvider> = new Map();

  constructor() {
    // Register the verified Gemini provider
    this.register(geminiProvider);
  }

  public register(provider: AIProvider) {
    this.providers.set(provider.id, provider);
  }

  public get(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  public getAll(): AIProvider[] {
    return Array.from(this.providers.values());
  }
}

export const providerRegistry = new ProviderRegistry();
