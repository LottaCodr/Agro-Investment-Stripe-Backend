import { Schema, model, Document } from "mongoose";

export interface IWebhookEvent extends Document {
  stripeEventId: string; // kept for backward compat (unique id for any provider)
  processedAt: Date;
  type?: string;
  provider?: string;
}

const WebhookEventSchema = new Schema<IWebhookEvent>(
  {
    stripeEventId: { type: String, required: true, unique: true, index: true },
    processedAt: { type: Date, default: Date.now },
    type: { type: String },
    provider: { type: String, enum: ["flutterwave", "stripe"], default: "flutterwave" },
  },
  { timestamps: false }
);

// TTL 30 days
WebhookEventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const WebhookEvent = model<IWebhookEvent>("WebhookEvent", WebhookEventSchema);
