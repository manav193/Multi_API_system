import { Request, Response, NextFunction } from "express";
import helmet from "helmet";

// Security headers configuration (using Helmet)
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

// Strict request timeout handler (30 seconds) using one request-scoped AbortController
export const requestTimeout = (req: Request, res: Response, next: NextFunction) => {
  const abortController = new AbortController();
  req.abortController = abortController;

  const timer = setTimeout(() => {
    if (!res.headersSent) {
      req.timedOut = true;
      abortController.abort();
      res.status(504).json({
        error: "Gateway Timeout: The request exceeded the 30-second deadline.",
      });
    }
  }, 30000);

  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }

  const onAborted = () => {
    abortController.abort();
  };

  const onClose = () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  };

  req.on("aborted", onAborted);
  res.on("close", onClose);

  const cleanup = () => {
    clearTimeout(timer);
    req.off("aborted", onAborted);
    res.off("close", onClose);
  };

  res.on("finish", cleanup);
  res.on("close", cleanup);

  next();
};

// Declare abortController and timedOut on Request in Express
declare global {
  namespace Express {
    interface Request {
      abortController?: AbortController;
      timedOut?: boolean;
    }
  }
}
