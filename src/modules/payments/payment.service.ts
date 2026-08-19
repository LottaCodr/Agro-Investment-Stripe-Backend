import { getStripe } from "../../config/stripe";

export const createPaymentIntent = async (
  amount: number,
  currency = "usd",
  metadata: Record<string, string> = {},
  idempotencyKey?: string
) => {
  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: Math.round(amount * 100), // Stripe expects cents
      currency: currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata,
    },
    idempotencyKey ? { idempotencyKey } : undefined
  );
  return paymentIntent;
};

export const retrievePaymentIntent = async (id: string) => {
  const stripe = getStripe();
  return stripe.paymentIntents.retrieve(id);
};

export const createTransfer = async (amount: number, currency: string, destination: string, metadata: Record<string, string> = {}, idempotencyKey?: string) => {
  const stripe = getStripe();
  return stripe.transfers.create(
    {
      amount: Math.round(amount * 100),
      currency,
      destination,
      metadata,
    },
    idempotencyKey ? { idempotencyKey } : undefined
  );
};
