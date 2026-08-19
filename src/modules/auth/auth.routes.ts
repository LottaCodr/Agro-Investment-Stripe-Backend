import { Router } from "express";
import { signup, login, refresh, logout, getMe, updateMe } from "./auth.controller";
import { protect } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { signupSchema, loginSchema } from "../../utils/validation";

const router = Router();

router.post("/signup", validate(signupSchema), signup);
router.post("/login", validate(loginSchema), login);
router.post("/refresh", refresh);
router.post("/logout", logout);

// Authenticated user profile
router.get("/me", protect, getMe);
router.patch("/me", protect, updateMe);

export default router;
