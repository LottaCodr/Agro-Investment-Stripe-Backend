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
} from "./investment.controller";
import { validate } from "../../middlewares/validate.middleware";
import { investSchema } from "../../utils/validation";

const router = Router();

// Investor: invest in farm
router.post("/", protect, restrictTo("investor"), validate(investSchema), investInFarm);
router.get("/me", protect, restrictTo("investor", "admin"), getMyInvestments);
router.get("/my/:id", protect, getMyInvestment);

// Admin: list all, mark completed
router.get("/", protect, restrictTo("admin"), getAllInvestments);
router.post("/:id/complete", protect, restrictTo("admin"), completeInvestment);
router.post("/:id/cancel", protect, cancelInvestment); // investor or admin logic inside
router.get("/:id", protect, getMyInvestment);

export default router;
