import { Request, Response } from "express";
import { getStripe } from "../../config/stripe";
import { ENV } from "../../config/env";
import { Investment } from "../investments/investment.model";
import { Farm, IFarm } from "../farms/farm.model";
import { sendEmailNonBlocking, emailTemplates } from "../../utils/email";
import { WebhookEvent } from "./webhookEvent.model";
import Stripe from "stripe";

export const stripeWebhook = async (req: Request, res: Response) => {
  if (!ENV.STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET not set - cannot verify webhook");
    return res.status(500).send("Webhook secret not configured");
  }

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) {
    return res.status(400).send("Missing stripe-signature header");
  }

  const stripe = getStripe();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, ENV.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency: atomically try to insert event id; if duplicate, skip
  try {
    await WebhookEvent.create({ stripeEventId: event.id });
  } catch (dup: any) {
    if (dup.code === 11000) {
      console.log(`Event ${event.id} already processed. Skipping.`);
      return res.json({ received: true, duplicate: true });
    }
    throw dup;
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentSucceeded(paymentIntent);
        break;
      }
      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        await handlePaymentFailed(pi);
        break;
      }
      case "payment_intent.canceled": {
        const pi = event.data.object as Stripe.PaymentIntent;
        await handlePaymentCanceled(pi);
        break;
      }
      default:
        console.log(`Unhandled event type ${event.type}`);
    }
  } catch (err: any) {
    console.error("Webhook processing error:", err.message, err.stack);
    // We already marked event as processed to avoid infinite retries for bad data.
    // If failure is transient DB issue, we could delete the WebhookEvent to allow retry, but we keep it to avoid duplicate side effects.
    // For now log and still return 200 so Stripe doesn't retry forever on our bad data. Change to 500 if you want Stripe retry.
  }

  res.json({ received: true });
};

async function findInvestmentForPI(pi: Stripe.PaymentIntent) {
  // Priority 1: lookup by stripePaymentIntentId field
  let investment = await Investment.findOne({ stripePaymentIntentId: pi.id }).populate("farm").populate("investor");
  if (investment) return investment;

  // Priority 2: metadata.investmentId (what invest controller stores)
  const metaId = (pi.metadata as any)?.investmentId;
  if (metaId) {
    investment = await Investment.findById(metaId).populate("farm").populate("investor");
    if (investment) {
      // Backfill pi id if missing
      if (!investment.stripePaymentIntentId) {
        investment.stripePaymentIntentId = pi.id;
        await investment.save();
      }
      return investment;
    }
  }

  // Priority 3: try amount + farmId with recent pending? fallback not reliable
  return null;
}

async function handlePaymentSucceeded(pi: Stripe.PaymentIntent) {
  const investment = await findInvestmentForPI(pi);

  if (!investment) {
    console.warn(`No investment found for paymentIntent ${pi.id} (metadata: ${JSON.stringify(pi.metadata)})`);
    return;
  }

  if (investment.status === "completed") {
    console.log(`Investment ${investment._id} already completed, skipping`);
    return;
  }

  // Validate amount matches (cents)
  const expectedCents = Math.round(investment.amount * 100);
  if (pi.amount_received !== undefined && pi.amount_received !== expectedCents) {
    console.warn(`Amount mismatch for ${investment._id}: expected ${expectedCents}, got ${pi.amount_received}`);
    // We still mark completed but log - could also mark failed
  }

  // Update status
  investment.status = "completed";
  // Store customer if available
  if (typeof pi.customer === "string" && pi.customer) {
    (investment as any).stripeCustomerId = pi.customer;
  }
  await investment.save();

  // Atomic farm fundedAmount increment
  const farm = investment.farm as IFarm & { _id: any };
  if (farm && (farm as any)._id) {
    await Farm.findByIdAndUpdate((farm as any)._id, { $inc: { fundedAmount: investment.amount } });
    // Auto-mark funded if goal reached
    const fresh = await Farm.findById((farm as any)._id);
    if (fresh && fresh.fundedAmount >= fresh.investmentGoal && fresh.status === "active") {
      fresh.status = "funded";
      await fresh.save();
    }
  }

  // Email investor (non-blocking)
  const investor: any = investment.investor;
  const investorEmail = investor?.email;
  const farmName = (farm as any)?.name || "Farm";
  if (investorEmail) {
    const tpl = emailTemplates.investmentCompleted(farmName, investment.amount, (investment as any).projectedReturn());
    sendEmailNonBlocking(investorEmail, tpl.subject, tpl.html);
  }
}

async function handlePaymentFailed(pi: Stripe.PaymentIntent) {
  const investment = await findInvestmentForPI(pi);
  if (!investment) {
    console.warn(`No investment found for failed PI ${pi.id}`);
    return;
  }
  if (investment.status !== "pending") return;

  investment.status = "failed";
  await investment.save();

  const investor: any = investment.investor;
  const farm: any = investment.farm;
  if (investor?.email && farm?.name) {
    const tpl = emailTemplates.investmentFailed(farm.name, investment.amount);
    sendEmailNonBlocking(investor.email, tpl.subject, tpl.html);
  }
}

async function handlePaymentCanceled(pi: Stripe.PaymentIntent) {
  const investment = await findInvestmentForPI(pi);
  if (!investment) return;
  if (investment.status !== "pending") return;
  investment.status = "cancelled";
  await investment.save();
}
