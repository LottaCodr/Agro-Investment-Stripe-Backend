import dotenv from "dotenv";

dotenv.config();

const requiredEnv = ["PORT", "MONGO_URI", "JWT_SECRET"];

const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`❌ Missing required env variables: ${missing.join(", ")}`);
  if (process.env.NODE_ENV !== "test") {
    process.exit(1);
  }
}

function warnIfMissing(key: string, message: string) {
  if (!process.env[key]) {
    console.warn(`⚠️  ${message} (${key} not set)`);
  }
}

// Flutterwave is primary provider now. Keep Stripe warnings for legacy/migration.
warnIfMissing("FLW_SECRET_KEY", "Flutterwave payments will not work without FLW_SECRET_KEY (or FLUTTERWAVE_SECRET_KEY)");
if (!process.env.FLW_SECRET_KEY && !process.env.FLUTTERWAVE_SECRET_KEY) {
  // also warn legacy stripe for backward compat
  warnIfMissing("STRIPE_SECRET_KEY", "Stripe (legacy) not configured — Flutterwave is now primary");
}
warnIfMissing("FLW_WEBHOOK_SECRET_HASH", "Flutterwave webhooks will fail verification without FLW_WEBHOOK_SECRET_HASH (set same hash in dashboard → Settings → Webhooks)");
warnIfMissing("EMAIL_HOST", "Email sending will be disabled");

// Helper to support both FLW_ and FLUTTERWAVE_ prefixes
function pick(...keys: string[]): string {
  for (const k of keys) {
    if (process.env[k]) return process.env[k] as string;
  }
  return "";
}

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "5000", 10),
  MONGO_URI: process.env.MONGO_URI!,
  JWT_SECRET: process.env.JWT_SECRET!,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "15m",
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || "7d",

  // Legacy Stripe (deprecated) — kept for migration but not used by new flow
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",

  // Flutterwave — primary
  FLW_SECRET_KEY: pick("FLW_SECRET_KEY", "FLUTTERWAVE_SECRET_KEY", "FLW_SECRET_KEY_TEST", "FLUTTERWAVE_SECRET_KEY_TEST"),
  FLW_PUBLIC_KEY: pick("FLW_PUBLIC_KEY", "FLUTTERWAVE_PUBLIC_KEY"),
  FLW_ENCRYPTION_KEY: pick("FLW_ENCRYPTION_KEY", "FLUTTERWAVE_ENCRYPTION_KEY"),
  FLW_WEBHOOK_SECRET_HASH: pick("FLW_WEBHOOK_SECRET_HASH", "FLW_SECRET_HASH", "FLUTTERWAVE_WEBHOOK_SECRET_HASH", "FLUTTERWAVE_SECRET_HASH"),
  FLW_BASE_URL: process.env.FLW_BASE_URL || "https://api.flutterwave.com/v3",
  FLW_REDIRECT_URL: process.env.FLW_REDIRECT_URL || process.env.FLUTTERWAVE_REDIRECT_URL || `${process.env.CLIENT_URL || "http://localhost:3000"}/payment/callback`,
  FLW_CURRENCY: process.env.FLW_CURRENCY || "NGN",

  CLIENT_URL: process.env.CLIENT_URL || "http://localhost:3000",
  EMAIL_HOST: process.env.EMAIL_HOST || "",
  EMAIL_PORT: parseInt(process.env.EMAIL_PORT || "587", 10),
  EMAIL_USER: process.env.EMAIL_USER || "",
  EMAIL_PASS: process.env.EMAIL_PASS || "",
  EMAIL_FROM: process.env.EMAIL_FROM || process.env.EMAIL_USER || "noreply@ayf.local",
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || "",
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || "",
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || "",
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10),
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
} as const;

export const isProd = ENV.NODE_ENV === "production";
export const isDev = ENV.NODE_ENV === "development";
