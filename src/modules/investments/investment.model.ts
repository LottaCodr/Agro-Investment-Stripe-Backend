import mongoose, { Schema, Document, Types } from "mongoose";
import { IFarm } from "../farms/farm.model";

export interface IInvestment extends Document {
    investor: Types.ObjectId; // reference to User
    farm: Types.ObjectId | IFarm; // populated
    amount: number;
    roi: number;              
    durationMonths: number;
    roiPaid: boolean;
    roiStripeTransferId?: string;
    status: "pending" | "completed" | "cancelled";
    createdAt: Date;

    // Calculate projected return
    projectedReturn(): number;
}

const InvestmentSchema = new Schema<IInvestment>(
    {
        investor: { type: Schema.Types.ObjectId, ref: "User", required: true },
        farm: { type: Schema.Types.ObjectId, ref: "Farm", required: true },
        amount: { type: Number, required: true },
        roi: { type: Number, required: true },
        roiPaid: { type: Boolean, default: false },
        roiStripeTransferId: { type: String },
        durationMonths: { type: Number, required: true },
        status: { type: String, enum: ["pending", "completed", "cancelled"], default: "pending" },
    },
    { timestamps: true }
);

// Method to calculate projected return
InvestmentSchema.methods.projectedReturn = function () {
    return this.amount + (this.amount * this.roi) / 100;
};

export const Investment = mongoose.model<IInvestment>("Investment", InvestmentSchema);
