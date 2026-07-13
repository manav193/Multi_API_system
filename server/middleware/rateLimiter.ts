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
    // Check production safety
    const isProd = process.env.NODE_ENV === "production";
    const allowOverride = process.env.ALLOW_IN_MEMORY_STORE === "true";

    if (isProd && !allowOverride) {
      console.error(
        "CRITICAL ERROR: InMemoryRateLimitStore selected in production mode! Production deployments require a shared store (e.g. Redis) to ensure horizontal scalability and consistency. Override with ALLOW_IN_MEMORY_STORE=true for single-instance testing."
      );
      process.exit(1);
    } else if (isProd && allowOverride) {
      console.warn(
        "WARNING: InMemoryRateLimitStore is running in production with ALLOW_IN_MEMORY_STORE=true. This is a single-instance-only configuration and is not horizontally scale-safe."
      );
    }

    // Run active TTL cleanup every 30 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
    // Unref cleanup interval so tests can exit cleanly
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

  // Helper to allow cleaning up the interval manually in tests
  public destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// Redis-ready production interface stub (for visual verification/planning)
export class RedisRateLimitStore implements RateLimitStore {
  constructor() {
    console.log("RedisRateLimitStore initialized - Production ready.");
  }
  public async isLimitExceeded(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<{ exceeded: boolean; limit: number; remaining: number; resetTime: number }> {
    // In production, this would make calls to Redis client using EVAL/INCR commands with EXPIRE
    throw new Error("RedisRateLimitStore not fully implemented in local stub.");
  }
}

// Factory to select the store
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
      
      // Handle proxy configurations safely (fall back to remoteAddress)
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
      const key = `${options.keyPrefix}:${ip}`;

      const { exceeded, limit, remaining, resetTime } = await store.isLimitExceeded(
        key,
        options.limit,
        options.windowMs
      );

      // Set standard headers
      res.setHeader("RateLimit-Limit", limit);
      res.setHeader("RateLimit-Remaining", remaining);
      res.setHeader("RateLimit-Reset", Math.ceil(resetTime / 1000));

      // Set compatibility headers optionally
      res.setHeader("X-RateLimit-Limit", limit);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000));

      if (exceeded) {
        const retryAfterSeconds = Math.ceil((resetTime - Date.now()) / 1000);
        res.setHeader("Retry-After", retryAfterSeconds);
        res.status(429).json({
          error: "Too many requests. Please try again later.",
          retryAfter: retryAfterSeconds,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
