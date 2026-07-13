import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createApp } from "../server/app.js";
import { getSessionStore } from "../server/middleware/auth.js";
import { getRateLimitStore } from "../server/middleware/rateLimiter.js";
import { providerRegistry } from "../server/providers/registry.js";
import { AIProvider, ProviderError } from "../server/providers/types.js";
import { SERVER_ONLY_CANARY } from "../server/canary.js";

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
    process.env.TRUST_PROXY = "false"; // Disable proxy trust in tests to ignore forged X-Forwarded-For headers
    process.env.GEMINI_API_KEY = "AIzaSyTestSystemDefaultKeyConfiguredForTesting";
    process.env.ALLOWED_ORIGINS = "https://trusted.com,http://localhost:3000";
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

  describe("1. Origin and CSRF Validation", () => {
    it("should accept a state-changing POST request from an exact-match trusted origin", async () => {
      const res = await request(app)
        .post("/api/session")
        .set("Origin", "https://trusted.com")
        .expect(200);

      expect(res.body).toHaveProperty("csrfToken");
    });

    it("should reject state-changing POST request with missing Origin header", async () => {
      await request(app)
        .post("/api/session")
        .expect(403);
    });

    it("should reject state-changing POST request with a malicious domain prefixing allowed domain (e.g. trusted.com.evil.com)", async () => {
      const res = await request(app)
        .post("/api/session")
        .set("Origin", "https://trusted.com.evil.com")
        .expect(403);

      expect(res.body.error).toContain("Forbidden");
    });

    it("should reject state-changing POST request with malformed Origin URL", async () => {
      await request(app)
        .post("/api/session")
        .set("Origin", "not-a-valid-url")
        .expect(403);
    });
  });

  describe("2. Rate Limit Identity and Bypass Protection", () => {
    it("should block forged X-Forwarded-For bypass attempts", async () => {
      // Establish session with a trusted origin
      const sessionRes = await request(app)
        .post("/api/session")
        .set("Origin", "https://trusted.com")
        .expect(200);

      const cookie = sessionRes.headers["set-cookie"][0].split(";")[0];
      const csrf = sessionRes.body.csrfToken;

      // Hit rate limiter threshold under the same IP (which is 127.0.0.1 since trust proxy is false)
      // The validator limiter limit is 15 requests/min.
      for (let i = 0; i < 15; i++) {
        await request(app)
          .post("/api/validate-key")
          .set("Origin", "https://trusted.com")
          .set("Cookie", cookie)
          .set("X-CSRF-Token", csrf)
          .send({ keyId: "system-default" })
          .expect(200);
      }

      // Try with a forged X-Forwarded-For header - it must STILL trigger 429 because rate-limit identity is not fooled!
      const limitRes = await request(app)
        .post("/api/validate-key")
        .set("Origin", "https://trusted.com")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .set("X-Forwarded-For", "9.9.9.9")
        .send({ keyId: "system-default" })
        .expect(429);

      expect(limitRes.headers).toHaveProperty("ratelimit-reset");
      expect(limitRes.body.error).toContain("Too many requests");
    });
  });

  describe("3. Redacted Structured Logger and Error Sanitization", () => {
    it("should successfully redact sensitive formats (API keys, cookies, paths) from logged strings", async () => {
      const mockBadProvider: AIProvider = {
        id: "gemini",
        name: "Google Gemini",
        capabilities: { chat: true, imageGeneration: false, streaming: false },
        models: [{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" }],
        chat: async () => {
          throw new Error("Failed key check: AIzaSyFakeSecret123. Path: /app/applet/server/routes/ai.ts. Cookie: sessionId=abc-123.");
        },
      };

      vi.spyOn(providerRegistry, "get").mockReturnValue(mockBadProvider);

      const sessionRes = await request(app)
        .post("/api/session")
        .set("Origin", "https://trusted.com")
        .expect(200);

      const cookie = sessionRes.headers["set-cookie"][0].split(";")[0];
      const csrf = sessionRes.body.csrfToken;

      // Spy on console.error
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await request(app)
        .post("/api/chat")
        .set("Origin", "https://trusted.com")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .send({
          messages: [{ role: "user", content: "hello" }],
          credentials: { mode: "system" },
        })
        .expect(500);

      expect(consoleSpy).toHaveBeenCalled();
      const lastCallArg = consoleSpy.mock.calls[0][0];
      
      // Ensure the logged string is structured JSON and contains NO raw secret keys, paths, or cookies
      const parsedLog = JSON.parse(lastCallArg);
      expect(parsedLog.message).not.toContain("AIzaSyFakeSecret123");
      expect(parsedLog.message).not.toContain("/app/applet");
      expect(parsedLog.message).not.toContain("sessionId=abc-123");
      expect(parsedLog.message).toContain("[REDACTED_API_KEY]");
      expect(parsedLog.message).toContain("[REDACTED_PATH]");

      consoleSpy.mockRestore();
      vi.restoreAllMocks();
    });
  });

  describe("4. Session Sliding TTL and Logout Behavior", () => {
    it("should allow session logout and clear the session cookie cleanly", async () => {
      // 1. Establish session
      const sessionRes = await request(app)
        .post("/api/session")
        .set("Origin", "https://trusted.com")
        .expect(200);

      const cookie = sessionRes.headers["set-cookie"][0].split(";")[0];
      const csrf = sessionRes.body.csrfToken;

      // 2. Log out
      const logoutRes = await request(app)
        .post("/api/session/logout")
        .set("Origin", "https://trusted.com")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .expect(200);

      expect(logoutRes.body).toEqual({ success: true });

      // Cookie should be cleared in the headers
      const setCookie = logoutRes.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      const cookieStr = setCookie.join("; ");
      expect(cookieStr).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    });
  });

  describe("5. Key Validation & Registry Idempotency", () => {
    it("should omit maskedKey and return registered keys cleanly, registering idempotently", async () => {
      // Establish session
      const sessionRes = await request(app)
        .post("/api/session")
        .set("Origin", "https://trusted.com")
        .expect(200);

      const cookie = sessionRes.headers["set-cookie"][0].split(";")[0];
      const csrf = sessionRes.body.csrfToken;

      // Mock live verification success
      const mockVerifyProvider: AIProvider = {
        id: "gemini",
        name: "Google Gemini",
        capabilities: { chat: true, imageGeneration: false, streaming: false },
        models: [{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" }],
        chat: async () => ({ text: "Ping success" }),
      };
      vi.spyOn(providerRegistry, "get").mockReturnValue(mockVerifyProvider);

      const testKey = "AIzaSyTestKey12345678901234567890123";

      // Register key first time
      const regRes1 = await request(app)
        .post("/api/session/keys")
        .set("Origin", "https://trusted.com")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .send({ key: testKey, label: "My Test Key" })
        .expect(200);

      expect(regRes1.body).toHaveProperty("keyId");
      expect(regRes1.body).not.toHaveProperty("maskedKey"); // Ensure no maskedKey returned!
      const keyId = regRes1.body.keyId;

      // Register key second time (idempotency check)
      const regRes2 = await request(app)
        .post("/api/session/keys")
        .set("Origin", "https://trusted.com")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .send({ key: testKey, label: "My Test Key" })
        .expect(200);

      expect(regRes2.body.keyId).toBe(keyId); // Idempotent!

      // Fetch keys pool
      const listRes = await request(app)
        .get("/api/session/keys")
        .set("Origin", "https://trusted.com")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .expect(200);

      expect(listRes.body.length).toBe(1);
      expect(listRes.body[0]).not.toHaveProperty("maskedKey"); // Omitted!
      expect(listRes.body[0]).toHaveProperty("keyId", keyId);
      expect(listRes.body[0]).toHaveProperty("label", "My Test Key");

      vi.restoreAllMocks();
    });
  });

  describe("6. Strict Zod Schema Rejection", () => {
    it("should reject requests containing unknown fields under strict schema validation", async () => {
      const sessionRes = await request(app)
        .post("/api/session")
        .set("Origin", "https://trusted.com")
        .expect(200);

      const cookie = sessionRes.headers["set-cookie"][0].split(";")[0];
      const csrf = sessionRes.body.csrfToken;

      await request(app)
        .post("/api/session/keys")
        .set("Origin", "https://trusted.com")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .send({ key: "AIzaSyTestKey12345678901234567890123", extraField: "not-allowed" })
        .expect(400);
    });

    it("should reject BYOK credentials structure with out-of-bound activeKeyIndex", async () => {
      const sessionRes = await request(app)
        .post("/api/session")
        .set("Origin", "https://trusted.com")
        .expect(200);

      const cookie = sessionRes.headers["set-cookie"][0].split(";")[0];
      const csrf = sessionRes.body.csrfToken;

      await request(app)
        .post("/api/chat")
        .set("Origin", "https://trusted.com")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .send({
          messages: [{ role: "user", content: "hello" }],
          credentials: {
            mode: "byok",
            keyIds: ["11111111-1111-4111-a111-111111111111"],
            activeKeyIndex: 5, // Must be < array length (which is 1)
          }
        })
        .expect(400);
    });
  });

  describe("7. Boundary and Canary Builds Verification", () => {
    it("should ensure the server-only canary secret is completely absent from static build assets", { timeout: 45000 }, () => {
      // Run production build
      console.log("[TEST BUILD] Running npm run build...");
      execSync("npm run build", { stdio: "inherit" });

      const distClientPath = path.join(process.cwd(), "dist", "client");
      expect(fs.existsSync(distClientPath)).toBe(true);

      const scanDirectory = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            scanDirectory(fullPath);
          } else if (file.endsWith(".js") || file.endsWith(".html") || file.endsWith(".css")) {
            const content = fs.readFileSync(fullPath, "utf-8");
            expect(content).not.toContain(SERVER_ONLY_CANARY);
          }
        }
      };

      scanDirectory(distClientPath);
      console.log("[TEST BUILD] Verified: SERVER_ONLY_CANARY is completely absent from all client assets.");
    });

    it("should ensure source code files in src/ and shared/ do not import anything from server/", () => {
      const checkImports = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            checkImports(fullPath);
          } else if (file.endsWith(".ts") || file.endsWith(".tsx")) {
            const content = fs.readFileSync(fullPath, "utf-8");
            // Check for relative imports pointing to server/ (e.g., ../server/, /server/, server/)
            const serverImportRegex = /from\s+["'](\.\.\/)*server\//gi;
            expect(content).not.toMatch(serverImportRegex);
          }
        }
      };

      checkImports(path.join(process.cwd(), "src"));
      checkImports(path.join(process.cwd(), "shared"));
      console.log("[TEST BOUNDARY] Verified: No client files import from server modules.");
    });
  });
});
