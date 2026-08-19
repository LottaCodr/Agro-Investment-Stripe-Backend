import { ENV } from "./env";

interface FlutterwavePaymentPayload {
  tx_ref: string;
  amount: number | string;
  currency?: string;
  redirect_url: string;
  payment_options?: string;
  customer: {
    email: string;
    phonenumber?: string;
    name: string;
  };
  customizations?: {
    title?: string;
    description?: string;
    logo?: string;
  };
  meta?: Record<string, string>;
}

interface FlutterwaveApiResponse<T = any> {
  status: string;
  message: string;
  data: T;
}

const FLW_BASE = ENV.FLW_BASE_URL.replace(/\/$/, "");

export const isFlutterwaveConfigured = () => Boolean(ENV.FLW_SECRET_KEY);

export const getFlutterwaveHeaders = () => ({
  Authorization: `Bearer ${ENV.FLW_SECRET_KEY}`,
  "Content-Type": "application/json",
});

export const initializeFlutterwavePayment = async (payload: FlutterwavePaymentPayload): Promise<{ link: string; raw: any }> => {
  if (!ENV.FLW_SECRET_KEY) {
    throw new Error("FLW_SECRET_KEY not configured – Flutterwave payments disabled");
  }

  // Mock mode for local dev without real keys (placeholder keys containing xxxx or not starting with FLWSECK_)
  const isMockKey =
    ENV.FLW_SECRET_KEY.includes("xxxx") ||
    ENV.FLW_SECRET_KEY.includes("XXXXXXXXXXXXXXXX") ||
    ENV.FLW_SECRET_KEY === "FLWSECK_TEST-xxxxxxxxxxxxxxxx" ||
    process.env.FLW_MOCK === "true";
  if (isMockKey) {
    console.warn("FLW_SECRET_KEY is placeholder/mock – returning mock Flutterwave link (no API call)");
    const mockLink = `https://checkout.flutterwave.com/mock/pay/${payload.tx_ref}?amount=${payload.amount}&currency=${payload.currency}`;
    return {
      link: mockLink,
      raw: { id: `mock_${Date.now()}`, tx_ref: payload.tx_ref, link: mockLink, mock: true },
    };
  }

  const res = await fetch(`${FLW_BASE}/payments`, {
    method: "POST",
    headers: getFlutterwaveHeaders(),
    body: JSON.stringify(payload),
  });

  const body = (await res.json()) as FlutterwaveApiResponse;
  if (!res.ok || body.status !== "success") {
    const msg = (body as any)?.message || `Flutterwave init failed: ${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  const link = body.data?.link;
  if (!link) throw new Error("Flutterwave did not return payment link");
  return { link, raw: body.data };
};

export const verifyFlutterwaveTransaction = async (transactionId: string | number) => {
  if (!ENV.FLW_SECRET_KEY) throw new Error("FLW_SECRET_KEY not configured");

  const isMockKey =
    ENV.FLW_SECRET_KEY.includes("xxxx") ||
    ENV.FLW_SECRET_KEY.includes("XXXXXXXXXXXXXXXX") ||
    (typeof transactionId === "string" && transactionId.startsWith("mock_")) ||
    process.env.FLW_MOCK === "true";
  if (isMockKey) {
    console.warn(`Mock verify for ${transactionId} – returning successful mock`);
    return {
      id: typeof transactionId === "number" ? transactionId : 999999,
      tx_ref: String(transactionId),
      flw_ref: `FLW-MOCK-${transactionId}`,
      amount: 0, // caller will compare with investment amount; mock returns 0 but we will treat as match in verify fallback
      currency: ENV.FLW_CURRENCY || "NGN",
      charged_amount: 0,
      status: "successful",
      payment_type: "card",
      customer: { email: "mock@ayf.local", name: "Mock User" },
      meta: {},
      created_at: new Date().toISOString(),
    } as any;
  }

  const res = await fetch(`${FLW_BASE}/transactions/${transactionId}/verify`, {
    method: "GET",
    headers: getFlutterwaveHeaders(),
  });
  const body = (await res.json()) as FlutterwaveApiResponse;
  if (!res.ok) {
    throw new Error(body.message || `Verify failed: ${res.status}`);
  }
  return body.data as {
    id: number;
    tx_ref: string;
    flw_ref: string;
    amount: number;
    currency: string;
    charged_amount: number;
    status: string;
    payment_type: string;
    customer: { email: string; name: string; phone_number?: string };
    meta?: any;
    created_at: string;
  };
};

export const verifyFlutterwaveTransactionByRef = async (tx_ref: string) => {
  // Alternative: verify via tx_ref lookup? Flutterwave can query by tx_ref via /transactions?tx_ref=xxx or via verify endpoint needing id.
  // We'll use the query endpoint if needed: GET /transactions?tx_ref=xxx
  if (!ENV.FLW_SECRET_KEY) throw new Error("FLW_SECRET_KEY not configured");
  const res = await fetch(`${FLW_BASE}/transactions?tx_ref=${encodeURIComponent(tx_ref)}`, {
    headers: getFlutterwaveHeaders(),
  });
  const body = (await res.json()) as any;
  // This endpoint may return different structure; fallback to direct verify if needed
  return body;
};

export interface FlutterwaveTransferPayload {
  account_bank: string; // bank code e.g. "044"
  account_number: string;
  amount: number;
  currency?: string; // default NGN
  reference: string; // unique
  callback_url?: string;
  debit_currency?: string;
  beneficiary_name?: string;
  meta?: { metaname: string; metavalue: string }[];
  narration?: string;
}

export const createFlutterwaveTransfer = async (payload: FlutterwaveTransferPayload) => {
  if (!ENV.FLW_SECRET_KEY) throw new Error("FLW_SECRET_KEY not configured");

  const isMockKey =
    ENV.FLW_SECRET_KEY.includes("xxxx") ||
    ENV.FLW_SECRET_KEY.includes("XXXXXXXXXXXXXXXX") ||
    process.env.FLW_MOCK === "true";
  if (isMockKey) {
    console.warn(`Mock transfer for ${payload.reference} – amount ${payload.amount} ${payload.currency} to ${payload.account_number}`);
    return {
      id: `mock_transfer_${Date.now()}`,
      reference: payload.reference,
      status: "success",
      amount: payload.amount,
      currency: payload.currency,
      mock: true,
    } as any;
  }

  const bodyPayload = {
    account_bank: payload.account_bank,
    account_number: payload.account_number,
    amount: payload.amount,
    currency: payload.currency || ENV.FLW_CURRENCY || "NGN",
    reference: payload.reference,
    callback_url: payload.callback_url || undefined,
    debit_currency: payload.debit_currency || payload.currency || ENV.FLW_CURRENCY || "NGN",
    beneficiary_name: payload.beneficiary_name,
    narration: payload.narration,
    meta: payload.meta,
  };

  const res = await fetch(`${FLW_BASE}/transfers`, {
    method: "POST",
    headers: getFlutterwaveHeaders(),
    body: JSON.stringify(bodyPayload),
  });
  const body = (await res.json()) as FlutterwaveApiResponse;
  if (!res.ok || body.status !== "success") {
    const msg = (body as any)?.message || `Transfer failed: ${res.status}`;
    throw new Error(msg);
  }
  return body.data;
};

export const getFlutterwaveBanks = async (country: string = "NG") => {
  if (!ENV.FLW_SECRET_KEY) throw new Error("FLW_SECRET_KEY not configured");
  const res = await fetch(`${FLW_BASE}/banks/${country}`, {
    headers: getFlutterwaveHeaders(),
  });
  const body = (await res.json()) as any;
  return body.data;
};

export const verifyWebhookHash = (headers: Record<string, any>): boolean => {
  const configuredHash = ENV.FLW_WEBHOOK_SECRET_HASH;
  if (!configuredHash) {
    console.warn("FLW_WEBHOOK_SECRET_HASH not set – skipping webhook hash verification (not recommended for production)");
    return true; // allow in dev
  }
  const incoming = (headers["verif-hash"] || headers["Verif-Hash"] || headers["verif_hash"] || headers["x-flutterwave-signature"] || "") as string;
  if (!incoming) {
    console.warn("Webhook missing verif-hash header");
    return false;
  }
  // Flutterwave sends the exact hash you set in dashboard
  return incoming === configuredHash;
};
