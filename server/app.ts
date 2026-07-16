import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import sessionRouter from "./routes/session.js";
import keysRouter from "./routes/keys.js";
import aiRouter from "./routes/ai.js";
import { loadSession, validateOrigin, validateCSRF, corsMiddleware, requireSession } from "./middleware/auth.js";
import { securityHeaders, payloadSizeLimit, requestTimeout } from "./middleware/security.js";
import { assignRequestId, errorHandler, AppConfigError } from "./middleware/error.js";

export async function createApp() {
  const app = express();

  const isProd = process.env.NODE_ENV === "production";

  // Validate ALLOWED_ORIGINS and APP_URL on startup
  const allowedOriginsRaw = process.env.ALLOWED_ORIGINS;
  if (isProd && !allowedOriginsRaw && !process.env.APP_URL) {
    throw new AppConfigError("ALLOWED_ORIGINS or APP_URL must be configured in production.");
  }

  if (allowedOriginsRaw) {
    const split = allowedOriginsRaw.split(/[,\s]+/);
    for (const item of split) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      try {
        new URL(trimmed);
      } catch {
        throw new AppConfigError(`Invalid URL origin in ALLOWED_ORIGINS: "${trimmed}"`);
      }
    }
  }

  if (process.env.APP_URL) {
    try {
      new URL(process.env.APP_URL.trim());
    } catch {
      throw new AppConfigError(`Invalid URL in APP_URL: "${process.env.APP_URL}"`);
    }
  }

  // Move production store validation to startup (never call process.exit inside constructors)
  const allowOverride = process.env.ALLOW_IN_MEMORY_STORE === "true";
  if (isProd && !allowOverride) {
    throw new AppConfigError(
      "InMemory stores selected in production mode! Please set ALLOW_IN_MEMORY_STORE=true for single-instance testing or use Redis."
    );
  }

  // Configure Express trust proxy explicitly for the deployment (Default to false!)
  const trustProxyVal = process.env.TRUST_PROXY || "false";
  app.set("trust proxy", trustProxyVal === "true" ? true : trustProxyVal === "false" ? false : trustProxyVal);

  // 1. Core Request Configuration
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  // 2. Global CORS setup
  app.use(corsMiddleware);

  // 3. Global Security and Request Context middlewares
  app.use(securityHeaders);
  app.use(assignRequestId);
  app.use(payloadSizeLimit);
  app.use(requestTimeout);

  // 4. Origin validation (applies to state-changing requests, must run BEFORE loadSession to prevent untrusted requests from refreshing sessions)
  app.use("/api", validateOrigin);

  // 5. Session initialization (applies to all /api/ requests)
  app.use("/api", loadSession);

  // 6. CSRF validation (applies to state-changing endpoints, runs AFTER loadSession has populated the session context)
  app.use("/api", validateCSRF);

  // 6. Mount API Routes
  app.use("/api/session", sessionRouter);
  app.use("/api/session/keys", requireSession, keysRouter);
  app.use("/api", aiRouter); // Maps /api/chat, /api/generate-image, /api/validate-key, /api/system-key-status

  // 7. Static Asset / Vite development middleware loading
  if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static assets from dist/client
    const distPath = path.join(process.cwd(), "dist", "client");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // 8. Global Exception/Error Handling (Must be registered last)
  app.use(errorHandler);

  return app;
}
