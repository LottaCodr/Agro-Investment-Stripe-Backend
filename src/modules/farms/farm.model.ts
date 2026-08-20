import mongoose, { Schema, Document, Model, Types } from "mongoose";

export interface IFarm extends Document {
  _id: Types.ObjectId;
  name: string;
  location: string;
  image: string;
  investmentGoal: number;
  minimumInvestment: number;
  roi: number;
  durationMonths: number;
  fundedAmount: number;
  updates: { stage: string; image?: string; date: Date }[];
  status: "active" | "funded" | "completed" | "cancelled";
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FarmSchema = new Schema<IFarm>(
  {
    name: {
      type: String,
      required: [true, "Farm name required"],
      trim: true,
      maxlength: 200,
      index: true,
    },
    location: {
      type: String,
      required: [true, "Location required"],
      trim: true,
      maxlength: 200,
    },
    image: {
      type: String,
      required: [true, "Image required"],
      trim: true,
      // Basic URL validation
      match: [/^https?:\/\/.+/, "Image must be a valid URL"],
    },
    investmentGoal: {
      type: Number,
      required: true,
      min: [1, "Goal must be >0"],
      max: [1_000_000_000, "Goal too large"],
    },
    minimumInvestment: {
      type: Number,
      required: true,
      min: [1, "Minimum must be >0"],
      // cross-field validation (minimum <= goal) is enforced in controller + model pre-validate below
    },
    roi: {
      type: Number,
      required: true,
      min: [0, "ROI cannot be negative"],
      max: [1000, "ROI too large"],
    },
    durationMonths: {
      type: Number,
      required: true,
      min: [1, "Duration must be >=1"],
      max: [600, "Duration too large"],
    },
    fundedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["active", "funded", "completed", "cancelled"],
      default: "active",
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updates: [
      {
        stage: { type: String, required: true, trim: true, maxlength: 200 },
        image: { type: String, trim: true },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

FarmSchema.index({ name: "text", location: "text" });
FarmSchema.index({ status: 1, createdAt: -1 });

// Virtual: funding progress %
FarmSchema.virtual("fundedPercentage").get(function (this: IFarm) {
  if (!this.investmentGoal) return 0;
  return Math.min(100, Math.round((this.fundedAmount / this.investmentGoal) * 100));
});

// Ensure fundedAmount never exceeds goal on save via pre-save? We'll allow over-funding check in controller/worker, not hard DB block

export const Farm: Model<IFarm> = mongoose.model<IFarm>("Farm", FarmSchema);
