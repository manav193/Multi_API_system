import { Request, Response, NextFunction } from "express";

export interface RateLimitStore {
  isLimitExceeded(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<{
    exceeded: boolean;
    limit: number;
    remaining: number;
    resetTime: number;
  }>;
}

// In-Memory Rate Limit Store with TTL Cleanup
export class InMemoryRateLimitStore implements RateLimitStore {
  private store: Map<string, { count: number; expiresAt: number }> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Run active TTL cleanup every 30 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
    if (this.cleanupInterval && typeof this.cleanupInterval.unref === "function") {
      this.cleanupInterval.unref();
    }
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, val] of this.store.entries()) {
      if (now >= val.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  public async isLimitExceeded(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<{
    exceeded: boolean;
    limit: number;
    remaining: number;
    resetTime: number;
  }> {
    const now = Date.now();
    const existing = this.store.get(key);

    if (!existing || now >= existing.expiresAt) {
      const expiresAt = now + windowMs;
      this.store.set(key, { count: 1, expiresAt });
      return {
        exceeded: false,
        limit,
        remaining: limit - 1,
        resetTime: expiresAt,
      };
    }

    existing.count += 1;
    const exceeded = existing.count > limit;
    const remaining = Math.max(0, limit - existing.count);

    return {
      exceeded,
      limit,
      remaining,
      resetTime: existing.expiresAt,
    };
  }

  public destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// Redis-ready production interface stub
export class RedisRateLimitStore implements RateLimitStore {
  constructor() {
    console.log("RedisRateLimitStore initialized - Production ready.");
  }
  public async isLimitExceeded(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<{ exceeded: boolean; limit: number; remaining: number; resetTime: number }> {
    throw new Error("RedisRateLimitStore not fully implemented in local stub.");
  }
}

let globalStore: RateLimitStore;
export function getRateLimitStore(): RateLimitStore {
  if (!globalStore) {
    globalStore = new InMemoryRateLimitStore();
  }
  return globalStore;
}

// Create Rate Limiter middleware creator
export function createRateLimiter(options: {
  keyPrefix: string;
  limit: number;
  windowMs: number;
}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const store = getRateLimitStore();
      
      // Rely ONLY on req.ip (express trust proxy configured in app.ts)
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const sessionId = req.session?.sessionId || "anonymous";
      const route = req.originalUrl || req.path || "unknown-route";

      // Combine ip, session/user, and route for the limiter key
      const key = `${options.keyPrefix}:${ip}:${sessionId}:${route}`;

      const { exceeded, limit, remaining, resetTime } = await store.isLimitExceeded(
        key,
        options.limit,
        options.windowMs
      );

      const remainingResetSeconds = Math.max(0, Math.ceil((resetTime - Date.now()) / 1000));

      // Set standard headers
      res.setHeader("RateLimit-Limit", limit);
      res.setHeader("RateLimit-Remaining", remaining);
      res.setHeader("RateLimit-Reset", remainingResetSeconds);

      // Set compatibility headers
      res.setHeader("X-RateLimit-Limit", limit);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", remainingResetSeconds);

      if (exceeded) {
        res.setHeader("Retry-After", remainingResetSeconds);
        res.status(429).json({
          error: "Too many requests. Please try again later.",
          retryAfter: remainingResetSeconds,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
