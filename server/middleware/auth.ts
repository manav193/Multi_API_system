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

// In-Memory Session Store with TTL Cleanup
export class InMemorySessionStore {
  private sessions: Map<string, Session> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    const isProd = process.env.NODE_ENV === "production";
    const allowOverride = process.env.ALLOW_IN_MEMORY_STORE === "true";

    if (isProd && !allowOverride) {
      console.error(
        "CRITICAL ERROR: InMemorySessionStore selected in production mode! Please set ALLOW_IN_MEMORY_STORE=true for single-instance testing or use Redis."
      );
      process.exit(1);
    }

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
    const expiresAt = now + 24 * 60 * 60 * 1000; // 24 Hours

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

// Origin validation middleware
export function validateOriginAndCSRF(req: Request, res: Response, next: NextFunction): void {
  const method = req.method;

  // Safe methods do not require CSRF/Origin validation
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  // Bypass session initialization endpoint
  if (req.path === "/session" || req.path === "/session/") {
    next();
    return;
  }

  // Validate Origin header
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;

  // In production, enforce exact Origin verification
  if (process.env.NODE_ENV === "production" && origin) {
    const allowedOrigins = [
      process.env.APP_URL,
      `http://${host}`,
      `https://${host}`,
    ].filter(Boolean);

    const isAllowed = allowedOrigins.some((allowed) => {
      if (!allowed) return false;
      return origin.startsWith(allowed) || allowed.startsWith(origin);
    });

    if (!isAllowed) {
      res.status(403).json({ error: "Forbidden: Origin verification failed" });
      return;
    }
  }

  // Validate CSRF token
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

// Session authentication and loading middleware
export function loadSession(req: Request, res: Response, next: NextFunction): void {
  const sessionStore = getSessionStore();
  let sessionId = req.cookies?.sessionId;
  let session: Session | undefined;

  if (sessionId) {
    session = sessionStore.getSession(sessionId);
  }

  // If no session exists or it has expired, create a fresh one automatically
  if (!session) {
    session = sessionStore.createSession();
    
    // Set HttpOnly secure session cookie
    res.cookie("sessionId", session.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60 * 1000, // 24 Hours
      secure: process.env.NODE_ENV === "production" || process.env.SECURE_COOKIES === "true",
    });
  }

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
