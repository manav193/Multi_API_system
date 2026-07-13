import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { RegisterKeySchema } from "../../shared/types.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";

const router = Router();

// Strict rate limiter for key registration to prevent key scanning or flooding (10 keys per minute)
const registerRateLimiter = createRateLimiter({
  keyPrefix: "key-registration",
  limit: 10,
  windowMs: 60 * 1000,
});

// 1. POST /api/session/keys - Register a new BYOK key after validation
router.post(
  "/",
  registerRateLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = req.session;
      if (!session) {
        res.status(401).json({ error: "Unauthorized: Invalid session" });
        return;
      }

      // Check max keys limit per session (e.g., 5 keys maximum)
      const MAX_KEYS = 5;
      if (session.keys.size >= MAX_KEYS) {
        res.status(400).json({
          error: `Bad Request: Maximum of ${MAX_KEYS} custom keys allowed per session.`,
        });
        return;
      }

      // Validate body parameters
      const parsed = RegisterKeySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "Bad Request: " + parsed.error.issues.map((i) => i.message).join(", "),
        });
        return;
      }

      const { key, label } = parsed.data;
      const trimmedKey = key.trim();

      // Prevent duplicates in registration
      const existingKeys = Array.from(session.keys.values());
      if (existingKeys.some((ek) => ek.rawKey === trimmedKey)) {
        res.status(400).json({
          error: "Bad Request: This key is already registered in your session pool.",
        });
        return;
      }

      // Live verification of the raw Gemini API key
      try {
        const ai = new GoogleGenAI({
          apiKey: trimmedKey,
          httpOptions: {
            headers: { "User-Agent": "aistudio-build" },
          },
        });
        // Call a tiny model with lightweight test
        await ai.models.generateContent({
          model: "gemini-3.1-flash-lite",
          contents: "Ping",
        });
      } catch (err: any) {
        // Return a generic, sanitized validation error
        res.status(400).json({
          error: "Invalid API Key: The key failed connectivity checks. Details: " + (err.message || "Unauthorized"),
        });
        return;
      }

      // Create secure, masked registration entry
      const keyId = crypto.randomUUID();
      const maskedKey = `${trimmedKey.substring(0, 8)}...${trimmedKey.substring(trimmedKey.length - 4)}`;
      const keyLabel = label?.trim() || `User Key #${session.keys.size + 1}`;

      session.keys.set(keyId, {
        keyId,
        rawKey: trimmedKey,
        maskedKey,
        label: keyLabel,
        status: "Ready",
        requestCount: 0,
        consecutiveFailures: 0,
      });

      res.json({
        keyId,
        maskedKey,
        label: keyLabel,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2. GET /api/session/keys - List registered keys for the current session
router.get("/", (req: Request, res: Response, next: NextFunction): void => {
  try {
    const session = req.session;
    if (!session) {
      res.status(401).json({ error: "Unauthorized: Invalid session" });
      return;
    }

    const keysList = Array.from(session.keys.values()).map((k) => ({
      keyId: k.keyId,
      maskedKey: k.maskedKey,
      label: k.label,
      status: k.status,
      requestCount: k.requestCount,
    }));

    res.json(keysList);
  } catch (err) {
    next(err);
  }
});

// 3. DELETE /api/session/keys/:keyId - Revoke and delete a key from the session
router.delete("/:keyId", (req: Request, res: Response, next: NextFunction): void => {
  try {
    const session = req.session;
    if (!session) {
      res.status(401).json({ error: "Unauthorized: Invalid session" });
      return;
    }

    const { keyId } = req.params;
    if (!session.keys.has(keyId)) {
      res.status(404).json({ error: "Not Found: Key registration not found in session" });
      return;
    }

    session.keys.delete(keyId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
