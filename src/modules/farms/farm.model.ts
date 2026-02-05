import mongoose, { Schema, Document } from "mongoose";

export interface IFarm extends Document {
    name: string;
    location: string;
    image: string;
    investmentGoal: number;
    minimumInvestment: number;
    roi: number;
    durationMonths: number;
    fundedAmount: number;
    updates: { stage: string; image?: string; date: Date }[];
}

const FarmSchema = new Schema<IFarm>(
    {
        name: { type: String, required: true },
        location: { type: String, required: true },
        image: { type: String, required: true },
        investmentGoal: { type: Number, required: true },
        minimumInvestment: { type: Number, required: true },
        roi: { type: Number, required: true },
        durationMonths: { type: Number, required: true },
        fundedAmount: { type: Number, default: 0 },
        updates: [
            {
                stage: { type: String, required: true },
                image: { type: String },
                date: { type: Date, default: Date.now },
            },
        ],
    },
    { timestamps: true }
);

export const Farm = mongoose.model<IFarm>("Farm", FarmSchema);
