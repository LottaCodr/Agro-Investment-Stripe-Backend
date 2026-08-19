import dotenv from "dotenv";

dotenv.config();

const requiredEnv = ["PORT", "MONGO_URI", "JWT_SECRET"];

const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`❌ Missing required env variables: ${missing.join(", ")}`);
  // Don't crash during tests where env may be mocked, but crash in normal run
  if (process.env.NODE_ENV !== "test") {
    process.exit(1);
  }
}

function warnIfMissing(key: string, message: string) {
  if (!process.env[key]) {
    console.warn(`⚠️  ${message} (${key} not set)`);
  }
}

warnIfMissing("STRIPE_SECRET_KEY", "Stripe payments will not work without STRIPE_SECRET_KEY");
warnIfMissing("STRIPE_WEBHOOK_SECRET", "Stripe webhooks will fail verification without STRIPE_WEBHOOK_SECRET");
warnIfMissing("EMAIL_HOST", "Email sending will be disabled");

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "5000", 10),
  MONGO_URI: process.env.MONGO_URI!,
  JWT_SECRET: process.env.JWT_SECRET!,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "15m",
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
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
