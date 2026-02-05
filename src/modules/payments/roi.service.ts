import Stripe from "stripe";
import { ENV } from "../../config/env";
import { Investment } from "../investments/investment.model";

const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: "2025-12-15.clover" });

/**
 * Pay ROI to investor.
 * @param investment Investment document
 * @param destinationStripeAccountId Stripe account of investor
 */
export const payROI = async (investment: any, destinationStripeAccountId: string) => {
  if (investment.roiPaid) {
    console.log(`ROI already paid for investment ${investment._id}`);
    return;
  }

  const amountCents = Math.round(investment.projectedReturn() * 100);

  // Use idempotency key: unique per investment
  const idempotencyKey = `roi-transfer-${investment._id}`;

  const transfer = await stripe.transfers.create(
    {
      amount: amountCents,
      currency: "usd",
      destination: destinationStripeAccountId,
      metadata: { investmentId: investment._id.toString() },
    },
    { idempotencyKey }
  );

  // Update investment
  investment.roiPaid = true;
  investment.roiStripeTransferId = transfer.id;
  await investment.save();

  console.log(`ROI of $${investment.projectedReturn()} paid to investment ${investment._id}`);
  return transfer;
};
