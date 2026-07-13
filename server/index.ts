import dotenv from "dotenv";
import { createApp } from "./app.js";

// Load environment configuration
dotenv.config();

const PORT = 3000;
const HOST = "0.0.0.0";

async function run() {
  try {
    const app = await createApp();
    
    const server = app.listen(PORT, HOST, () => {
      console.log(`[START] Server listening on http://${HOST}:${PORT} in ${process.env.NODE_ENV || "development"} mode`);
    });

    // Graceful Shutdown routines
    const shutdown = (signal: string) => {
      console.log(`[SHUTDOWN] Received signal ${signal}. Starting clean termination...`);
      server.close(() => {
        console.log("[SHUTDOWN] HTTP server closed. Process exiting.");
        process.exit(0);
      });

      // Force terminate after 10s if sockets remain open
      const timeout = setTimeout(() => {
        console.error("[SHUTDOWN] Clean termination timed out. Forcing immediate exit.");
        process.exit(1);
      }, 10000);
      if (timeout && typeof timeout.unref === "function") {
        timeout.unref();
      }
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

  } catch (err: any) {
    console.error(`[CRITICAL] Server failed to start: ${err?.message || String(err)}`);
    process.exit(1);
  }
}

// Global Process exception monitoring
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception captured:", error);
  process.exit(1);
});

run();
