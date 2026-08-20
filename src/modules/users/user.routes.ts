import { Router } from "express";
import { protect } from "../../middlewares/auth.middleware";
import { restrictTo } from "../../middlewares/role.middleware";
import { User } from "./user.model";
import { catchAsync } from "../../utils/catchAsync";
import { AppError } from "../../utils/AppError";

const router = Router();

// All routes below are admin-only unless noted
router.use(protect, restrictTo("admin"));

// List users with pagination & filtering
router.get(
  "/",
  catchAsync(async (req, res, _next) => {
    const page = Math.max(1, parseInt((req.query.page as string) || "1"));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "10")));
    const skip = (page - 1) * limit;
    const search = (req.query.search as string)?.trim();
    const role = req.query.role as string | undefined;

    const filter: any = {};
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter).select("-password").sort("-createdAt").skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    res.json({ success: true, users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  })
);

router.get(
  "/:id",
  catchAsync(async (req, res, next) => {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return next(new AppError("User not found", 404));
    res.json({ success: true, user });
  })
);

// Update user (admin can change role, flutterwave bank details, legacy stripe, isVerified)
router.patch(
  "/:id",
  catchAsync(async (req, res, next) => {
    const allowed = [
      "name",
      "email",
      "role",
      "country",
      "photo",
      "phone",
      "isVerified",
      // Flutterwave primary
      "flutterwaveAccountNumber",
      "flutterwaveBankCode",
      "flutterwaveAccountName",
      "flutterwaveCustomerId",
      // Legacy Stripe
      "stripeAccountId",
      "stripeCustomerId",
    ];
    const updates: any = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];

    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (!user) return next(new AppError("User not found", 404));
    res.json({ success: true, user });
  })
);

router.delete(
  "/:id",
  catchAsync(async (req, res, next) => {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return next(new AppError("User not found", 404));
    res.json({ success: true, message: "User deleted" });
  })
);

export default router;
