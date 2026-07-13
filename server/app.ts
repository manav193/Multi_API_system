import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import sessionRouter from "./routes/session.js";
import keysRouter from "./routes/keys.js";
import aiRouter from "./routes/ai.js";
import { loadSession, validateOriginAndCSRF } from "./middleware/auth.js";
import { securityHeaders, payloadSizeLimit, requestTimeout } from "./middleware/security.js";
import { assignRequestId, errorHandler } from "./middleware/error.js";

export async function createApp() {
  const app = express();

  // 1. Core Request Configuration
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  // 2. Global Security and Request Context middlewares
  app.use(securityHeaders);
  app.use(assignRequestId);
  app.use(payloadSizeLimit);
  app.use(requestTimeout);

  // 3. Session initialization (applies to all /api/ requests)
  app.use("/api", loadSession);

  // 4. Origin and CSRF protection (applies to state-changing endpoints)
  app.use("/api", validateOriginAndCSRF);

  // 5. Mount API Routes
  app.use("/api/session", sessionRouter);
  app.use("/api/session/keys", keysRouter);
  app.use("/api", aiRouter); // Maps /api/chat, /api/generate-image, /api/validate-key, /api/system-key-status

  // 6. Static Asset / Vite development middleware loading
  if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production or tests, serve static assets from dist/client
    const distPath = path.join(process.cwd(), "dist", "client");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // 7. Global Exception/Error Handling (Must be registered last)
  app.use(errorHandler);

  return app;
}
