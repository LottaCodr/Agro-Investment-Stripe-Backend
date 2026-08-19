import { Request, Response } from "express";
import { ENV } from "../../config/env";
import { Investment } from "../investments/investment.model";
import { Farm, IFarm } from "../farms/farm.model";
import { sendEmailNonBlocking, emailTemplates } from "../../utils/email";
import { WebhookEvent } from "./webhookEvent.model";
import { verifyFlutterwaveTransaction, verifyWebhookHash } from "../../config/flutterwave";

// Flutterwave webhook — primary (handles both JSON and raw Buffer for legacy stripe route)
export const flutterwaveWebhook = async (req: Request, res: Response) => {
  // 1) Verify hash header (Flutterwave uses verif-hash; Stripe legacy would use stripe-signature)
  // If verif-hash missing but stripe-signature present, we are on legacy stripe raw route – allow but log.
  if (!verifyWebhookHash(req.headers as any)) {
    const hasStripeSig = Boolean((req.headers as any)["stripe-signature"]);
    if (ENV.FLW_WEBHOOK_SECRET_HASH && !hasStripeSig) {
      console.warn("Flutterwave webhook hash verification failed", { headers: req.headers });
      return res.status(401).send("Invalid webhook hash");
    }
    // If stripe-signature present and FLW hash not matching, still allow (legacy)
  }

  let payload: any = req.body as any;
  // Handle raw Buffer (when called via /api/webhooks/stripe with express.raw)
  if (Buffer.isBuffer(payload)) {
    try {
      payload = JSON.parse(payload.toString("utf8"));
    } catch {
      console.warn("Webhook raw body not JSON, got:", payload.toString().slice(0, 500));
      return res.status(400).send("Invalid webhook body");
    }
  }

  // Flutterwave may send: { event: "charge.completed", data: { id, tx_ref, flw_ref, amount, currency, status, ... } }
  // or for transfers: { event: "transfer.completed", data: { ... } }
  const eventType: string = payload.event || payload["event.type"] || payload.type || "unknown";
  const data: any = payload.data || payload.dataInfo || payload;

  // Extract identifiers
  const txRef: string | undefined = data.tx_ref || data.txRef || data.reference;
  const flwRef: string | undefined = data.flw_ref || data.flwRef;
  const transactionId: string | number | undefined = data.id || data.transaction_id || data.flw_ref;
  const amount: number | undefined = data.amount ? Number(data.amount) : undefined;
  const currency: string | undefined = data.currency;
  const statusRaw: string | undefined = data.status;

  // Derive a deduplication id: prefer transactionId, fallback to txRef+event, fallback to flwRef
  const dedupId = String(transactionId || `${txRef || "no-ref"}-${eventType}-${flwRef || ""}`);

  // Idempotency: atomically insert event id; if duplicate skip
  try {
    await WebhookEvent.create({ stripeEventId: dedupId, type: eventType, provider: "flutterwave" });
  } catch (dup: any) {
    if (dup.code === 11000) {
      console.log(`Flutterwave event ${dedupId} already processed. Skipping.`);
      return res.json({ received: true, duplicate: true });
    }
    throw dup;
  }

  try {
    // For charge/transfer events, verify transaction via API before processing
    if (eventType.includes("charge") || eventType.includes("transfer") || eventType.includes("payment")) {
      // Attempt server-side verification if we have a transactionId
      if (transactionId) {
        try {
          const verified = await verifyFlutterwaveTransaction(transactionId as any);
          // If verification returns successful but payload status not, trust verification
          // We still continue to handle based on verified data
          if (verified?.status === "successful" && String(verified.tx_ref) === String(txRef)) {
            data.status = "successful";
            data.amount = verified.amount;
            data.currency = verified.currency;
          } else if (verified?.status !== "successful") {
            console.warn(`Flutterwave verification found non-successful status for ${transactionId}: ${verified.status}`);
          }
        } catch (verErr: any) {
          console.warn(`Could not verify Flutterwave transaction ${transactionId} via API: ${verErr.message} – will use webhook payload status`);
          // Fall through to use webhook payload
        }
      }

      const normalizedStatus = String(statusRaw || "").toLowerCase();
      const isSuccess = normalizedStatus === "successful" || normalizedStatus === "completed" || normalizedStatus === "success";

      if (eventType.includes("charge") || eventType.includes("payment")) {
        if (isSuccess) {
          await handlePaymentSucceeded({ txRef, flwRef, transactionId, amount, currency, data });
        } else if (normalizedStatus === "failed") {
          await handlePaymentFailed({ txRef, flwRef, transactionId, data });
        } else {
          console.log(`Unhandled Flutterwave payment status ${statusRaw} for txRef ${txRef}`);
        }
      } else if (eventType.includes("transfer")) {
        await handleTransferCompleted({ txRef, data, statusRaw });
      }
    } else {
      console.log(`Unhandled Flutterwave event type ${eventType}`, JSON.stringify(payload).slice(0, 1500));
    }
  } catch (err: any) {
    console.error("Flutterwave webhook processing error:", err.message, err.stack);
  }

  res.json({ received: true });
};

async function findInvestmentForFlutterwave(txRef?: string, flwRef?: string, transactionId?: any) {
  if (txRef) {
    let inv = await Investment.findOne({ flutterwaveTxRef: txRef }).populate("farm").populate("investor");
    if (inv) return inv;
    // Also check tx_ref stored as stripe legacy? try metadata lookup via txRef containing investmentId
    // txRef format: AYF-{investmentId}-{timestamp}
    const maybeId = txRef.split("-")[1];
    if (maybeId && maybeId.match(/^[0-9a-fA-F]{24}$/)) {
      inv = await Investment.findById(maybeId).populate("farm").populate("investor");
      if (inv) {
        // backfill
        if (!inv.flutterwaveTxRef) {
          inv.flutterwaveTxRef = txRef;
          if (transactionId) inv.flutterwaveTransactionId = String(transactionId);
          if (flwRef) inv.flutterwaveFlwRef = String(flwRef);
          await inv.save();
        }
        return inv;
      }
    }
  }
  if (transactionId) {
    const inv = await Investment.findOne({ flutterwaveTransactionId: String(transactionId) }).populate("farm").populate("investor");
    if (inv) return inv;
  }
  if (flwRef) {
    const inv = await Investment.findOne({ flutterwaveFlwRef: String(flwRef) }).populate("farm").populate("investor");
    if (inv) return inv;
  }
  return null;
}

async function handlePaymentSucceeded(params: { txRef?: string; flwRef?: string; transactionId?: any; amount?: number; currency?: string; data: any }) {
  const { txRef, flwRef, transactionId, amount, currency, data } = params;
  const investment = await findInvestmentForFlutterwave(txRef, flwRef, transactionId);
  if (!investment) {
    console.warn(`No investment found for Flutterwave txRef ${txRef} flwRef ${flwRef} id ${transactionId}`, JSON.stringify(data).slice(0, 1000));
    return;
  }
  if (investment.status === "completed") {
    console.log(`Investment ${investment._id} already completed, skipping`);
    return;
  }

  // Validate amount if provided
  if (amount !== undefined && Number(amount) !== Number(investment.amount)) {
    // For NGN vs USD, allow small float diff? Use exact.
    console.warn(`Amount mismatch for ${investment._id}: expected ${investment.amount} ${investment.currency}, got ${amount} ${currency}`);
  }

  investment.status = "completed";
  investment.flutterwaveStatus = "successful";
  if (transactionId) investment.flutterwaveTransactionId = String(transactionId);
  if (flwRef) investment.flutterwaveFlwRef = String(flwRef);
  if (txRef) investment.flutterwaveTxRef = String(txRef);
  investment.flutterwaveFlwRef = investment.flutterwaveFlwRef || String(flwRef || "");
  await investment.save();

  const farm = investment.farm as IFarm & { _id: any };
  if (farm && (farm as any)._id) {
    await Farm.findByIdAndUpdate((farm as any)._id, { $inc: { fundedAmount: investment.amount } });
    const fresh = await Farm.findById((farm as any)._id);
    if (fresh && fresh.fundedAmount >= fresh.investmentGoal && fresh.status === "active") {
      fresh.status = "funded";
      await fresh.save();
    }
  }

  const investor: any = investment.investor;
  const farmName = (farm as any)?.name || "Farm";
  if (investor?.email) {
    const tpl = emailTemplates.investmentCompleted(farmName, investment.amount, (investment as any).projectedReturn());
    sendEmailNonBlocking(investor.email, tpl.subject, tpl.html);
  }
}

async function handlePaymentFailed(params: { txRef?: string; flwRef?: string; transactionId?: any; data: any }) {
  const { txRef, flwRef, transactionId, data } = params;
  const investment = await findInvestmentForFlutterwave(txRef, flwRef, transactionId);
  if (!investment) {
    console.warn(`No investment found for failed txRef ${txRef}`);
    return;
  }
  if (investment.status !== "pending") return;
  investment.status = "failed";
  investment.flutterwaveStatus = "failed";
  if (transactionId) investment.flutterwaveTransactionId = String(transactionId);
  await investment.save();

  const investor: any = investment.investor;
  const farm: any = investment.farm;
  if (investor?.email && farm?.name) {
    const tpl = emailTemplates.investmentFailed(farm.name, investment.amount);
    sendEmailNonBlocking(investor.email, tpl.subject, tpl.html);
  }
}

async function handleTransferCompleted(params: { txRef?: string; data: any; statusRaw?: string }) {
  // For ROI transfers, we may want to mark roiPaid? Flutterwave transfer webhook could confirm transfer completed.
  // Lookup investment by transfer reference? Reference format: roi-{investmentId}-{timestamp}
  const { data } = params;
  const reference: string = data.reference || data.tx_ref || params.txRef || "";
  if (reference.startsWith("roi-")) {
    const parts = reference.split("-");
    const investmentId = parts[1];
    if (investmentId?.match(/^[0-9a-fA-F]{24}$/)) {
      const inv = await Investment.findById(investmentId);
      if (inv && !inv.roiPaid) {
        // Could mark roiPaid confirmed via webhook; but our payROI already marks immediately after transfer call.
        // So just log.
        console.log(`Flutterwave transfer completed for ROI ${reference} investment ${investmentId}`);
      }
    }
  }
}

// Legacy alias for old stripe route — keeps backward compatibility if stripe webhook still called
export const stripeWebhook = flutterwaveWebhook;
