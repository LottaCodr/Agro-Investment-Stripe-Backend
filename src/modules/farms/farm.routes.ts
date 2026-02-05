import { Router } from "express";
import {
    createFarm,
    updateFarm,
    deleteFarm,
    getFarms,
    getFarm,
} from "./farm.controller";
import { protect } from "../../middlewares/auth.middleware";
import { restrictTo } from "../../middlewares/role.middleware";

const router = Router();

// Admin routes
router.post("/", protect, restrictTo("admin"), createFarm);
router.put("/:id", protect, restrictTo("admin"), updateFarm);
router.delete("/:id", protect, restrictTo("admin"), deleteFarm);

// Investor routes
router.get("/", protect, restrictTo("investor", "admin"), getFarms);
router.get("/:id", protect, restrictTo("investor", "admin"), getFarm);

export default router;
