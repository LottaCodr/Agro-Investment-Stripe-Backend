import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middlewares/error.middleware";
import authRoutes from "./modules/auth/auth.routes";
import farmRoutes from "./modules/farms/farm.routes";
import investmentRoutes from "./modules/investments/investment.routes";
import { stripeWebhook } from "./modules/payments/payment.webhook";




const app = express();

/* Security */
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use(
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 100
    })
);

app.post(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json" }), // important for signature verification
    stripeWebhook
);

/* Health Check */
app.get("/", (_, res) => {
    res.json({ status: "AYF Backend running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/farms", farmRoutes);
app.use("/api/investments", investmentRoutes);




/* Error Handler (must be last) */
app.use(errorHandler);

export default app;
