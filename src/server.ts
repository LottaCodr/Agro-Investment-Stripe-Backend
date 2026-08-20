import app from "./app";
import { connectDB, disconnectDB } from "./config/db";
import { ENV } from "./config/env";
import { startROIWorker } from "./workers/processROI";

const startServer = async () => {
  try {
    await connectDB();
  } catch (e: any) {
    console.error("⚠️  Could not connect to MongoDB at startup – server will run in degraded mode (health will show disconnected).");
    console.error("   Reason:", e?.message || e);
    // Don't exit – allow server to listen so /health is reachable and preview works even when Atlas IP not whitelisted.
    // In production you likely want to crash; set REQUIRE_DB=true to enforce.
    if (process.env.REQUIRE_DB === "true") {
      process.exit(1);
    }
  }

  const server = app.listen(ENV.PORT, () => {
    console.log(`🚀 Server running on port ${ENV.PORT} [${ENV.NODE_ENV}]`);
    console.log(`   → http://localhost:${ENV.PORT}`);
  });

  // Start background ROI worker (only if requested or by default)
  // To disable set ENABLE_ROI_WORKER=false
  if (process.env.ENABLE_ROI_WORKER !== "false") {
    startROIWorker();
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(async () => {
      console.log("HTTP server closed");
      try {
        await disconnectDB();
      } catch (e) {
        console.error("Error during DB disconnect", e);
      }
      process.exit(0);
    });

    // Force shutdown after 10s
    setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (err: any) => {
    console.error("UNHANDLED REJECTION! Shutting down...", err);
    shutdown("unhandledRejection");
  });
  process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION! Shutting down...", err);
    process.exit(1);
  });
};

startServer().catch((e) => {
  console.error("Failed to start server", e);
  process.exit(1);
});
