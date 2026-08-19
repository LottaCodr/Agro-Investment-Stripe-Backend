import mongoose, { Schema, Document, Types, Model } from "mongoose";
import { IFarm } from "../farms/farm.model";

export interface IInvestment extends Document {
  _id: Types.ObjectId;
  investor: Types.ObjectId; // ref User
  farm: Types.ObjectId | IFarm;
  amount: number;
  roi: number;
  durationMonths: number;
  roiPaid: boolean;
  roiStripeTransferId?: string;
  status: "pending" | "completed" | "cancelled" | "failed";
  stripePaymentIntentId?: string;
  stripeCustomerId?: string;
  currency: string;
  maturityDate: Date;
  createdAt: Date;
  updatedAt: Date;
  projectedReturn(): number;
  projectedProfit(): number;
}

const InvestmentSchema = new Schema<IInvestment>(
  {
    investor: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    farm: { type: Schema.Types.ObjectId, ref: "Farm", required: true, index: true },
    amount: {
      type: Number,
      required: [true, "Amount required"],
      min: [1, "Amount must be at least 1"],
      max: [1_000_000, "Amount too large"],
    },
    roi: { type: Number, required: true, min: 0, max: 1000 },
    roiPaid: { type: Boolean, default: false, index: true },
    roiStripeTransferId: { type: String, trim: true },
    durationMonths: {
      type: Number,
      required: true,
      min: 1,
      max: 600,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "cancelled", "failed"],
      default: "pending",
      index: true,
    },
    stripePaymentIntentId: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
    },
    stripeCustomerId: { type: String, trim: true },
    currency: { type: String, default: "usd", lowercase: true, trim: true },
    maturityDate: { type: Date, required: true, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

InvestmentSchema.index({ investor: 1, status: 1 });
InvestmentSchema.index({ farm: 1, status: 1 });
InvestmentSchema.index({ status: 1, roiPaid: 1, maturityDate: 1 });
InvestmentSchema.index({ stripePaymentIntentId: 1 }, { sparse: true, unique: true });

// Method to calculate total projected return (principal + profit)
InvestmentSchema.methods.projectedReturn = function () {
  return this.amount + (this.amount * this.roi) / 100;
};

// Profit only
InvestmentSchema.methods.projectedProfit = function () {
  return (this.amount * this.roi) / 100;
};

// Auto-compute maturityDate if not set, based on createdAt + durationMonths
InvestmentSchema.pre("validate", function () {
  const doc: any = this;
  if (!doc.maturityDate) {
    const base: Date = doc.createdAt || new Date();
    const maturity = new Date(base);
    maturity.setMonth(maturity.getMonth() + (doc.durationMonths || 0));
    doc.maturityDate = maturity;
  }
});

// Ensure maturity recomputed on save if duration changes? Simplified.

export const Investment: Model<IInvestment> = mongoose.model<IInvestment>("Investment", InvestmentSchema);
