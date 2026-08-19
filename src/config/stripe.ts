import Stripe from "stripe";
import { ENV } from "./env";

let stripeInstance: Stripe | null = null;

export const getStripe = (): Stripe => {
  if (!ENV.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured. Payment features are disabled.");
  }
  if (!stripeInstance) {
    stripeInstance = new Stripe(ENV.STRIPE_SECRET_KEY, {
      // Use latest stable API version - omit apiVersion to use account default or pin explicitly
      // apiVersion: "2024-06-20",
    });
  }
  return stripeInstance;
};

export const isStripeConfigured = () => Boolean(ENV.STRIPE_SECRET_KEY);
