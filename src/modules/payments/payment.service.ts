import {
  initializeFlutterwavePayment,
  verifyFlutterwaveTransaction,
  createFlutterwaveTransfer,
  isFlutterwaveConfigured,
} from "../../config/flutterwave";
import { ENV } from "../../config/env";

// Flutterwave — primary provider

export const initializePayment = async (opts: {
  amount: number;
  currency?: string;
  tx_ref: string;
  redirect_url?: string;
  customer: { email: string; name: string; phonenumber?: string };
  meta?: Record<string, string>;
  title?: string;
  description?: string;
}) => {
  const currency = (opts.currency || ENV.FLW_CURRENCY || "NGN").toLowerCase();
  const redirect_url = opts.redirect_url || ENV.FLW_REDIRECT_URL;

  return initializeFlutterwavePayment({
    tx_ref: opts.tx_ref,
    amount: opts.amount,
    currency,
    redirect_url,
    payment_options: "card,banktransfer,ussd,mobilemoney",
    customer: opts.customer,
    customizations: {
      title: opts.title || "AYF Farm Investment",
      description: opts.description || `Investment ${opts.tx_ref}`,
      logo: "https://ayf.local/logo.png",
    },
    meta: opts.meta,
  });
};

export const verifyTransaction = async (transactionId: string | number) => {
  return verifyFlutterwaveTransaction(transactionId);
};

export const createTransfer = async (opts: {
  account_bank: string;
  account_number: string;
  amount: number;
  currency?: string;
  reference: string;
  beneficiary_name?: string;
  narration?: string;
  meta?: { metaname: string; metavalue: string }[];
}) => {
  return createFlutterwaveTransfer({
    account_bank: opts.account_bank,
    account_number: opts.account_number,
    amount: opts.amount,
    currency: opts.currency || ENV.FLW_CURRENCY || "NGN",
    reference: opts.reference,
    beneficiary_name: opts.beneficiary_name,
    narration: opts.narration,
    meta: opts.meta,
  });
};

// Backwards compatible aliases (Stripe → Flutterwave). Keep for code that may still call old names.
export const createPaymentIntent = async (amount: number, currency = "NGN", meta: Record<string, string> = {}) => {
  // Map old Stripe call to Flutterwave init with a generated tx_ref
  const tx_ref = `AYF-LEGACY-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const customer = { email: meta.email || "no-reply@ayf.local", name: meta.name || "AYF Investor" };
  const res = await initializePayment({ amount, currency, tx_ref, customer, meta });
  // Return shape similar to old PaymentIntent for compatibility (link instead of client_secret)
  return { id: tx_ref, client_secret: res.link, link: res.link, raw: res.raw } as any;
};

export const retrievePaymentIntent = async (id: string) => {
  // Try verify by tx_ref
  return verifyFlutterwaveTransaction(id);
};

export const isStripeConfigured = isFlutterwaveConfigured; // alias
