import Stripe from "stripe";
import { ENV } from "../../config/env";

const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: "2025-12-15.clover" });

export const createPaymentIntent = async (amount: number, currency = "usd") => {
    const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Stripe expects cents
        currency,
        payment_method_types: ["card"],
    });
    return paymentIntent;
};
