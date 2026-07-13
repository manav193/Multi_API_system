import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// Request ID middleware to assign a unique ID to every incoming request
export function assignRequestId(req: Request, res: Response, next: NextFunction): void {
  req.id = crypto.randomUUID();
  res.setHeader("X-Request-ID", req.id);
  next();
}

// Extend Request interface to support custom id and logs
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

// Redact sensitive patterns like API keys, cookie headers, etc.
export function redactSensitiveData(data: any): any {
  if (!data) return data;
  if (typeof data === "string") {
    // Redact Gemini/Google API keys (e.g. AIzaSy...)
    let redacted = data.replace(/AIzaSy[A-Za-z0-9_-]{31}/g, "[REDACTED_API_KEY]");
    // Redact sessionId cookies or token values
    redacted = redacted.replace(/sessionId=[a-f0-9-]+/gi, "sessionId=[REDACTED_SESSION_ID]");
    redacted = redacted.replace(/x-csrf-token: [a-f0-9]+/gi, "x-csrf-token: [REDACTED_CSRF_TOKEN]");
    redacted = redacted.replace(/authorization: .*/gi, "authorization: [REDACTED]");
    return redacted;
  }
  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item));
  }
  if (typeof data === "object") {
    const redactedObj: any = {};
    for (const [key, value] of Object.entries(data)) {
      // Redact specific sensitive fields by name
      if (
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("cookie") ||
        key.toLowerCase().includes("authorization") ||
        key.toLowerCase().includes("prompt") ||
        key.toLowerCase().includes("message") ||
        key.toLowerCase().includes("content") ||
        key.toLowerCase().includes("token")
      ) {
        redactedObj[key] = "[REDACTED_SENSITIVE_FIELD]";
      } else {
        redactedObj[key] = redactSensitiveData(value);
      }
    }
    return redactedObj;
  }
  return data;
}

// Structured, redacted logging utility
export function logStructuredError(requestId: string, message: string, meta: any = {}) {
  const redactedMeta = redactSensitiveData(meta);
  const logEntry = {
    timestamp: new Date().toISOString(),
    requestId,
    level: "ERROR",
    message: redactSensitiveData(message),
    ...redactedMeta,
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

  // Redact all sensitive fields and log the error on the server side
  logStructuredError(requestId, err.message || "An unhandled error occurred", {
    url: req.url,
    method: req.method,
    statusCode,
    // Avoid logging stack trace in production or testing if it contains sensitive contents
    stack: process.env.NODE_ENV !== "production" ? redactSensitiveData(err.stack) : undefined,
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
