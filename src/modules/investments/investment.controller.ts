import { Request, Response, NextFunction } from "express";
import { Investment } from "./investment.model";
import { Farm } from "../farms/farm.model";
import { AppError } from "../../utils/AppError";
import { isFlutterwaveConfigured, initializeFlutterwavePayment, verifyFlutterwaveTransaction } from "../../config/flutterwave";
import { ENV } from "../../config/env";
import { sendEmailNonBlocking, emailTemplates } from "../../utils/email";
import { catchAsync } from "../../utils/catchAsync";
import mongoose from "mongoose";

// Helper to generate unique tx_ref: AYF-<investmentId>-<timestamp>
const generateTxRef = (investmentId: string) => `AYF-${investmentId}-${Date.now()}`;

// Investor: create investment + Flutterwave payment link
export const investInFarm = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { farmId, amount, currency } = req.body as {
    farmId: string;
    amount: number;
    currency?: string;
  };
  const investor = req.user! as any;

  if (!mongoose.Types.ObjectId.isValid(farmId)) {
    return next(new AppError("Invalid farmId", 400));
  }

  const farm = await Farm.findById(farmId);
  if (!farm) return next(new AppError("Farm not found", 404));

  if (farm.status !== "active") {
    return next(new AppError(`Farm is not active (status: ${farm.status})`, 400));
  }

  if (amount < farm.minimumInvestment) {
    return next(new AppError(`Minimum investment is $${farm.minimumInvestment}`, 400));
  }

  const remaining = farm.investmentGoal - farm.fundedAmount;
  if (remaining <= 0) {
    return next(new AppError("Farm is already fully funded", 400));
  }
  if (amount > remaining) {
    return next(new AppError(`Only $${remaining.toLocaleString()} remaining to fund this farm`, 400));
  }

  const chosenCurrency = (currency || ENV.FLW_CURRENCY || "NGN").toLowerCase();

  if (!isFlutterwaveConfigured()) {
    return next(new AppError("Payments are temporarily unavailable (Flutterwave not configured). Set FLW_SECRET_KEY.", 503));
  }

  // First create pending investment with a generated tx_ref
  // We need investmentId for tx_ref, so create then generate ref and update.
  const investment = await Investment.create({
    investor: investor._id,
    farm: farm._id,
    amount,
    roi: farm.roi,
    durationMonths: farm.durationMonths,
    status: "pending",
    currency: chosenCurrency,
    paymentProvider: "flutterwave",
  } as any);

  const tx_ref = generateTxRef(investment._id.toString());

  // Now initialize Flutterwave payment
  let paymentLink: string;
  let rawData: any;
  try {
    const customer = {
      email: investor.email,
      name: investor.name,
      phonenumber: investor.phone || investor.phonenumber || "08000000000",
    };
    const result = await initializeFlutterwavePayment({
      tx_ref,
      amount,
      currency: chosenCurrency,
      redirect_url: ENV.FLW_REDIRECT_URL,
      payment_options: "card,banktransfer,ussd,mobilemoney",
      customer,
      customizations: {
        title: `AYF – ${farm.name}`,
        description: `Investment $${amount} in ${farm.name}`,
        logo: "https://ayf.africa/logo.png",
      },
      meta: {
        investmentId: investment._id.toString(),
        farmId: farm._id.toString(),
        investorId: investor._id.toString(),
      },
    });
    paymentLink = result.link;
    rawData = result.raw;
  } catch (flwErr: any) {
    // Rollback investment if Flutterwave fails
    await Investment.findByIdAndDelete(investment._id);
    return next(new AppError(`Flutterwave error: ${flwErr.message}`, 400));
  }

  // Save tx_ref and link onto investment
  (investment as any).flutterwaveTxRef = tx_ref;
  (investment as any).flutterwavePaymentLink = paymentLink;
  // Store flutterwave initial data if contains id/ref
  if (rawData?.id) (investment as any).flutterwaveTransactionId = String(rawData.id);
  await investment.save();

  const tpl = emailTemplates.investmentPending(farm.name, amount);
  sendEmailNonBlocking(investor.email, tpl.subject, tpl.html);

  res.status(201).json({
    success: true,
    investmentId: investment._id,
    tx_ref,
    paymentLink,
    // For legacy clients still expecting clientSecret, provide link as clientSecret alias
    clientSecret: paymentLink,
    flutterwavePaymentLink: paymentLink,
    currency: chosenCurrency,
    redirectUrl: ENV.FLW_REDIRECT_URL,
  });
});

// Shared helper to mark completed and fund farm atomically
async function markInvestmentCompleted(investmentId: string) {
  const investment = await Investment.findById(investmentId).populate("farm").populate("investor");
  if (!investment) throw new AppError("Investment not found", 404);
  if (investment.status === "completed") return investment;

  if (investment.status === "cancelled" || investment.status === "failed") {
    throw new AppError(`Cannot complete investment with status ${investment.status}`, 400);
  }

  investment.status = "completed";
  await investment.save();

  const farm = investment.farm as any;
  if (farm && farm._id) {
    await Farm.findByIdAndUpdate(farm._id, { $inc: { fundedAmount: investment.amount } });
    const freshFarm = await Farm.findById(farm._id);
    if (freshFarm && freshFarm.fundedAmount >= freshFarm.investmentGoal) {
      freshFarm.status = "funded";
      await freshFarm.save();
    }
  }

  const investorDoc = investment.investor as any;
  const investorEmail = investorDoc?.email;
  const farmName = (investment.farm as any)?.name || "Farm";
  if (investorEmail) {
    const tpl = emailTemplates.investmentCompleted(farmName, investment.amount, (investment as any).projectedReturn());
    sendEmailNonBlocking(investorEmail, tpl.subject, tpl.html);
  }

  return investment;
}

export const completeInvestment = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const investmentId = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(investmentId)) return next(new AppError("Invalid investment id", 400));
  const investment = await markInvestmentCompleted(investmentId);
  res.json({
    success: true,
    investment,
    projectedReturn: (investment as any).projectedReturn(),
    message: "Investment completed successfully",
  });
});

// Verify Flutterwave transaction and mark investment completed (called after redirect or via polling)
export const verifyInvestmentPayment = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { id, tx_ref, transaction_id } = req.query as any;
  const investmentId = (req.params.id || req.query.investmentId) as string | undefined;
  const txRefQuery = (tx_ref || req.query.tx_ref) as string | undefined;
  const flwId = (id || transaction_id) as string | undefined;

  // Strategy: if investmentId provided, verify via stored tx_ref; else find by tx_ref
  let investment: any = null;
  if (investmentId && mongoose.Types.ObjectId.isValid(investmentId)) {
    investment = await Investment.findById(investmentId).populate("farm");
  } else if (txRefQuery) {
    investment = await Investment.findOne({ flutterwaveTxRef: txRefQuery }).populate("farm");
  }

  if (!investment) return next(new AppError("Investment not found for verification", 404));
  if (investment.status === "completed") {
    return res.json({ success: true, message: "Already completed", investment });
  }

  // Verify with Flutterwave
  let verified: any = null;
  const tryId = flwId || (investment as any).flutterwaveTransactionId;
  if (tryId && isFlutterwaveConfigured()) {
    try {
      verified = await verifyFlutterwaveTransaction(tryId);
    } catch (e: any) {
      console.warn(`Verify by id ${tryId} failed: ${e.message}`);
    }
  }
  // If no id or verify failed, try to verify via API using tx_ref search? For now rely on stored tx_ref match + status
  // If verification says successful or webhook already marked pending with matching tx_ref, we can mark completed if amount/currency match
  const flwStatus = verified?.status || "successful"; // fallback if no API and we trust query? Better to require verification
  const flwAmount = verified?.amount ? Number(verified.amount) : Number(investment.amount);
  const flwCurrency = (verified?.currency || investment.currency || "").toLowerCase();
  const expectedCurrency = String(investment.currency).toLowerCase();

  if (!isFlutterwaveConfigured()) {
    // In dev without FLW keys, allow manual verify via admin complete path
    return next(new AppError("Flutterwave not configured – cannot verify", 503));
  }

  // If we got verification, check status and amount
  if (verified) {
    if (String(verified.status).toLowerCase() !== "successful") {
      investment.status = "failed";
      investment.flutterwaveStatus = verified.status;
      await investment.save();
      return res.json({ success: false, message: `Payment not successful: ${verified.status}`, investment });
    }
    if (flwAmount !== Number(investment.amount)) {
      console.warn(`Amount mismatch verify ${investment._id}: expected ${investment.amount}, got ${flwAmount}`);
    }
    if (flwCurrency !== expectedCurrency) {
      console.warn(`Currency mismatch ${investment._id}: expected ${expectedCurrency}, got ${flwCurrency}`);
    }
    // Update IDs
    investment.flutterwaveTransactionId = String(verified.id);
    investment.flutterwaveFlwRef = String(verified.flw_ref);
    investment.flutterwaveStatus = verified.status;
    investment.status = "completed";
    await investment.save();

    // Fund farm atomically (if not already via webhook)
    const farm: any = investment.farm;
    if (farm && farm._id) {
      // Check if already counted? We can use a flag or just inc; markInvestmentCompleted will handle idempotency
      // But to avoid double inc when webhook already did, check if status was already completed before save? Since we just set completed, need to fund.
      await Farm.findByIdAndUpdate(farm._id, { $inc: { fundedAmount: investment.amount } });
      const fresh = await Farm.findById(farm._id);
      if (fresh && fresh.fundedAmount >= fresh.investmentGoal && fresh.status === "active") {
        fresh.status = "funded";
        await fresh.save();
      }
    }

    const investor: any = await investment.populate("investor").then(() => (investment as any).investor);
    const farmName = (investment.farm as any)?.name || "Farm";
    if (investor?.email) {
      const tpl = emailTemplates.investmentCompleted(farmName, investment.amount, (investment as any).projectedReturn());
      sendEmailNonBlocking(investor.email, tpl.subject, tpl.html);
    }

    return res.json({ success: true, investment, verified });
  }

  // If no verification data (e.g., FLW keys missing or network), fallback: mark pending still?
  return next(new AppError("Could not verify transaction with Flutterwave", 502));
});

export const getMyInvestments = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "10", 10)));
  const skip = (page - 1) * limit;
  const status = req.query.status as string | undefined;

  const filter: any = { investor: req.user!._id };
  if (status) filter.status = status;

  const [investments, total] = await Promise.all([
    Investment.find(filter).populate("farm").sort("-createdAt").skip(skip).limit(limit),
    Investment.countDocuments(filter),
  ]);

  const data = investments.map((inv: any) => ({
    _id: inv._id,
    farm: inv.farm,
    amount: inv.amount,
    currency: inv.currency,
    status: inv.status,
    roi: inv.roi,
    roiPaid: inv.roiPaid,
    projectedReturn: inv.projectedReturn(),
    projectedProfit: inv.projectedProfit(),
    durationMonths: inv.durationMonths,
    maturityDate: inv.maturityDate,
    paymentProvider: inv.paymentProvider,
    flutterwaveTxRef: inv.flutterwaveTxRef,
    flutterwavePaymentLink: inv.flutterwavePaymentLink,
    flutterwaveTransactionId: inv.flutterwaveTransactionId,
    // legacy
    stripePaymentIntentId: inv.stripePaymentIntentId,
    createdAt: inv.createdAt,
  }));

  res.json({ success: true, investments: data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const getMyInvestment = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const inv: any = await Investment.findById(req.params.id).populate("farm");
  if (!inv) return next(new AppError("Investment not found", 404));
  if (inv.investor.toString() !== req.user!._id.toString() && req.user!.role !== "admin") {
    return next(new AppError("Not authorized to view this investment", 403));
  }
  res.json({ success: true, investment: inv, projectedReturn: inv.projectedReturn() });
});

export const getAllInvestments = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "10", 10)));
  const skip = (page - 1) * limit;
  const status = req.query.status as string | undefined;
  const farmId = req.query.farmId as string | undefined;

  const filter: any = {};
  if (status) filter.status = status;
  if (farmId) filter.farm = farmId;

  const [investments, total] = await Promise.all([
    Investment.find(filter).populate("farm").populate("investor", "name email photo country flutterwaveAccountNumber flutterwaveBankCode").sort("-createdAt").skip(skip).limit(limit),
    Investment.countDocuments(filter),
  ]);

  res.json({ success: true, investments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const cancelInvestment = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const inv: any = await Investment.findById(req.params.id);
  if (!inv) return next(new AppError("Investment not found", 404));
  const isOwner = inv.investor.toString() === req.user!._id.toString();
  if (!isOwner && req.user!.role !== "admin") return next(new AppError("Forbidden", 403));
  if (inv.status !== "pending") return next(new AppError(`Cannot cancel investment with status ${inv.status}`, 400));
  inv.status = "cancelled";
  inv.flutterwaveStatus = "cancelled";
  await inv.save();
  // Flutterwave has no cancel for pending checkout links — just mark cancelled locally
  res.json({ success: true, investment: inv });
});

export const _markInvestmentCompleted = markInvestmentCompleted;
