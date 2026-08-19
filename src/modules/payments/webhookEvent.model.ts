import { Schema, model, Document } from "mongoose";

export interface IWebhookEvent extends Document {
  stripeEventId: string;
  processedAt: Date;
  type?: string;
}

const WebhookEventSchema = new Schema<IWebhookEvent>(
  {
    stripeEventId: { type: String, required: true, unique: true, index: true },
    processedAt: { type: Date, default: Date.now },
    type: { type: String },
  },
  { timestamps: false }
);

// TTL index: auto-delete after 30 days (optional, keep audit short term)
WebhookEventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const WebhookEvent = model<IWebhookEvent>("WebhookEvent", WebhookEventSchema);
