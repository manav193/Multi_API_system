import { Router, Request, Response, NextFunction } from "express";
import { getSessionStore } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";

const router = Router();

// Strict IP-based rate limiter for session creation (e.g., 10 creations per minute)
const sessionRateLimiter = createRateLimiter({
  keyPrefix: "session-creation",
  limit: process.env.NODE_ENV === "test" ? 100 : 10,
  windowMs: 60 * 1000,
});

// Endpoint to fetch or create a session and obtain the CSRF token
router.post("/", sessionRateLimiter, (req: Request, res: Response, next: NextFunction) => {
  try {
    let session = req.session;
    
    if (!session) {
      const sessionStore = getSessionStore();
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      
      try {
        session = sessionStore.createSession(ip);
      } catch (err: any) {
        res.status(429).json({ error: `Too many active sessions: ${err.message}` });
        return;
      }

      // Set cookie on the response
      const sessionTtl = 2 * 60 * 60 * 1000;
      res.cookie("sessionId", session.sessionId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: sessionTtl,
        secure: process.env.NODE_ENV === "production" || process.env.SECURE_COOKIES === "true",
      });
      req.session = session;
    }

    // Set Cache-Control header to prevent browser or CDN caching
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    res.json({
      csrfToken: session.csrfToken,
    });
  } catch (err) {
    next(err);
  }
});

// Endpoint to terminate session
router.post("/logout", (req: Request, res: Response) => {
  const sessionId = req.cookies?.sessionId;
  if (sessionId) {
    const sessionStore = getSessionStore();
    sessionStore.deleteSession(sessionId);
  }
  res.clearCookie("sessionId", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production" || process.env.SECURE_COOKIES === "true",
  });
  res.json({ success: true });
});

export default router;
