import { Request, Response, NextFunction } from "express";
import { Investment } from "./investment.model";
import { Farm } from "../farms/farm.model";
import { AppError } from "../../utils/AppError";
import { getStripe, isStripeConfigured } from "../../config/stripe";
import { sendEmailNonBlocking, emailTemplates } from "../../utils/email";
import { catchAsync } from "../../utils/catchAsync";
import mongoose from "mongoose";

// Investor: create investment + PaymentIntent
export const investInFarm = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { farmId, amount, currency = "usd" } = req.body as {
    farmId: string;
    amount: number;
    currency?: string;
  };
  const investor = req.user!;

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

  // Prevent over-funding
  const remaining = farm.investmentGoal - farm.fundedAmount;
  if (remaining <= 0) {
    return next(new AppError("Farm is already fully funded", 400));
  }
  if (amount > remaining) {
    return next(new AppError(`Only $${remaining.toLocaleString()} remaining to fund this farm`, 400));
  }

  if (!isStripeConfigured()) {
    return next(new AppError("Payments are temporarily unavailable (Stripe not configured)", 503));
  }

  const stripe = getStripe();

  // First create pending investment
  const investment = await Investment.create({
    investor: investor._id,
    farm: farm._id,
    amount,
    roi: farm.roi,
    durationMonths: farm.durationMonths,
    status: "pending",
    currency: currency.toLowerCase(),
  });

  // Now create Stripe PaymentIntent with metadata link + idempotency key per investment
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(amount * 100), // cents
        currency: currency.toLowerCase(),
        // payment_method_types is deprecated; automatic_payment_methods preferred
        automatic_payment_methods: { enabled: true },
        metadata: {
          investmentId: investment._id.toString(),
          farmId: farm._id.toString(),
          investorId: investor._id.toString(),
        },
        description: `Investment $${amount} in ${farm.name} by ${investor.email}`,
        receipt_email: investor.email,
      },
      { idempotencyKey: `pi-${investment._id.toString()}` }
    );
  } catch (stripeErr: any) {
    // Rollback investment if stripe fails
    await Investment.findByIdAndDelete(investment._id);
    return next(new AppError(`Stripe error: ${stripeErr.message}`, 400));
  }

  // Save PI id onto investment for webhook lookup
  investment.stripePaymentIntentId = paymentIntent.id;
  if ((paymentIntent as any).customer) investment.stripeCustomerId = (paymentIntent as any).customer as string;
  await investment.save();

  // Non-blocking email
  const tpl = emailTemplates.investmentPending(farm.name, amount);
  sendEmailNonBlocking(investor.email, tpl.subject, tpl.html);

  res.status(201).json({
    success: true,
    clientSecret: paymentIntent.client_secret,
    investmentId: investment._id,
    paymentIntentId: paymentIntent.id,
  });
});

// Shared helper to mark completed and fund farm atomically
async function markInvestmentCompleted(investmentId: string) {
  const investment = await Investment.findById(investmentId).populate("farm").populate("investor");
  if (!investment) throw new AppError("Investment not found", 404);
  if (investment.status === "completed") return investment; // idempotent

  if (investment.status === "cancelled" || investment.status === "failed") {
    throw new AppError(`Cannot complete investment with status ${investment.status}`, 400);
  }

  investment.status = "completed";
  await investment.save();

  const farm = investment.farm as any;
  // Atomic increment to avoid race
  if (farm && farm._id) {
    await Farm.findByIdAndUpdate(farm._id, { $inc: { fundedAmount: investment.amount } });
    // Check if farm now funded
    const freshFarm = await Farm.findById(farm._id);
    if (freshFarm && freshFarm.fundedAmount >= freshFarm.investmentGoal) {
      freshFarm.status = "funded";
      await freshFarm.save();
    }
  }

  // Non-blocking email to real investor
  const investorDoc = investment.investor as any;
  const investorEmail = investorDoc?.email;
  const farmName = (investment.farm as any)?.name || "Farm";
  if (investorEmail) {
    const tpl = emailTemplates.investmentCompleted(farmName, investment.amount, (investment as any).projectedReturn());
    sendEmailNonBlocking(investorEmail, tpl.subject, tpl.html);
  }

  return investment;
}

// Stripe webhook path will call this indirectly, but admin manual complete also uses it
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

// Investor: list my investments
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

  const data = investments.map((inv) => ({
    _id: inv._id,
    farm: inv.farm,
    amount: inv.amount,
    currency: inv.currency,
    status: inv.status,
    roi: inv.roi,
    roiPaid: inv.roiPaid,
    projectedReturn: (inv as any).projectedReturn(),
    projectedProfit: (inv as any).projectedProfit(),
    durationMonths: inv.durationMonths,
    maturityDate: inv.maturityDate,
    stripePaymentIntentId: inv.stripePaymentIntentId,
    createdAt: inv.createdAt,
  }));

  res.json({ success: true, investments: data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// Investor: get single investment (must own)
export const getMyInvestment = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const inv = await Investment.findById(req.params.id).populate("farm");
  if (!inv) return next(new AppError("Investment not found", 404));
  if (inv.investor.toString() !== req.user!._id.toString() && req.user!.role !== "admin") {
    return next(new AppError("Not authorized to view this investment", 403));
  }
  res.json({ success: true, investment: inv, projectedReturn: (inv as any).projectedReturn() });
});

// Admin: list all investments
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
    Investment.find(filter).populate("farm").populate("investor", "name email photo country").sort("-createdAt").skip(skip).limit(limit),
    Investment.countDocuments(filter),
  ]);

  res.json({ success: true, investments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// Investor/Admin: cancel pending investment
export const cancelInvestment = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const inv = await Investment.findById(req.params.id);
  if (!inv) return next(new AppError("Investment not found", 404));

  // Investor can only cancel own pending; admin can cancel any pending
  const isOwner = inv.investor.toString() === req.user!._id.toString();
  if (!isOwner && req.user!.role !== "admin") return next(new AppError("Forbidden", 403));
  if (inv.status !== "pending") return next(new AppError(`Cannot cancel investment with status ${inv.status}`, 400));

  inv.status = "cancelled";
  await inv.save();

  // If PI exists, try to cancel on Stripe (best effort)
  if (inv.stripePaymentIntentId && isStripeConfigured()) {
    try {
      const stripe = getStripe();
      await stripe.paymentIntents.cancel(inv.stripePaymentIntentId);
    } catch (e: any) {
      console.warn(`Failed to cancel PI ${inv.stripePaymentIntentId}: ${e.message}`);
    }
  }

  res.json({ success: true, investment: inv });
});

// Export for webhook to reuse
export const _markInvestmentCompleted = markInvestmentCompleted;
