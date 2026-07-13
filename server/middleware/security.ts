import { Request, Response, NextFunction } from "express";
import helmet from "helmet";

// Security headers configuration (using Helmet)
// Sets Content-Security-Policy-Report-Only to avoid breaking existing inline scripts or sandbox blob previews
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    reportOnly: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://*.googleapis.com"],
      frameSrc: ["'self'", "blob:"],
      sandbox: ["allow-scripts", "allow-same-origin"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

// Enforce request payload size limit (2 MB)
export const payloadSizeLimit = (req: Request, res: Response, next: NextFunction) => {
  const contentLength = req.headers["content-length"];
  if (contentLength && parseInt(contentLength, 10) > 2 * 1024 * 1024) {
    res.status(413).json({
      error: "Payload Too Large: Request body exceeds the 2 MB limit.",
    });
    return;
  }
  next();
};

// Strict request timeout handler (30 seconds)
export const requestTimeout = (req: Request, res: Response, next: NextFunction) => {
  // Set response timeout of 30 seconds
  const timeoutMs = 30000;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      // Abort the associated request
      req.destroy();
      res.status(504).json({
        error: "Gateway Timeout: The request exceeded the 30-second deadline.",
      });
    }
  }, timeoutMs);

  // Unref timer so it doesn't prevent Node process exit
  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }

  // Clear timer when response ends
  res.on("finish", () => clearTimeout(timer));
  res.on("close", () => clearTimeout(timer));

  next();
};
