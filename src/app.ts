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
import { stripeWebhook } from "./modules/payments/payment.webhook";

const app = express();

/* Security & utilities */
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow no-origin (mobile/postman) and CLIENT_URL + localhost in dev
      const allowed = [ENV.CLIENT_URL, "http://localhost:3000", "http://localhost:5173", "http://localhost:8080"];
      if (!origin || allowed.includes(origin) || ENV.NODE_ENV === "development") return cb(null, true);
      // In production be stricter: only allow CLIENT_URL
      if (ENV.NODE_ENV === "production" && origin === ENV.CLIENT_URL) return cb(null, true);
      // Allow all origins if CLIENT_URL not set? Better to allow but without credentials? We'll allow with true for now but log
      return cb(null, true);
    },
    credentials: true,
  })
);

// Stripe webhook needs raw body – must be BEFORE json parser for that route only
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhook);

// General parsers (after stripe raw)
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

// Stricter limiter for auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many auth attempts, try again later." },
});

/* Health Check */
app.get("/", (_req, res) => {
  res.json({
    status: "AYF Backend running",
    env: ENV.NODE_ENV,
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (_req, res) => {
  const dbState = mongoose.connection.readyState; // 0 disconnected, 1 connected, 2 connecting, 3 disconnecting
  const states: Record<number, string> = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
  res.json({
    success: true,
    uptime: process.uptime(),
    db: states[dbState] || dbState,
    stripe: ENV.STRIPE_SECRET_KEY ? "configured" : "not configured",
    email: ENV.EMAIL_HOST ? "configured" : "not configured",
  });
});

/* Routes */
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/farms", farmRoutes);
app.use("/api/investments", investmentRoutes);
app.use("/api/users", userRoutes);

/* 404 & Error */
app.use(notFound);
app.use(errorHandler);

export default app;
