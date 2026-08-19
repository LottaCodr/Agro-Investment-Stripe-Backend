/**
 * Legacy Stripe shim — kept for backward compatibility.
 * New code should use src/config/flutterwave.ts (Flutterwave is primary).
 * This file does NOT require the `stripe` package; it provides stubs so existing
 * imports don't break if STRIPE keys are still present.
 */
import { ENV } from "./env";

export const getStripe = (): any => {
  if (!ENV.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY not configured – Stripe is deprecated. Use Flutterwave (FLW_SECRET_KEY).");
  }
  // If legacy code still tries to use Stripe at runtime and stripe package is not installed,
  // we throw a clear message.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Stripe = require("stripe");
    return new Stripe(ENV.STRIPE_SECRET_KEY);
  } catch {
    throw new Error("Stripe package not installed. Install `stripe` or migrate to Flutterwave.");
  }
};

export const isStripeConfigured = () => Boolean(ENV.STRIPE_SECRET_KEY);
