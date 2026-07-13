import { Router, Request, Response, NextFunction } from "express";
import { GoogleGenAI } from "@google/genai";
import { ChatSchema, GenerateImageSchema, ValidateKeySchema, KeyRegistryEntry } from "../../shared/types.js";
import { providerRegistry } from "../providers/registry.js";
import { ProviderError } from "../providers/types.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";

const router = Router();

// Strict rate limiters for key validation and generation
const validationRateLimiter = createRateLimiter({
  keyPrefix: "key-validation",
  limit: 15,
  windowMs: 60 * 1000,
});

const aiRateLimiter = createRateLimiter({
  keyPrefix: "ai-generation",
  limit: 30,
  windowMs: 60 * 1000,
});

// Helper: Run provider request with resilient multi-key rotation, timeouts, and cancellation
async function executeWithRotation<T>(
  req: Request,
  res: Response,
  credentials: any,
  executeFn: (apiKey: string, signal: AbortSignal) => Promise<T>
): Promise<{ result: T; finalActiveKeyIndex: number; logs: string[]; keyStatuses: Record<string, string> }> {
  const session = req.session;
  if (!session) {
    throw new Error("Unauthorized: Session is not initialized");
  }

  const logs: string[] = [];
  const keyStatuses: Record<string, string> = {};

  const abortController = req.abortController || new AbortController();
  const signal = abortController.signal;

  // Case 1: System-Default Key Mode
  if (credentials.mode === "system") {
    const defaultKey = process.env.GEMINI_API_KEY;
    if (!defaultKey) {
      throw new Error("No Gemini API key configured on this server.");
    }

    logs.push("[SYSTEM] Using Server Config Key (Default)...");

    try {
      const result = await executeFn(defaultKey, signal);
      return {
        result,
        finalActiveKeyIndex: 0,
        logs,
        keyStatuses: {},
      };
    } catch (err: any) {
      logs.push(`[ERROR] System default key failed: ${err.message}`);
      if (req.timedOut) {
        err.status = 504;
      }
      throw err;
    }
  }

  // Case 2: BYOK Mode with Rotative Failover
  const requestedKeyIds: string[] = credentials.keyIds;
  const activeKeyIndex: number = credentials.activeKeyIndex;

  // Validate that all keyIds belong to the current session (prevent Session A accessing Session B keys)
  for (const id of requestedKeyIds) {
    if (!session.keys.has(id)) {
      const err = new Error("Invalid or revoked credentials provided.");
      (err as any).status = 401;
      throw err;
    }
  }

  // Retrieve and sort eligible keys
  const eligibleKeys: KeyRegistryEntry[] = [];
  for (const id of requestedKeyIds) {
    const keyEntry = session.keys.get(id);
    if (keyEntry) {
      eligibleKeys.push(keyEntry);
    }
  }

  if (eligibleKeys.length === 0) {
    throw new Error("No eligible BYOK API keys are available in the session pool.");
  }

  // Determine starting point based on activeKeyIndex safely
  let currentIndex = 0;
  if (activeKeyIndex >= 0 && activeKeyIndex < eligibleKeys.length) {
    currentIndex = activeKeyIndex;
  }

  // Maximum attempts: min(3, number of eligible keys)
  const maxAttempts = Math.min(3, eligibleKeys.length);
  let attempt = 0;

  while (attempt < maxAttempts) {
    if (signal.aborted) {
      const err = new Error("Request aborted");
      if (req.timedOut) {
        (err as any).status = 504;
      }
      throw err;
    }

    const targetIdx = (currentIndex + attempt) % eligibleKeys.length;
    const keyEntry = eligibleKeys[targetIdx];

    // Check if the key is in cooldown
    if (keyEntry.cooldownUntil && Date.now() < keyEntry.cooldownUntil) {
      logs.push(`[SKIP] Skipping key ${keyEntry.label} (in cooldown for another ${Math.ceil((keyEntry.cooldownUntil - Date.now()) / 1000)}s)...`);
      attempt++;
      continue;
    }

    // Check if key is marked permanently bad (Circuit Breaker)
    if (keyEntry.status === "Invalid Key (403)") {
      logs.push(`[SKIP] Skipping permanently invalid key: ${keyEntry.label}`);
      attempt++;
      continue;
    }

    logs.push(`[ROTATE] Trying API Key ${keyEntry.label} (Attempt ${attempt + 1}/${maxAttempts})...`);

    try {
      // Execute the request
      const result = await executeFn(keyEntry.rawKey, signal);

      // Success cleanup and reporting
      keyEntry.status = "Active";
      keyEntry.requestCount += 1;
      keyEntry.consecutiveFailures = 0;
      keyStatuses[keyEntry.keyId] = "Active";

      logs.push(`[SUCCESS] Completed request using key: ${keyEntry.label}.`);

      return {
        result,
        finalActiveKeyIndex: targetIdx,
        logs,
        keyStatuses,
      };
    } catch (err: any) {
      keyEntry.consecutiveFailures += 1;
      
      let isRetrySafe = false;
      let errorMsg = err.message || String(err);

      if (err instanceof ProviderError) {
        errorMsg = err.message;
        if (err.type === "RATE_LIMIT") {
          keyEntry.status = "Rate Limited (429)";
          const cooldownSeconds = err.retryAfter || 30;
          keyEntry.cooldownUntil = Date.now() + cooldownSeconds * 1000;
          keyStatuses[keyEntry.keyId] = "Rate Limited (429)";
          logs.push(`[FAIL OVER] Key ${keyEntry.label} failed due to rate limits. Cooldown: ${cooldownSeconds}s.`);
          isRetrySafe = err.retrySafe;
        } else if (err.type === "AUTH_ERROR") {
          keyEntry.status = "Invalid Key (403)";
          keyStatuses[keyEntry.keyId] = "Invalid Key (403)";
          logs.push(`[FAIL OVER] Key ${keyEntry.label} failed due to auth failure (403). Tripped circuit breaker.`);
          isRetrySafe = true; // Safe to retry on a DIFFERENT key
        } else if (err.type === "SERVICE_UNAVAILABLE") {
          keyEntry.status = "Failed";
          keyStatuses[keyEntry.keyId] = "Failed";
          logs.push(`[FAIL OVER] Key ${keyEntry.label} failed: Service Unavailable.`);
          isRetrySafe = err.retrySafe;
        } else {
          keyEntry.status = "Failed";
          keyStatuses[keyEntry.keyId] = "Failed";
          logs.push(`[FAIL OVER] Key ${keyEntry.label} failed: ${err.message}`);
          isRetrySafe = false; // Unknown or dangerous to retry
        }
      } else {
        keyEntry.status = "Failed";
        keyStatuses[keyEntry.keyId] = "Failed";
        logs.push(`[FAIL OVER] Key ${keyEntry.label} failed with unexpected error: ${errorMsg}`);
        isRetrySafe = false; // Non-provider error is unsafe to retry
      }

      if (req.timedOut) {
        err.status = 504;
        throw err;
      }

      // If it is unsafe to retry (or we ran out of attempts), throw the error immediately
      if (!isRetrySafe || attempt + 1 >= maxAttempts) {
        logs.push("[ERROR] Key rotation stopped due to unsafe-to-retry error or exhaustion of attempts.");
        throw new Error(`Execution failed. Rotation logs:\n${logs.join("\n")}`);
      }

      attempt++;
    }
  }

  throw new Error(`All available API keys in the selection pool failed. Logs:\n${logs.join("\n")}`);
}

// 1. POST /api/chat - Structured chat endpoint with rotational failover
router.post("/chat", aiRateLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ChatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Bad Request: " + parsed.error.issues.map((i) => i.message).join(", "),
      });
      return;
    }

    const { messages, model, credentials, systemInstruction, temperature, responseMimeType, responseSchema } = parsed.data;
    const selectedModel = model || "gemini-3.5-flash";

    const provider = providerRegistry.get("gemini");
    if (!provider || !provider.capabilities.chat) {
      res.status(500).json({ error: "Configuration Error: Gemini chat capability is currently disabled." });
      return;
    }

    const { result, finalActiveKeyIndex, logs, keyStatuses } = await executeWithRotation(
      req,
      res,
      credentials,
      async (apiKey, signal) => {
        return await provider.chat(
          {
            messages,
            model: selectedModel,
            systemInstruction,
            temperature,
            responseMimeType,
            responseSchema,
            signal,
          },
          apiKey
        );
      }
    );

    res.json({
      text: result.text,
      logs,
      finalActiveKeyIndex,
      keyStatuses,
    });
  } catch (err: any) {
    next(err);
  }
});

// 2. POST /api/generate-image - Image generation with failover support
router.post("/generate-image", aiRateLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = GenerateImageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Bad Request: " + parsed.error.issues.map((i) => i.message).join(", "),
      });
      return;
    }

    const { prompt, model, credentials, imageSize, aspectRatio } = parsed.data;
    const selectedModel = model || "gemini-3.1-flash-image";

    const provider = providerRegistry.get("gemini");
    if (!provider || !provider.capabilities.imageGeneration || !provider.generateImage) {
      res.status(500).json({ error: "Configuration Error: Image generation is not enabled." });
      return;
    }

    const { result, finalActiveKeyIndex, logs, keyStatuses } = await executeWithRotation(
      req,
      res,
      credentials,
      async (apiKey, signal) => {
        return await provider.generateImage({
          prompt,
          model: selectedModel,
          imageSize,
          aspectRatio,
          signal,
        }, apiKey);
      }
    );

    res.json({
      imageUrl: result.imageUrl,
      logs,
      finalActiveKeyIndex,
      keyStatuses,
    });
  } catch (err: any) {
    next(err);
  }
});

// 3. POST /api/validate-key - Validates a registered key via keyId
router.post("/validate-key", validationRateLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const session = req.session;
    if (!session) {
      res.status(401).json({ error: "Unauthorized: Invalid session" });
      return;
    }

    const parsed = ValidateKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Bad Request: " + parsed.error.issues.map((i) => i.message).join(", "),
      });
      return;
    }

    const { keyId } = parsed.data;

    // Handle system-default key validation
    if (keyId === "system-default") {
      const defaultKey = process.env.GEMINI_API_KEY;
      if (!defaultKey) {
        res.json({ valid: false, error: "System default key check failed." });
        return;
      }

      try {
        const ai = new GoogleGenAI({ apiKey: defaultKey });
        await ai.models.generateContent({
          model: "gemini-3.1-flash-lite",
          contents: "Ping",
        });
        res.json({ valid: true });
      } catch (err: any) {
        // Return sanitized error message without err.message details
        res.json({ valid: false, error: "System default key check failed." });
      }
      return;
    }

    // Load custom key
    const keyEntry = session.keys.get(keyId);
    if (!keyEntry) {
      res.status(404).json({ error: "Not Found: Key registration not found in session" });
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey: keyEntry.rawKey });
      await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: "Ping",
      });
      keyEntry.status = "Ready";
      res.json({ valid: true });
    } catch (err: any) {
      keyEntry.status = "Invalid Key (403)";
      // Return sanitized error message without err.message details
      res.json({ valid: false, error: "Validation failed: The API key is invalid or inactive." });
    }
  } catch (err) {
    next(err);
  }
});

// 4. GET /api/system-key-status - Checks system key presence
router.get("/system-key-status", (req: Request, res: Response) => {
  res.json({
    hasDefaultKey: !!process.env.GEMINI_API_KEY,
  });
});

export default router;
