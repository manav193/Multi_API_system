import { Router, Request, Response, NextFunction } from "express";

const router = Router();

// Endpoint to fetch or create a session and obtain the CSRF token
router.post("/", (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.session;
    if (!session) {
      res.status(500).json({ error: "Session failed to initialize" });
      return;
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

export default router;
