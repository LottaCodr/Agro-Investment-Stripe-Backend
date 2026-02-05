import { Request, Response, NextFunction } from "express";
import Stripe from "stripe";
import { ENV } from "../../config/env";
import { Investment } from "../investments/investment.model";
import { Farm, IFarm } from "../farms/farm.model";
import { sendEmail } from "../../utils/email";
import { WebhookEvent } from "./webhookEvent.model";

const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: "2025-12-15.clover" });

export const stripeWebhook = async (req: Request, res: Response, next: NextFunction) => {
  const sig = req.headers["stripe-signature"] as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, ENV.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ Check if event has been processed before
  const existing = await WebhookEvent.findOne({ stripeEventId: event.id });
  if (existing) {
    console.log(`Event ${event.id} already processed. Skipping.`);
    return res.json({ received: true });
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object as Stripe.PaymentIntent;

        const investment = await Investment.findOne({ stripePaymentIntentId: paymentIntent.id }).populate("farm");
        if (!investment) throw new Error("Investment not found for this payment.");

        if (investment.status !== "completed") {
          investment.status = "completed";
          await investment.save();

          const farm = investment.farm as IFarm;
          farm.fundedAmount = (farm.fundedAmount || 0) + investment.amount;
          await farm.save();

          // Email investor
          const investorEmail = (investment.investor as any).email; // populate if needed
          await sendEmail(
            investorEmail,
            "Investment Completed",
            `<h1>Congratulations!</h1>
             <p>Your investment in ${farm.name} has been completed successfully.</p>
             <p>Projected Return: $${investment.projectedReturn()}</p>`
          );
        }
        break;

      case "payment_intent.payment_failed":
        // Optionally notify investor
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    // ✅ Mark event as processed
    await WebhookEvent.create({ stripeEventId: event.id });

  } catch (err: any) {
    console.error("Webhook processing error:", err.message);
  }

  res.json({ received: true });
};
