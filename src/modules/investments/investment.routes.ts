import { Router } from "express";
import { protect } from "../../middlewares/auth.middleware";
import { restrictTo } from "../../middlewares/role.middleware";
import {
  investInFarm,
  getMyInvestments,
  getMyInvestment,
  getAllInvestments,
  completeInvestment,
  cancelInvestment,
  verifyInvestmentPayment,
} from "./investment.controller";
import { validate } from "../../middlewares/validate.middleware";
import { investSchema } from "../../utils/validation";

const router = Router();

// Investor: invest in farm (Flutterwave)
router.post("/", protect, restrictTo("investor"), validate(investSchema), investInFarm);
router.get("/me", protect, restrictTo("investor", "admin"), getMyInvestments);
router.get("/my/:id", protect, getMyInvestment);

// Verify payment after Flutterwave redirect (can be called by frontend polling or redirect handler)
router.get("/verify", protect, verifyInvestmentPayment);
router.get("/:id/verify", protect, verifyInvestmentPayment);
router.post("/:id/verify", protect, verifyInvestmentPayment);

// Admin: list all, mark completed
router.get("/", protect, restrictTo("admin"), getAllInvestments);
router.post("/:id/complete", protect, restrictTo("admin"), completeInvestment);
router.post("/:id/cancel", protect, cancelInvestment);
router.get("/:id", protect, getMyInvestment);

export default router;
