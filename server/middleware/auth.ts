import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { KeyRegistryEntry } from "../../shared/types.js";

export interface Session {
  sessionId: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
  keys: Map<string, KeyRegistryEntry>;
  ip?: string;
}

// Parse ALLOWED_ORIGINS as an explicit normalized allowlist
export function getAllowedOrigins(): string[] {
  const isProd = process.env.NODE_ENV === "production";
  const origins = [
    process.env.APP_URL,
    process.env.ALLOWED_ORIGINS,
  ].filter(Boolean) as string[];

  if (!isProd) {
    origins.push("http://localhost:3000");
  }

  const parsed: string[] = [];
  for (const o of origins) {
    const split = o.split(/[,\s]+/);
    for (const item of split) {
      const trimmed = item.trim().toLowerCase();
      if (!trimmed) continue;
      try {
        const originUrl = new URL(trimmed);
        const host = originUrl.hostname;
        if (isProd && (host === "localhost" || host === "127.0.0.1" || host === "::1")) {
          continue;
        }
        parsed.push(originUrl.origin);
      } catch {
        parsed.push(trimmed);
      }
    }
  }
  return Array.from(new Set(parsed)).filter(Boolean);
}

// In-Memory Session Store with TTL Cleanup
export class InMemorySessionStore {
  private sessions: Map<string, Session> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Active TTL cleanup every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    if (this.cleanupInterval && typeof this.cleanupInterval.unref === "function") {
      this.cleanupInterval.unref();
    }
  }

  private cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now >= session.expiresAt) {
        this.sessions.delete(id);
      }
    }
  }

  public createSession(ip: string): Session {
    this.cleanup();

    const activeSessions = Array.from(this.sessions.values());
    const ipCount = activeSessions.filter((s) => s.ip === ip).length;
    if (ipCount >= 10) {
      throw new Error("Active session limit reached for this IP.");
    }

    if (this.sessions.size >= 1000) {
      throw new Error("Global active session limit reached.");
    }

    const sessionId = crypto.randomUUID();
    const csrfToken = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    const expiresAt = now + 2 * 60 * 60 * 1000; // 2 Hours sliding TTL

    const session: Session = {
      sessionId,
      csrfToken,
      createdAt: now,
      expiresAt,
      keys: new Map(),
      ip,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  public getSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    // Check expiration
    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    return session;
  }

  public deleteSession(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  public destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

let globalSessionStore: InMemorySessionStore;
export function getSessionStore(): InMemorySessionStore {
  if (!globalSessionStore) {
    globalSessionStore = new InMemorySessionStore();
  }
  return globalSessionStore;
}

// Helper to compare tokens in constant time to prevent timing attacks
export function constantTimeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// CORS Middleware with credentials and explicit allowed origin (no wildcard)
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Vary", "Origin");

  const origin = req.headers.origin;
  if (origin) {
    try {
      const originStr = new URL(origin).origin.toLowerCase();
      const allowed = getAllowedOrigins();
      if (allowed.includes(originStr)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
      } else {
        if (req.method === "OPTIONS") {
          res.status(403).json({ error: "Forbidden: Origin verification failed (preflight)" });
          return;
        }
      }
    } catch {
      if (req.method === "OPTIONS") {
        res.status(403).json({ error: "Forbidden: Invalid Origin header" });
        return;
      }
    }
  } else {
    if (req.method === "OPTIONS") {
      res.status(400).json({ error: "Bad Request: OPTIONS preflight missing Origin header" });
      return;
    }
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, Authorization, X-Request-ID");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

// Origin validation middleware (Only blocks state-changing requests with invalid origins)
export function validateOrigin(req: Request, res: Response, next: NextFunction): void {
  const method = req.method;

  // Safe methods do not require state-changing Origin validation
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  // Validate Origin header for all state-changing requests
  const origin = req.headers.origin;
  if (!origin) {
    res.status(403).json({ error: "Forbidden: Missing Origin header" });
    return;
  }

  let originStr: string;
  try {
    originStr = new URL(origin).origin.toLowerCase();
  } catch {
    res.status(403).json({ error: "Forbidden: Invalid Origin header" });
    return;
  }

  const allowed = getAllowedOrigins();
  if (!allowed.includes(originStr)) {
    res.status(403).json({ error: "Forbidden: Origin verification failed" });
    return;
  }

  next();
}

// CSRF validation middleware
export function validateCSRF(req: Request, res: Response, next: NextFunction): void {
  const method = req.method;

  // Safe methods do not require CSRF validation
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  // Bypass CSRF for session initialization since session/cookie/token is not established yet
  if (req.path === "/session" || req.path === "/session/") {
    next();
    return;
  }

  // Validate CSRF token
  const sessionId = req.cookies?.sessionId;
  if (!sessionId) {
    res.status(401).json({ error: "Unauthorized: Missing session cookie" });
    return;
  }

  const session = req.session;
  if (!session) {
    res.status(401).json({ error: "Unauthorized: Invalid or expired session" });
    return;
  }

  const clientCsrfToken = req.headers["x-csrf-token"] as string;
  if (!clientCsrfToken || !constantTimeCompare(clientCsrfToken, session.csrfToken)) {
    res.status(403).json({ error: "Forbidden: CSRF validation failed" });
    return;
  }

  next();
}

// Session loading middleware (Only loads, NEVER auto-creates unauthenticated session)
export function loadSession(req: Request, res: Response, next: NextFunction): void {
  const sessionStore = getSessionStore();
  const sessionId = req.cookies?.sessionId;
  let session: Session | undefined;

  const sessionTtl = 2 * 60 * 60 * 1000; // 2 Hours sliding TTL

  if (sessionId) {
    session = sessionStore.getSession(sessionId);
  }

  if (session) {
    // Sliding TTL: refresh expiration
    session.expiresAt = Date.now() + sessionTtl;

    // Refresh HttpOnly secure session cookie
    res.cookie("sessionId", session.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: sessionTtl, // 2 Hours sliding TTL
      secure: process.env.NODE_ENV === "production" || process.env.SECURE_COOKIES === "true",
    });

    // Bind session to request context
    req.session = session;
  }

  next();
}

// Protection middleware requiring an active session
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (!req.session) {
    res.status(401).json({ error: "Unauthorized: Active session required" });
    return;
  }
  next();
}

// Declare session property on Request in Express
declare global {
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}
