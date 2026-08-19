import { getStripe, isStripeConfigured } from "../../config/stripe";
import { Investment } from "../investments/investment.model";
import { sendEmailNonBlocking, emailTemplates } from "../../utils/email";

export const payROI = async (investment: any, destinationStripeAccountId: string) => {
  if (investment.roiPaid) {
    console.log(`ROI already paid for investment ${investment._id}`);
    return null;
  }

  // Maturity check: only pay if matured
  if (investment.maturityDate && new Date(investment.maturityDate) > new Date()) {
    console.log(`Investment ${investment._id} not yet matured (matures ${investment.maturityDate}) – skipping`);
    return null;
  }

  if (!isStripeConfigured()) {
    throw new Error("Stripe not configured – cannot pay ROI");
  }

  const stripe = getStripe();
  const amountCents = Math.round(investment.projectedReturn() * 100);

  if (amountCents <= 0) {
    throw new Error("Invalid ROI amount");
  }

  // Use idempotency key: unique per investment
  const idempotencyKey = `roi-transfer-${investment._id}`;

  const transfer = await stripe.transfers.create(
    {
      amount: amountCents,
      currency: (investment.currency || "usd").toLowerCase(),
      destination: destinationStripeAccountId,
      metadata: { investmentId: investment._id.toString(), type: "roi" },
      description: `ROI for investment ${investment._id}`,
    },
    { idempotencyKey }
  );

  // Update investment
  investment.roiPaid = true;
  investment.roiStripeTransferId = transfer.id;
  await investment.save();

  console.log(`ROI of $${investment.projectedReturn()} paid to investment ${investment._id} (transfer ${transfer.id})`);

  // Notify investor
  try {
    const investor = investment.investor as any;
    const farm = investment.farm as any;
    if (investor?.email) {
      const tpl = emailTemplates.roiPaid(farm?.name || "Farm", investment.projectedReturn());
      sendEmailNonBlocking(investor.email, tpl.subject, tpl.html);
    }
  } catch (_) {
    // ignore email errors
  }

  return transfer;
};

// Process all matured, completed, unpaid ROIs
export const processDueROIs = async () => {
  const now = new Date();
  const investments = await Investment.find({
    status: "completed",
    roiPaid: false,
    maturityDate: { $lte: now },
  })
    .populate("investor")
    .populate("farm");

  console.log(`Found ${investments.length} investments due for ROI`);

  let paid = 0;
  let skipped = 0;
  let failed = 0;

  for (const inv of investments) {
    const investorStripeAccountId = (inv.investor as any)?.stripeAccountId;
    if (!investorStripeAccountId) {
      console.log(`Investor ${inv.investor} has no Stripe account linked – skipping ROI for ${inv._id}`);
      skipped++;
      continue;
    }
    try {
      await payROI(inv, investorStripeAccountId);
      paid++;
    } catch (e: any) {
      console.error(`Failed ROI for ${inv._id}:`, e.message);
      failed++;
    }
  }

  return { total: investments.length, paid, skipped, failed };
};
