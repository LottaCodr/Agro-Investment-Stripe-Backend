import { Router } from "express";
import { protect } from "../../middlewares/auth.middleware";
import { restrictTo } from "../../middlewares/role.middleware";
import { investInFarm, getMyInvestments, completeInvestment } from "./investment.controller";

const router = Router();

// Investor: invest in farm
router.post("/", protect, restrictTo("investor"), investInFarm);
router.get("/me", protect, restrictTo("investor"), getMyInvestments);

// Admin: mark investment completed
router.post("/:id/complete", protect, restrictTo("admin"), completeInvestment);

export default router;
