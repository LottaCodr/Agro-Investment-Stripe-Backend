import mongoose from "mongoose";
import { ENV } from "../config/env";

import { Investment } from "../modules/investments/investment.model";
import { payROI } from "../modules/payments/roi.service";
import cron from "node-cron";


mongoose.connect(ENV.MONGO_URI)
    .then(() => console.log("MongoDB connected"))
    .catch(err => console.error(err));

const processROIs = async () => {
    const investments = await Investment.find({ status: "completed", roiPaid: false }).populate("investor");

    for (const inv of investments) {
        const investorStripeAccountId = (inv.investor as any).stripeAccountId;
        if (!investorStripeAccountId) {
            console.log(`Investor ${inv.investor} has no Stripe account linked.`);
            continue;
        }

        await payROI(inv, investorStripeAccountId);
    }
};

// Run every day at midnight
cron.schedule("0 0 * * *", async () => {
    console.log("Starting ROI payout job...");
    await processROIs();
});

processROIs().then(() => console.log("ROI processing done")).catch(console.error);
