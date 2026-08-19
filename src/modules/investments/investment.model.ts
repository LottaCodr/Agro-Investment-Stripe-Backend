import mongoose, { Schema, Document, Types, Model } from "mongoose";
import { IFarm } from "../farms/farm.model";

export interface IInvestment extends Document {
  _id: Types.ObjectId;
  investor: Types.ObjectId;
  farm: Types.ObjectId | IFarm;
  amount: number;
  roi: number;
  durationMonths: number;
  roiPaid: boolean;
  // Legacy Stripe
  roiStripeTransferId?: string;
  stripePaymentIntentId?: string;
  stripeCustomerId?: string;
  // Flutterwave — primary
  flutterwaveTxRef?: string;
  flutterwaveTransactionId?: string;
  flutterwaveFlwRef?: string;
  flutterwaveStatus?: string;
  flutterwavePaymentLink?: string;
  flutterwaveTransferId?: string;
  roiFlutterwaveTransferId?: string;
  paymentProvider: "flutterwave" | "stripe";
  status: "pending" | "completed" | "cancelled" | "failed";
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
    // Legacy
    roiStripeTransferId: { type: String, trim: true },
    stripePaymentIntentId: { type: String, trim: true, sparse: true, index: true },
    stripeCustomerId: { type: String, trim: true },
    // Flutterwave
    flutterwaveTxRef: { type: String, trim: true, sparse: true, index: true },
    flutterwaveTransactionId: { type: String, trim: true },
    flutterwaveFlwRef: { type: String, trim: true },
    flutterwaveStatus: { type: String, trim: true },
    flutterwavePaymentLink: { type: String, trim: true },
    flutterwaveTransferId: { type: String, trim: true },
    roiFlutterwaveTransferId: { type: String, trim: true },
    paymentProvider: { type: String, enum: ["flutterwave", "stripe"], default: "flutterwave", index: true },
    status: {
      type: String,
      enum: ["pending", "completed", "cancelled", "failed"],
      default: "pending",
      index: true,
    },
    currency: { type: String, default: "NGN", lowercase: true, trim: true },
    maturityDate: { type: Date, required: true, index: true },
  } as any,
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

InvestmentSchema.index({ investor: 1, status: 1 });
InvestmentSchema.index({ farm: 1, status: 1 });
InvestmentSchema.index({ status: 1, roiPaid: 1, maturityDate: 1 });
InvestmentSchema.index({ flutterwaveTxRef: 1 }, { sparse: true, unique: true });
InvestmentSchema.index({ stripePaymentIntentId: 1 }, { sparse: true, unique: true });

InvestmentSchema.methods.projectedReturn = function () {
  return this.amount + (this.amount * this.roi) / 100;
};

InvestmentSchema.methods.projectedProfit = function () {
  return (this.amount * this.roi) / 100;
};

InvestmentSchema.pre("validate", function () {
  const doc: any = this;
  if (!doc.maturityDate) {
    const base: Date = doc.createdAt || new Date();
    const maturity = new Date(base);
    maturity.setMonth(maturity.getMonth() + (doc.durationMonths || 0));
    doc.maturityDate = maturity;
  }
});

export const Investment: Model<IInvestment> = mongoose.model<IInvestment>("Investment", InvestmentSchema);
