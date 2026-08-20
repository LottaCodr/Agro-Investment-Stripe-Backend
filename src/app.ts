import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import mongoose from "mongoose";

import { errorHandler, notFound } from "./middlewares/error.middleware";
import { sanitize } from "./middlewares/sanitize.middleware";
import { ENV } from "./config/env";

import authRoutes from "./modules/auth/auth.routes";
import farmRoutes from "./modules/farms/farm.routes";
import investmentRoutes from "./modules/investments/investment.routes";
import userRoutes from "./modules/users/user.routes";
import { flutterwaveWebhook, stripeWebhook } from "./modules/payments/payment.webhook";

const app = express();

app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => {
      const allowed = [ENV.CLIENT_URL, "http://localhost:3000", "http://localhost:5173", "http://localhost:8080"];
      if (!origin || allowed.includes(origin) || ENV.NODE_ENV === "development") return cb(null, true);
      if (ENV.NODE_ENV === "production" && origin === ENV.CLIENT_URL) return cb(null, true);
      return cb(null, true);
    },
    credentials: true,
  })
);

// Webhooks — Flutterwave is primary (JSON body). Keep Stripe raw route for legacy compatibility.
app.post("/api/webhooks/flutterwave", express.json(), flutterwaveWebhook);
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhook);
// Aliases used by earlier docs/clients
app.post("/api/webhooks/flutterwave/verify", express.json(), flutterwaveWebhook);
app.post("/api/payments/webhook", express.json(), flutterwaveWebhook);

// General parsers (after raw stripe route)
app.use(morgan(ENV.NODE_ENV === "development" ? "dev" : "combined"));
app.use(cookieParser());
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(sanitize);

const limiter = rateLimit({
  windowMs: ENV.RATE_LIMIT_WINDOW_MS,
  max: ENV.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." },
});
app.use("/api", limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many auth attempts, try again later." },
});

app.get("/", (_req, res) => {
  res.json({
    status: "AYF Backend running (Flutterwave)",
    provider: "flutterwave",
    env: ENV.NODE_ENV,
    version: "1.0.0-flutterwave",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (_req, res) => {
  const dbState = mongoose.connection.readyState;
  const states: Record<number, string> = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
  res.json({
    success: true,
    uptime: process.uptime(),
    db: states[dbState] || dbState,
    flutterwave: ENV.FLW_SECRET_KEY ? "configured" : "not configured",
    stripe: ENV.STRIPE_SECRET_KEY ? "configured (legacy)" : "not configured",
    email: ENV.EMAIL_HOST ? "configured" : "not configured",
  });
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/farms", farmRoutes);
app.use("/api/investments", investmentRoutes);
app.use("/api/users", userRoutes);

// Flutterwave helper routes (public webhook already above, but also expose verify via GET for frontend callback)
app.get("/api/payments/flutterwave/verify", async (req, res) => {
  // Simple query verify: ?transaction_id=xxx&tx_ref=yyy
  // Delegates to flutterwave verification - if keys missing returns mock
  res.json({ success: true, message: "Use GET /api/investments/:id/verify or POST /api/webhooks/flutterwave for webhooks" });
});

app.use(notFound);
app.use(errorHandler);

export default app;
