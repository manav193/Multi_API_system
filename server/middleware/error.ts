import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// Request ID middleware to assign a unique ID to every incoming request
export function assignRequestId(req: Request, res: Response, next: NextFunction): void {
  req.id = crypto.randomUUID();
  res.setHeader("X-Request-ID", req.id);
  next();
}

// Extend Request interface to support custom id
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

// Redact/sanitize sensitive patterns like API keys, cookie headers, etc. from any log string
export function sanitizeMessage(msg: string): string {
  if (!msg) return msg;
  let result = msg;

  // Redact Gemini/Google API keys (e.g. AIzaSy...)
  result = result.replace(/AIzaSy[A-Za-z0-9_-]*/g, "[REDACTED_API_KEY]");
  // Redact sessionId cookies or token values
  result = result.replace(/sessionId=[A-Za-z0-9_-]+/gi, "sessionId=[REDACTED_SESSION_ID]");
  result = result.replace(/x-csrf-token: [A-Za-z0-9_-]+/gi, "x-csrf-token: [REDACTED_CSRF_TOKEN]");
  // Redact authorization headers
  result = result.replace(/authorization: .*/gi, "authorization: [REDACTED]");
  // Redact cookie headers
  result = result.replace(/cookie: .*/gi, "cookie: [REDACTED]");
  // Redact prompt fields
  result = result.replace(/prompt: .*/gi, "prompt: [REDACTED]");
  // Redact local path references and file/directory details
  result = result.replace(/\/app\/applet[^\s:]*/gi, "[REDACTED_PATH]");
  result = result.replace(/\/server\/[^\s:]*/gi, "[REDACTED_PATH]");

  return result;
}

// Structured, redacted logging utility using ONLY allowlisted safe fields
export function logStructuredError(requestId: string, message: string, meta: any = {}) {
  const cleanMessage = sanitizeMessage(message);

  // Allowlist ONLY safe fields, dropping blacklist/arbitrary fields
  const ALLOWED_LOG_FIELDS = ["url", "method", "statusCode", "type"];
  const safeMeta: any = {};
  if (meta && typeof meta === "object") {
    for (const field of ALLOWED_LOG_FIELDS) {
      if (meta[field] !== undefined) {
        safeMeta[field] = typeof meta[field] === "string" ? sanitizeMessage(meta[field]) : meta[field];
      }
    }
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    requestId: sanitizeMessage(requestId),
    level: "ERROR",
    message: cleanMessage,
    ...safeMeta,
  };
  console.error(JSON.stringify(logEntry));
}

// Express error handling middleware
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = req.id || "unknown";
  const statusCode = err.status || err.statusCode || 500;

  // Log only allowlisted fields on the server side
  logStructuredError(requestId, err.message || "An unhandled error occurred", {
    url: req.url,
    method: req.method,
    statusCode,
  });

  // Return a sanitized, customer-facing response without details leaking
  let message = "An internal server error occurred.";
  if (statusCode === 400) {
    message = "Bad Request: Invalid parameters or malformed body.";
  } else if (statusCode === 401) {
    message = "Unauthorized: Access is denied due to invalid credentials.";
  } else if (statusCode === 403) {
    message = "Forbidden: Access is refused.";
  } else if (statusCode === 404) {
    message = "Not Found: The requested resource could not be found.";
  } else if (statusCode === 413) {
    message = "Payload Too Large: Request body exceeds the 2 MB limit.";
  } else if (statusCode === 429) {
    message = "Too Many Requests: Rate limit exceeded.";
  } else if (statusCode === 504) {
    message = "Gateway Timeout: The request took too long to complete.";
  }

  res.status(statusCode).json({
    error: message,
    requestId,
  });
}

// Process-level unhandled rejection/exception handlers
if (typeof process !== "undefined") {
  process.on("unhandledRejection", (reason: any) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logStructuredError("process", `Unhandled Rejection: ${msg}`, {
      type: "unhandledRejection",
    });
  });

  process.on("uncaughtException", (error: Error) => {
    logStructuredError("process", `Uncaught Exception: ${error.message}`, {
      type: "uncaughtException",
    });
    process.exit(1);
  });
}
