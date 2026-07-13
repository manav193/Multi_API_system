import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { KeyRegistryEntry } from "../../shared/types.js";

export interface Session {
  sessionId: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
  keys: Map<string, KeyRegistryEntry>;
}

// Parse ALLOWED_ORIGINS as an explicit normalized allowlist
export function getAllowedOrigins(): string[] {
  const origins = [
    process.env.APP_URL,
    process.env.ALLOWED_ORIGINS,
    "http://localhost:3000",
  ].filter(Boolean);

  const parsed: string[] = [];
  for (const o of origins) {
    const split = o.split(/[,\s]+/);
    for (const item of split) {
      const trimmed = item.trim().toLowerCase();
      if (!trimmed) continue;
      try {
        const originUrl = new URL(trimmed);
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

  public createSession(): Session {
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
  const origin = req.headers.origin;
  if (origin) {
    try {
      const originStr = new URL(origin).origin.toLowerCase();
      const allowed = getAllowedOrigins();
      if (allowed.includes(originStr)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }
    } catch {
      // Ignore URL parse error
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

// Origin validation and CSRF middleware
export function validateOriginAndCSRF(req: Request, res: Response, next: NextFunction): void {
  const method = req.method;

  // Safe methods do not require CSRF or state-changing Origin validation
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  // 1. Validate Origin header for all state-changing requests (including POST /api/session)
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

  // Bypass CSRF for session initialization since session/cookie/token is not established yet
  if (req.path === "/session" || req.path === "/session/") {
    next();
    return;
  }

  // 2. Validate CSRF token
  const sessionId = req.cookies?.sessionId;
  if (!sessionId) {
    res.status(401).json({ error: "Unauthorized: Missing session cookie" });
    return;
  }

  const sessionStore = getSessionStore();
  const session = sessionStore.getSession(sessionId);
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

// Session authentication and loading middleware with sliding TTL
export function loadSession(req: Request, res: Response, next: NextFunction): void {
  const sessionStore = getSessionStore();
  let sessionId = req.cookies?.sessionId;
  let session: Session | undefined;

  const sessionTtl = 2 * 60 * 60 * 1000; // 2 Hours sliding TTL

  if (sessionId) {
    session = sessionStore.getSession(sessionId);
  }

  if (session) {
    // Sliding TTL: refresh expiration
    session.expiresAt = Date.now() + sessionTtl;
  } else {
    session = sessionStore.createSession();
  }

  // Set or refresh HttpOnly secure session cookie
  res.cookie("sessionId", session.sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: sessionTtl, // 2 Hours sliding TTL
    secure: process.env.NODE_ENV === "production" || process.env.SECURE_COOKIES === "true",
  });

  // Bind session to request context
  req.session = session;
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
