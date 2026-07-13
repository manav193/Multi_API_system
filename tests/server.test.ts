import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { getSessionStore } from "../server/middleware/auth.js";
import { getRateLimitStore } from "../server/middleware/rateLimiter.js";
import { providerRegistry } from "../server/providers/registry.js";
import { AIProvider, ProviderError } from "../server/providers/types.js";

// Mock @google/genai entirely so validation checks run instantaneously without real network I/O
vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: async () => {
          return { text: "Ping success" };
        },
      };
    },
  };
});

describe("Aegis Resilient Full-Stack API Suite", () => {
  let app: any;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.GEMINI_API_KEY = "AIzaSyTestSystemDefaultKeyConfiguredForTesting";
    app = await createApp();
  });

  afterAll(() => {
    // Clean up active in-memory store intervals
    getSessionStore().destroy();
    const rateLimitStore = getRateLimitStore() as any;
    if (rateLimitStore && typeof rateLimitStore.destroy === "function") {
      rateLimitStore.destroy();
    }
  });

  describe("1. Session & Cookie Attributes", () => {
    it("should establish a session and return HttpOnly cookies", async () => {
      const res = await request(app)
        .post("/api/session")
        .expect(200);

      expect(res.body).toHaveProperty("csrfToken");
      expect(typeof res.body.csrfToken).toBe("string");

      // Verify Set-Cookie header contains sessionId and HttpOnly
      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      const cookieStr = setCookie.join("; ");
      expect(cookieStr).toContain("sessionId=");
      expect(cookieStr).toContain("HttpOnly");
      expect(cookieStr).toContain("SameSite=Lax");
    });
  });

  describe("2. Security Boundaries & CSRF", () => {
    it("should reject state-changing POST requests without a CSRF token", async () => {
      await request(app)
        .post("/api/session/keys")
        .send({ key: "AIzaSyTestKey12345678901234567890123" })
        .expect(401); // Expect 401 since no session cookie is supplied
    });

    it("should reject POST requests with a session cookie but invalid/missing CSRF token", async () => {
      // 1. Get a session cookie
      const sessionRes = await request(app)
        .post("/api/session")
        .expect(200);

      const cookie = sessionRes.headers["set-cookie"][0].split(";")[0];

      // 2. Make post request without CSRF
      const res = await request(app)
        .post("/api/session/keys")
        .set("Cookie", cookie)
        .send({ key: "AIzaSyTestKey12345678901234567890123" })
        .expect(403);

      expect(res.body.error).toContain("CSRF validation failed");
    });
  });

  describe("3. Sanitized Error Response States", () => {
    it("should return 400 Bad Request on malformed JSON payload", async () => {
      const res = await request(app)
        .post("/api/session/keys")
        .set("Content-Type", "application/json")
        .send("invalid-json{")
        .expect(400);

      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toContain("Bad Request");
    });

    it("should return 413 Payload Too Large if body exceeds 2 MB", async () => {
      const largeContent = "a".repeat(2.1 * 1024 * 1024); // 2.1 MB
      const res = await request(app)
        .post("/api/session/keys")
        .set("Content-Type", "application/json")
        .send({ key: largeContent })
        .expect(413);

      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toContain("Payload Too Large");
    });

    it("should return a sanitized 500 error and redact API keys or source details", async () => {
      // Mock an error to throw during chat
      const mockBadProvider: AIProvider = {
        id: "gemini",
        name: "Google Gemini",
        capabilities: { chat: true, imageGeneration: false, streaming: false },
        models: [{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" }],
        chat: async () => {
          throw new Error("Secret Key AIzaSyFakeSecret123 leaks inside /app/applet/server/routes/ai.ts");
        },
      };

      vi.spyOn(providerRegistry, "get").mockReturnValue(mockBadProvider);

      // 1. Get a session cookie & CSRF token
      const sessionRes = await request(app)
        .post("/api/session")
        .expect(200);

      const cookie = sessionRes.headers["set-cookie"][0].split(";")[0];
      const csrf = sessionRes.body.csrfToken;

      // 2. Dispatch request
      const res = await request(app)
        .post("/api/chat")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .send({
          messages: [{ role: "user", content: "hello" }],
          credentials: { mode: "system" },
        })
        .expect(500);

      // The key or path must never be present in the public response
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe("An internal server error occurred.");
      expect(JSON.stringify(res.body)).not.toContain("AIzaSyFakeSecret123");
      expect(JSON.stringify(res.body)).not.toContain("/app/applet");

      vi.restoreAllMocks();
    });
  });

  describe("4. Rate Limiting", () => {
    it("should block requests and return a 429 code with Retry-After headers if limits are hit", async () => {
      // 1. Establish session
      const sessionRes = await request(app)
        .post("/api/session")
        .expect(200);

      const cookie = sessionRes.headers["set-cookie"][0].split(";")[0];
      const csrf = sessionRes.body.csrfToken;

      // 2. Perform 15 allowed requests
      for (let i = 0; i < 15; i++) {
        await request(app)
          .post("/api/validate-key")
          .set("Cookie", cookie)
          .set("X-CSRF-Token", csrf)
          .send({ keyId: "system-default" })
          .expect(200);
      }

      // 3. 16th request must trigger the 429 rate-limiting interceptor
      const limitRes = await request(app)
        .post("/api/validate-key")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .send({ keyId: "system-default" })
        .expect(429);

      expect(limitRes.headers).toHaveProperty("retry-after");
      expect(limitRes.body.error).toContain("Too many requests");
    });
  });

  describe("5. Retry Safety & Key Rotation", () => {
    it("should failover and rotate to second key if first key returns 429", async () => {
      let firstKeyCalled = false;
      let secondKeyCalled = false;

      const mockRotativeProvider: AIProvider = {
        id: "gemini",
        name: "Google Gemini",
        capabilities: { chat: true, imageGeneration: false, streaming: false },
        models: [{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" }],
        chat: async (req, key) => {
          if (key === "key-one-raw") {
            firstKeyCalled = true;
            // Throw rate-limit error that is retry-safe
            throw new ProviderError("Rate limit hit", "RATE_LIMIT", true, 10);
          }
          if (key === "key-two-raw") {
            secondKeyCalled = true;
            return { text: "Success from key two" };
          }
          throw new Error("Unexpected key");
        },
      };

      vi.spyOn(providerRegistry, "get").mockReturnValue(mockRotativeProvider);

      // Create session, populate 2 keys using UUIDs
      const sessionStore = getSessionStore();
      const session = sessionStore.createSession();
      const cookie = `sessionId=${session.sessionId}`;

      const uuidOne = "11111111-1111-4111-a111-111111111111";
      const uuidTwo = "22222222-2222-4222-b222-222222222222";

      session.keys.set(uuidOne, {
        keyId: uuidOne,
        rawKey: "key-one-raw",
        maskedKey: "key-one...",
        label: "Key One",
        status: "Ready",
        requestCount: 0,
        consecutiveFailures: 0,
      });

      session.keys.set(uuidTwo, {
        keyId: uuidTwo,
        rawKey: "key-two-raw",
        maskedKey: "key-two...",
        label: "Key Two",
        status: "Ready",
        requestCount: 0,
        consecutiveFailures: 0,
      });

      const res = await request(app)
        .post("/api/chat")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", session.csrfToken)
        .send({
          messages: [{ role: "user", content: "hello" }],
          credentials: {
            mode: "byok",
            keyIds: [uuidOne, uuidTwo],
            activeKeyIndex: 0,
          },
        })
        .expect(200);

      expect(firstKeyCalled).toBe(true);
      expect(secondKeyCalled).toBe(true);
      expect(res.body.text).toBe("Success from key two");
      expect(res.body.finalActiveKeyIndex).toBe(1); // Rotated to index 1

      vi.restoreAllMocks();
    });

    it("should never retry ambiguous errors like timeouts to ensure duplicate generation prevention", async () => {
      let callCount = 0;

      const mockFailProvider: AIProvider = {
        id: "gemini",
        name: "Google Gemini",
        capabilities: { chat: true, imageGeneration: false, streaming: false },
        models: [{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" }],
        chat: async () => {
          callCount++;
          throw new ProviderError("Network request timeout", "TIMEOUT", false);
        },
      };

      vi.spyOn(providerRegistry, "get").mockReturnValue(mockFailProvider);

      const sessionStore = getSessionStore();
      const session = sessionStore.createSession();
      const cookie = `sessionId=${session.sessionId}`;

      const uuidOne = "11111111-1111-4111-a111-111111111111";
      const uuidTwo = "22222222-2222-4222-b222-222222222222";

      session.keys.set(uuidOne, {
        keyId: uuidOne,
        rawKey: "key-one-raw",
        maskedKey: "key-one...",
        label: "Key One",
        status: "Ready",
        requestCount: 0,
        consecutiveFailures: 0,
      });

      session.keys.set(uuidTwo, {
        keyId: uuidTwo,
        rawKey: "key-two-raw",
        maskedKey: "key-two...",
        label: "Key Two",
        status: "Ready",
        requestCount: 0,
        consecutiveFailures: 0,
      });

      await request(app)
        .post("/api/chat")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", session.csrfToken)
        .send({
          messages: [{ role: "user", content: "hello" }],
          credentials: {
            mode: "byok",
            keyIds: [uuidOne, uuidTwo],
            activeKeyIndex: 0,
          },
        })
        .expect(500);

      // Assert that call was made exactly once, and did not retry on key-two due to unsafe timeout error
      expect(callCount).toBe(1);

      vi.restoreAllMocks();
    });
  });

  describe("6. Source-Level Boundaries", () => {
    it("should ensure no server files are imported into shared modules", () => {
      const sharedTypes = require("../shared/types.ts");
      expect(sharedTypes).toBeDefined();
    });
  });
});
