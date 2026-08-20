import mongoose from "mongoose";
import { ENV } from "../config/env";
import { processDueROIs } from "../modules/payments/roi.service";
import cron from "node-cron";

// This module is intended to be run as a separate worker: `npm run worker:roi` or imported by server.
// It does NOT auto-connect on import unless explicitly started.

let isStarted = false;

export const startROIWorker = () => {
  if (isStarted) return;
  isStarted = true;

  // Ensure DB connected (if server already connected, this is no-op)
  const ensureDB = async () => {
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(ENV.MONGO_URI);
    console.log("ROI Worker: MongoDB connected");
  };

  const run = async () => {
    try {
      await ensureDB();
      console.log("[ROI Worker] Starting payout job at", new Date().toISOString());
      const result = await processDueROIs();
      console.log("[ROI Worker] Done:", result);
    } catch (e: any) {
      console.error("[ROI Worker] Error:", e.message, e.stack);
    }
  };

  // Run immediately on start (after short delay to allow server boot)
  setTimeout(run, 5000);

  // Schedule daily at midnight
  cron.schedule("0 0 * * *", async () => {
    console.log("[cron] ROI payout scheduled run");
    await run();
  });

  console.log("✅ ROI worker scheduled (daily at midnight + immediate in 5s)");
};

// If this file is executed directly (node dist/workers/processROI.js) then start
if (require.main === module) {
  mongoose
    .connect(ENV.MONGO_URI)
    .then(() => {
      console.log("MongoDB connected (standalone worker)");
      return startROIWorker();
    })
    .catch((err) => console.error(err));
}

export const processROIs = processDueROIs; // alias for backward compatibility
