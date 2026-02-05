import { Schema, model, Document } from "mongoose";

interface IWebhookEvent extends Document {
  stripeEventId: string;
  processedAt: Date;
}

const WebhookEventSchema = new Schema<IWebhookEvent>({
  stripeEventId: { type: String, required: true, unique: true },
  processedAt: { type: Date, default: Date.now },
});

export const WebhookEvent = model<IWebhookEvent>("WebhookEvent", WebhookEventSchema);