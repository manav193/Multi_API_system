import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createApp } from "../server/app.js";
import { getSessionStore } from "../server/middleware/auth.js";
import { getRateLimitStore } from "../server/middleware/rateLimiter.js";
import { providerRegistry } from "../server/providers/registry.js";
import { AIProvider } from "../server/providers/types.js";
import { SERVER_ONLY_CANARY } from "../server/canary.js";
import { AppConfigError } from "../server/middleware/error.js";
import { requestTimeout } from "../server/middleware/security.js";

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

  describe("2. CORS and Vary Headers Protection", () => {
    it("should include Vary: Origin header in all responses", async () => {
      const res = await request(app)
        .post("/api/session")
        .set("Origin", "https://trusted.com")
        .expect(200);

      expect(res.headers["vary"]).toContain("Origin");
    });

    it("should accept permitted preflight OPTIONS requests", async () => {
      await request(app)
        .options("/api/session")
        .set("Origin", "https://trusted.com")
        .expect(204);
    });

    it("should reject preflight OPTIONS requests from unallowed origins", async () => {
      await request(app)
        .options("/api/session")
        .set("Origin", "https://malicious.com")
        .expect(403);
    });

    it("should reject preflight OPTIONS requests with missing origin", async () => {
      await request(app)
        .options("/api/session")
        .expect(400);
    });
  });

  describe("3. Rate Limit Identity and Bypass Protection", () => {
    it("should block forged X-Forwarded-For bypass attempts and route query normalization", async () => {
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
          .post("/api/validate-key?attempt=" + i) // Vary query string, must NOT bypass rate limiter because of path normalization
          .set("Origin", "https://trusted.com")
          .set("Cookie", cookie)
          .set("X-CSRF-Token", csrf)
          .send({ keyId: "system-default" })
          .expect(200);
      }

      // Try with a forged X-Forwarded-For header - it must STILL trigger 429 because rate-limit identity is not fooled!
      const limitRes = await request(app)
        .post("/api/validate-key?attempt=final")
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

  describe("4. Redacted Structured Logger and Error Sanitization", () => {
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

  describe("5. Session Limits and Logout Behavior", () => {
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

    it("should enforce the maximum session cap of 10 per IP", () => {
      const store = getSessionStore();
      const ip = "192.168.1.100";

      // Create 10 sessions successfully
      for (let i = 0; i < 10; i++) {
        store.createSession(ip);
      }

      // 11th creation must throw an error due to IP limits
      expect(() => store.createSession(ip)).toThrow("Active session limit reached for this IP.");
    });
  });

  describe("6. Key Validation & Registry Idempotency", () => {
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

  describe("7. Strict Zod Schema Rejection & Image Lab Payload Contract", () => {
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

    it("should accept valid Image Lab payloads using standard frontend size enums", async () => {
      const sessionRes = await request(app)
        .post("/api/session")
        .set("Origin", "https://trusted.com")
        .expect(200);

      const cookie = sessionRes.headers["set-cookie"][0].split(";")[0];
      const csrf = sessionRes.body.csrfToken;

      const mockImageProvider: AIProvider = {
        id: "gemini",
        name: "Google Gemini",
        capabilities: { chat: false, imageGeneration: true, streaming: false },
        models: [{ id: "gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image" }],
        generateImage: async () => ({ imageUrl: "data:image/png;base64,mocked" }),
      };
      vi.spyOn(providerRegistry, "get").mockReturnValue(mockImageProvider);

      // Verify "2K" is accepted without Zod 400 rejection (aligned to frontend select drop-down)
      await request(app)
        .post("/api/generate-image")
        .set("Origin", "https://trusted.com")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .send({
          prompt: "sunset over beach",
          imageSize: "2K",
          aspectRatio: "16:9",
          credentials: { mode: "system" }
        })
        .expect(200);

      vi.restoreAllMocks();
    });
  });

  describe("8. AbortSignal and 504 Gateway Timeout Verification", () => {
    it("should abort the request-scoped AbortController and return 504 on gateway timeout", () => {
      const mockReq: any = {
        on: vi.fn(),
      };
      const mockRes: any = {
        on: vi.fn(),
        headersSent: false,
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const mockNext = vi.fn();
      
      let timeoutCallback: any;
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((cb: any) => {
        timeoutCallback = cb;
        return { unref: () => {} };
      }) as any;
      
      try {
        requestTimeout(mockReq, mockRes, mockNext);
        
        expect(mockReq.abortController).toBeDefined();
        expect(mockReq.abortController.signal.aborted).toBe(false);
        
        // Fire timeout callback artificially to simulate 30s timeout
        timeoutCallback();
        
        expect(mockReq.timedOut).toBe(true);
        expect(mockReq.abortController.signal.aborted).toBe(true);
        expect(mockRes.status).toHaveBeenCalledWith(504);
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
          error: expect.stringContaining("Gateway Timeout"),
        }));
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    });
  });

  describe("9. Production Environment Safety Failures", () => {
    it("should reject startup in production mode if single-instance in-memory stores are unapproved", async () => {
      // Set to production mode without bypass flag set
      const previousEnv = process.env.NODE_ENV;
      const previousOverride = process.env.ALLOW_IN_MEMORY_STORE;
      
      process.env.NODE_ENV = "production";
      process.env.ALLOW_IN_MEMORY_STORE = "false";
      
      await expect(createApp()).rejects.toThrow(AppConfigError);

      // Restore values
      process.env.NODE_ENV = previousEnv;
      process.env.ALLOW_IN_MEMORY_STORE = previousOverride;
    });
  });

  describe("10. Structural Boundary and Canary Verification", () => {
    it("should ensure the server-only canary secret is completely absent from static build assets and present in server bundle", { timeout: 45000 }, () => {
      console.log("[TEST BUILD] Running npm run build...");
      execSync("npm run build", { stdio: "inherit" });

      // Verify canary exists in the built server bundle
      const serverBundlePath = path.join(process.cwd(), "dist", "server", "index.cjs");
      expect(fs.existsSync(serverBundlePath)).toBe(true);
      const serverContent = fs.readFileSync(serverBundlePath, "utf-8");
      expect(serverContent).toContain(SERVER_ONLY_CANARY);

      // Verify canary is absent from dist/client
      const distClientPath = path.join(process.cwd(), "dist", "client");
      expect(fs.existsSync(distClientPath)).toBe(true);

      const scanClientDirForCanary = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            scanClientDirForCanary(fullPath);
          } else if (file.endsWith(".js") || file.endsWith(".html") || file.endsWith(".css")) {
            const content = fs.readFileSync(fullPath, "utf-8");
            expect(content).not.toContain(SERVER_ONLY_CANARY);
          }
        }
      };

      scanClientDirForCanary(distClientPath);
      console.log("[TEST BUILD] Verified: SERVER_ONLY_CANARY is completely absent from all client assets.");
    });

    it("should ensure client and shared code do not structurally import from the server directory", () => {
      const checkStructuralDependencies = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            checkStructuralDependencies(fullPath);
          } else if (file.endsWith(".ts") || file.endsWith(".tsx")) {
            const content = fs.readFileSync(fullPath, "utf-8");
            
            // Clean up code blocks to prevent false positive regex matches on comments
            const cleanContent = content
              .replace(/\/\*[\s\S]*?\*\//g, "") // Block comments
              .replace(/\/\/.*/g, "");          // Line comments
              
            const importRegex = /(?:import|export)\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g;
            let match;
            while ((match = importRegex.exec(cleanContent)) !== null) {
              const importPath = match[1];
              const resolvedPath = path.resolve(path.dirname(fullPath), importPath);
              const serverPath = path.resolve(process.cwd(), "server");
              
              if (resolvedPath.startsWith(serverPath)) {
                throw new Error(
                  `Dependency boundary violated! Client/Shared file "${fullPath}" structurally imports server file "${importPath}"`
                );
              }
            }
          }
        }
      };

      checkStructuralDependencies(path.join(process.cwd(), "src"));
      checkStructuralDependencies(path.join(process.cwd(), "shared"));
      console.log("[TEST BOUNDARY] Verified: No client files import from server modules.");
    });
  });

  describe("11. Production Mode Configuration & Cookie Behaviour", () => {
    it("should use production cookie configurations (secure: true) in production mode", async () => {
      const previousEnv = process.env.NODE_ENV;
      const previousOverride = process.env.ALLOW_IN_MEMORY_STORE;
      const previousAppUrl = process.env.APP_URL;

      process.env.NODE_ENV = "production";
      process.env.ALLOW_IN_MEMORY_STORE = "true"; // Approved for single-instance testing
      process.env.APP_URL = "https://trusted.com";
      
      const prodApp = await createApp();
      
      const res = await request(prodApp)
        .post("/api/session")
        .set("Origin", "https://trusted.com")
        .expect(200);
      
      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      const cookieStr = setCookie.join("; ");
      expect(cookieStr).toContain("Secure");
      expect(cookieStr).toContain("HttpOnly");

      process.env.NODE_ENV = previousEnv;
      process.env.ALLOW_IN_MEMORY_STORE = previousOverride;
      process.env.APP_URL = previousAppUrl;
    });
  });

  describe("12. Session Refresh and Creation Safeguards", () => {
    it("should not refresh session sliding expiration or issue cookies for requests rejected due to invalid origin", async () => {
      // 1. Establish a valid session first
      const sessionRes = await request(app)
        .post("/api/session")
        .set("Origin", "https://trusted.com")
        .expect(200);

      const cookie = sessionRes.headers["set-cookie"][0].split(";")[0];
      
      // 2. Perform a request with an INVALID origin, but including the valid session cookie
      const rejectedRes = await request(app)
        .post("/api/session/logout")
        .set("Origin", "https://malicious.com") // Malicious origin!
        .set("Cookie", cookie)
        .expect(403);

      expect(rejectedRes.body.error).toContain("Origin verification failed");

      // CRITICAL ASSERTION: The response MUST NOT contain any Set-Cookie headers refreshing the session
      expect(rejectedRes.headers["set-cookie"]).toBeUndefined();
    });

    it("should not create a session or set any cookies for public GET requests without credentials", async () => {
      const res = await request(app)
        .get("/api/system-key-status")
        .expect(200);
      
      expect(res.headers["set-cookie"]).toBeUndefined();
    });
  });

  describe("13. Provider AbortSignal and 504 Gateway Timeout Integration", () => {
    it("should abort the provider call via AbortSignal on timeout and return exactly one 504 response", async () => {
      // 1. Establish session
      const sessionRes = await request(app)
        .post("/api/session")
        .set("Origin", "https://trusted.com")
        .expect(200);

      const cookie = sessionRes.headers["set-cookie"][0].split(";")[0];
      const csrf = sessionRes.body.csrfToken;

      let signalReceived: AbortSignal | undefined;
      let abortedSuccessfully = false;

      let onProviderCalled: (() => void) | undefined;
      const providerCalledPromise = new Promise<void>((resolve) => {
        onProviderCalled = resolve;
      });

      // Mock a slow provider that responds only after aborting
      const slowProvider: AIProvider = {
        id: "gemini",
        name: "Google Gemini",
        capabilities: { chat: true, imageGeneration: false, streaming: false },
        models: [{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" }],
        chat: async (params, apiKey) => {
          signalReceived = params?.signal;
          if (onProviderCalled) {
            onProviderCalled();
          }
          if (params?.signal) {
            return new Promise((resolve, reject) => {
              const onAbort = () => {
                abortedSuccessfully = true;
                reject(new Error("Request aborted by client/timeout."));
              };
              if (params.signal.aborted) {
                onAbort();
              } else {
                params.signal.addEventListener("abort", onAbort);
              }
            });
          }
          return { text: "Immediate response" };
        },
      };

      vi.spyOn(providerRegistry, "get").mockReturnValue(slowProvider);

      // Temporarily mock setTimeout to artificially trigger the requestTimeout middleware's timeout quickly
      const originalSetTimeout = global.setTimeout;
      let timeoutCb: any;
      global.setTimeout = ((cb: any, delay: number) => {
        // Capture only the requestTimeout middleware's timeout (which is 30000ms) and return dummy timer
        if (delay === 30000) {
          timeoutCb = cb;
          return { unref: () => {} };
        }
        return originalSetTimeout(cb, delay);
      }) as any;

      try {
        // Fire request to slow endpoint
        const promise = request(app)
          .post("/api/chat")
          .set("Origin", "https://trusted.com")
          .set("Cookie", cookie)
          .set("X-CSRF-Token", csrf)
          .send({
            messages: [{ role: "user", content: "slow request" }],
            credentials: { mode: "system" }
          });

        // Wait precisely for the provider to be called, or fail early if HTTP request completes first
        const raceResult = await Promise.race([
          promise.then(res => ({ type: "response" as const, res })),
          providerCalledPromise.then(() => ({ type: "called" as const }))
        ]);

        if (raceResult.type === "response") {
          console.error("HTTP request completed prematurely:", raceResult.res.status, raceResult.res.body);
          throw new Error(`HTTP request failed before reaching provider: ${raceResult.res.status} - ${JSON.stringify(raceResult.res.body)}`);
        }

        expect(signalReceived).toBeDefined();
        expect(signalReceived?.aborted).toBe(false);

        // Artificially trigger the captured timeout callback (simulating the 30s gateway timeout)
        if (timeoutCb) {
          timeoutCb();
        }

        const res = await promise;

        expect(res.status).toBe(504);
        expect(res.body.error).toContain("Gateway Timeout");

        expect(signalReceived?.aborted).toBe(true);
        expect(abortedSuccessfully).toBe(true);

      } finally {
        global.setTimeout = originalSetTimeout;
        vi.restoreAllMocks();
      }
    });
  });
});
