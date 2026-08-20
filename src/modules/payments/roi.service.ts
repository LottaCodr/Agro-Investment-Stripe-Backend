import { isFlutterwaveConfigured, createFlutterwaveTransfer } from "../../config/flutterwave";
import { ENV } from "../../config/env";
import { Investment } from "../investments/investment.model";
import { sendEmailNonBlocking, emailTemplates } from "../../utils/email";

export const payROI = async (investment: any, investor: any) => {
  if (investment.roiPaid) {
    console.log(`ROI already paid for investment ${investment._id}`);
    return null;
  }

  if (investment.maturityDate && new Date(investment.maturityDate) > new Date()) {
    console.log(`Investment ${investment._id} not yet matured (matures ${investment.maturityDate}) – skipping`);
    return null;
  }

  if (!isFlutterwaveConfigured()) {
    throw new Error("Flutterwave not configured – cannot pay ROI");
  }

  const amount = Number(investment.projectedReturn());
  if (!amount || amount <= 0) throw new Error("Invalid ROI amount");

  // Try Flutterwave transfer — requires investor bank details
  const accountNumber = investor?.flutterwaveAccountNumber;
  const bankCode = investor?.flutterwaveBankCode;
  const accountName = investor?.flutterwaveAccountName || investor?.name || "Investor";

  // Legacy fallback: if stripeAccountId present but flutterwave not, we cannot transfer via Flutterwave → skip with warning
  if (!accountNumber || !bankCode) {
    // Check legacy stripe fields for migration note
    if (investor?.stripeAccountId) {
      console.warn(`Investor ${investor._id} has legacy stripeAccountId but no Flutterwave bank details – ROI requires flutterwaveAccountNumber + flutterwaveBankCode. Skipping ${investment._id}`);
    } else {
      console.warn(`Investor ${investor._id} has no Flutterwave payout bank details – skipping ROI for ${investment._id}`);
    }
    throw new Error("Payout bank details missing");
  }

  const reference = `roi-${investment._id}-${Date.now()}`;
  const currency = (investment.currency || ENV.FLW_CURRENCY || "NGN").toUpperCase();

  const transfer = await createFlutterwaveTransfer({
    account_bank: bankCode,
    account_number: accountNumber,
    amount,
    currency,
    reference,
    beneficiary_name: accountName,
    narration: `ROI for ${investment._id}`,
    meta: [{ metaname: "investmentId", metavalue: investment._id.toString() }],
    debit_currency: currency,
  });

  // Update investment
  investment.roiPaid = true;
  // store transfer id/reference in both new and legacy fields for observability
  const transferId = (transfer as any)?.id ? String((transfer as any).id) : reference;
  investment.roiFlutterwaveTransferId = transferId;
  investment.flutterwaveTransferId = transferId;
  // keep legacy field for backward compat
  investment.roiStripeTransferId = transferId;
  await investment.save();

  console.log(`ROI of ${amount} ${currency} paid to investment ${investment._id} (transfer ${transferId})`);

  try {
    const farm = investment.farm as any;
    if (investor?.email) {
      const tpl = emailTemplates.roiPaid(farm?.name || "Farm", amount);
      sendEmailNonBlocking(investor.email, tpl.subject, tpl.html);
    }
  } catch (_) {}

  return transfer;
};

// Backwards compat overload: if caller passes destination string (old stripe API), try to resolve investor
export const payROIWithDestination = async (investment: any, destination: string) => {
  // Legacy stripe path: destination was a Stripe account id. We map to investor lookup.
  const investor = investment.investor;
  return payROI(investment, investor);
};

export const processDueROIs = async () => {
  const now = new Date();
  const investments = await Investment.find({
    status: "completed",
    roiPaid: false,
    maturityDate: { $lte: now },
  })
    .populate("investor")
    .populate("farm");

  console.log(`Found ${investments.length} investments due for ROI (Flutterwave)`);

  let paid = 0;
  let skipped = 0;
  let failed = 0;

  for (const inv of investments) {
    const investor = (inv.investor as any);
    if (!investor?.flutterwaveAccountNumber || !investor?.flutterwaveBankCode) {
      if (!investor?.stripeAccountId) {
        console.log(`Investor ${inv.investor} has no payout bank details – skipping ROI for ${inv._id}`);
      }
      skipped++;
      continue;
    }
    try {
      await payROI(inv, investor);
      paid++;
    } catch (e: any) {
      console.error(`Failed ROI for ${inv._id}:`, e.message);
      failed++;
    }
  }

  return { total: investments.length, paid, skipped, failed };
};

// Alias for legacy
export const processROIs = processDueROIs;
