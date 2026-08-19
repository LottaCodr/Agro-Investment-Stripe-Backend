import { Router } from "express";
import {
  createFarm,
  updateFarm,
  deleteFarm,
  getFarms,
  getFarm,
  getFarmStats,
} from "./farm.controller";
import { protect } from "../../middlewares/auth.middleware";
import { restrictTo } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { farmCreateSchema, farmUpdateSchema } from "../../utils/validation";

const router = Router();

// Publicly readable? Original required auth for investor/admin. We'll keep protected but also allow public with optionalAuth logic if needed.
// For now keep investor+admin for list, but stats admin only.
router.get("/", protect, restrictTo("investor", "admin"), getFarms);
router.get("/stats/summary", protect, restrictTo("admin"), getFarmStats);
router.get("/:id", protect, restrictTo("investor", "admin"), getFarm);

// Admin routes
router.post("/", protect, restrictTo("admin"), validate(farmCreateSchema), createFarm);
router.put("/:id", protect, restrictTo("admin"), validate(farmUpdateSchema), updateFarm);
router.delete("/:id", protect, restrictTo("admin"), deleteFarm);

export default router;
