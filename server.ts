import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// Type definition for key statuses
interface KeyStatus {
  key: string;
  label: string;
  status: "Active" | "Ready" | "Rate Limited (429)" | "Invalid Key (403)" | "Failed";
  error?: string;
}

/**
 * Universal Key Rotation and Failover Runner.
 * Takes the active index, a list of custom user keys, and a execution callback.
 * On failure, it rotates to the next key, logs the issue, and retries.
 */
async function executeWithRotation<T>(
  userKeys: string[],
  activeKeyIndex: number,
  executeFn: (ai: GoogleGenAI, key: string) => Promise<T>
): Promise<{
  result: T;
  logs: string[];
  finalActiveKeyIndex: number;
  keyStatuses: Record<string, string>;
}> {
  const logs: string[] = [];
  const keyStatuses: Record<string, string> = {};

  // Build the list of all keys to try
  const allKeys: { key: string; label: string; index: number }[] = [];
  
  if (process.env.GEMINI_API_KEY) {
    allKeys.push({ key: process.env.GEMINI_API_KEY, label: "System Default Key", index: 0 });
  }
  
  userKeys.forEach((key, idx) => {
    if (key && key.trim()) {
      allKeys.push({ key: key.trim(), label: `User Key #${idx + 1}`, index: allKeys.length });
    }
  });

  if (allKeys.length === 0) {
    logs.push("Error: No API keys available.");
    throw new Error("No Gemini API keys are available. Please provide at least one API key.");
  }

  // Determine starting point based on activeKeyIndex safely
  let currentIndex = 0;
  if (activeKeyIndex >= 0 && activeKeyIndex < allKeys.length) {
    currentIndex = activeKeyIndex;
  }

  let attempts = 0;
  const maxAttempts = allKeys.length;

  while (attempts < maxAttempts) {
    const targetIdx = (currentIndex + attempts) % allKeys.length;
    const { key, label, index } = allKeys[targetIdx];

    logs.push(`[ROTATE] Trying ${label} (Index ${index})...`);
    try {
      const ai = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const result = await executeFn(ai, key);
      logs.push(`[SUCCESS] Completed request using ${label}.`);
      keyStatuses[key] = "Active";
      
      return {
        result,
        logs,
        finalActiveKeyIndex: index,
        keyStatuses,
      };
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      const isRateLimit =
        errorMsg.toLowerCase().includes("quota") ||
        errorMsg.toLowerCase().includes("limit") ||
        errorMsg.toLowerCase().includes("429") ||
        errorMsg.toLowerCase().includes("exhausted");
      const isAuthError =
        errorMsg.toLowerCase().includes("key not valid") ||
        errorMsg.toLowerCase().includes("403") ||
        errorMsg.toLowerCase().includes("unauthorized") ||
        errorMsg.toLowerCase().includes("api key");

      let status: "Rate Limited (429)" | "Invalid Key (403)" | "Failed" = "Failed";
      if (isRateLimit) {
        status = "Rate Limited (429)";
        logs.push(`[FAIL OVER] ${label} failed due to RATE LIMIT (429): ${errorMsg.substring(0, 120)}`);
      } else if (isAuthError) {
        status = "Invalid Key (403)";
        logs.push(`[FAIL OVER] ${label} failed due to AUTH ERROR (403): ${errorMsg.substring(0, 120)}`);
      } else {
        logs.push(`[FAIL OVER] ${label} failed with error: ${errorMsg.substring(0, 120)}`);
      }

      keyStatuses[key] = status;
      attempts++;
    }
  }

  logs.push("[ERROR] All available keys have been exhausted and failed.");
  throw new Error(`All API keys failed. Rotation logs:\n${logs.join("\n")}`);
}

// 1. API: Multi-turn Chat & Coding Agent
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, model, userKeys, activeKeyIndex, systemInstruction, temperature, responseMimeType, responseSchema } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid messages format" });
    }

    const selectedModel = model || "gemini-3.5-flash";

    const { result, logs, finalActiveKeyIndex, keyStatuses } = await executeWithRotation(
      userKeys || [],
      activeKeyIndex || 0,
      async (ai) => {
        // Build dynamic config
        const apiConfig: any = {
          systemInstruction: systemInstruction || "You are a helpful assistant.",
          temperature: typeof temperature === "number" ? temperature : 0.7,
        };

        if (responseMimeType) {
          apiConfig.responseMimeType = responseMimeType;
        }
        if (responseSchema) {
          apiConfig.responseSchema = responseSchema;
        }

        const response = await ai.models.generateContent({
          model: selectedModel,
          contents: messages,
          config: apiConfig,
        });
        return {
          text: response.text || "",
        };
      }
    );

    res.json({
      text: result.text,
      logs,
      finalActiveKeyIndex,
      keyStatuses,
    });
  } catch (error: any) {
    res.status(500).json({
      error: error.message || "An error occurred during the request",
    });
  }
});

// 2. API: High-Quality Image Generation
app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt, userKeys, activeKeyIndex, imageSize, aspectRatio, model } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    // Support gemini-3-pro-image or fallback to gemini-3.1-flash-image
    const selectedModel = model || "gemini-3.1-flash-image";

    const { result, logs, finalActiveKeyIndex, keyStatuses } = await executeWithRotation(
      userKeys || [],
      activeKeyIndex || 0,
      async (ai) => {
        const response = await ai.models.generateContent({
          model: selectedModel,
          contents: {
            parts: [{ text: prompt }],
          },
          config: {
            imageConfig: {
              aspectRatio: aspectRatio || "1:1",
              imageSize: imageSize || "1K",
            },
          },
        });

        // Search for the inlineData image in candidates
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
      }
    );

    res.json({
      imageUrl: result.imageUrl,
      logs,
      finalActiveKeyIndex,
      keyStatuses,
    });
  } catch (error: any) {
    res.status(500).json({
      error: error.message || "An error occurred during image generation",
    });
  }
});

// 3. API: Validate single API key
app.post("/api/validate-key", async (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ error: "Key is required" });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: key.trim(),
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: "Respond only with 'OK' to test API connectivity.",
    });

    const isSuccess = response.text ? true : false;
    res.json({ valid: isSuccess, text: response.text });
  } catch (error: any) {
    res.json({ valid: false, error: error.message || String(error) });
  }
});

// 4. API: Get System Default Key presence
app.get("/api/system-key-status", (req, res) => {
  res.json({
    hasDefaultKey: !!process.env.GEMINI_API_KEY,
    maskedDefaultKey: process.env.GEMINI_API_KEY
      ? `${process.env.GEMINI_API_KEY.substring(0, 8)}...${process.env.GEMINI_API_KEY.substring(
          process.env.GEMINI_API_KEY.length - 4
        )}`
      : null,
  });
});

// Vite Middleware & Static Asset serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || "development"} mode`);
  });
}

startServer();
