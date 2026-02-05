import { Request, Response, NextFunction } from "express";
import { Investment } from "./investment.model";
import { Farm } from "../farms/farm.model";
import { createPaymentIntent } from "../payments/payment.service";
import { AppError } from "../../utils/AppError";
import Stripe from "stripe";
import { ENV } from "../../config/env";
import { sendEmail } from "../../utils/email";


const stripe = new Stripe(ENV.STRIPE_SECRET_KEY, { apiVersion: "2025-12-15.clover" });


// Investor: make investment
export const investInFarm = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { farmId, amount } = req.body;
        const investor = req.user!; // from auth middleware

        const farm = await Farm.findById(farmId);
        if (!farm) return next(new AppError("Farm not found", 404));

        if (amount < farm.minimumInvestment) {
            return next(new AppError(`Minimum investment is $${farm.minimumInvestment}`, 400));
        }

        //  Create pending investment first
        const investment = await Investment.create({
            investor: investor._id,
            farm: farm._id,
            amount,
            roi: farm.roi,
            durationMonths: farm.durationMonths,
            status: "pending",
        });

        //  Now create Stripe PaymentIntent with metadata
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // in cents
            currency: "usd",
            payment_method_types: ["card"],
            metadata: {
                investmentId: investment._id.toString(), // link payment to investment
            },
        });

        //  Send confirmation email
        await sendEmail(
            investor.email,
            "Investment Created",
            `<h1>Investment Pending</h1>
       <p>You invested $${amount} in ${farm.name}. Payment is being processed.</p>`
        );

        res.status(201).json({
            success: true,
            clientSecret: paymentIntent.client_secret,
            investmentId: investment._id,
        });
    } catch (err: any) {
        next(new AppError(err.message, 400));
    }
};


// Admin: approve completed investment (optional if you do manual verification)
export const completeInvestment = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const investment = await Investment.findById(req.params.id).populate("farm");
        const investor = req.user!;

        if (!investment) return next(new AppError("Investment not found", 404));

        if (investment.status === "completed") {
            return next(new AppError("Investment already completed", 400));
        }

        // Mark as completed
        investment.status = "completed";
        await investment.save();

        // Update farm funded amount
        const farm = investment.farm as any;
        farm.fundedAmount = (farm.fundedAmount || 0) + investment.amount;
        await farm.save();

        // Optional: simulate payout
        // const payout = await stripe.transfers.create({
        //   amount: Math.round(investment.projectedReturn() * 100), // in cents
        //   currency: "usd",
        //   destination: investorStripeAccountId, // linked Stripe account of investor
        // });

        await sendEmail(
            investor.email,
            "Investment Completed",
            `<h1>Congratulations!</h1>
   <p>Your investment in ${farm.name} has been completed.</p>
   <p>Projected Return: $${investment.projectedReturn()}</p>`
        );

        res.json({
            success: true,
            investment,
            projectedReturn: investment.projectedReturn(),
            message: "Investment completed successfully",
        });
    } catch (err: any) {
        next(new AppError(err.message, 400));
    }
};

// Investor: list my investments
export const getMyInvestments = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const investments = await Investment.find({ investor: req.user!._id }).populate("farm");

        // Add projected return for each investment
        const data = investments.map((inv) => ({
            _id: inv._id,
            farm: inv.farm,
            amount: inv.amount,
            status: inv.status,
            roi: inv.roi,
            projectedReturn: inv.projectedReturn(),
            durationMonths: inv.durationMonths,
            createdAt: inv.createdAt,
        }));

        res.json({ success: true, investments: data });
    } catch (err: any) {
        next(new AppError(err.message, 400));
    }
};
