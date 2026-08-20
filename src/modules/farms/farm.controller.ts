import { Request, Response, NextFunction } from "express";
import { AppError } from "../../utils/AppError";
import { Farm } from "./farm.model";
import { catchAsync } from "../../utils/catchAsync";

// Whitelist fields for creation/update to prevent mass assignment of fundedAmount/status etc
const allowedCreateFields = [
  "name",
  "location",
  "image",
  "investmentGoal",
  "minimumInvestment",
  "roi",
  "durationMonths",
  "updates",
] as const;

const allowedUpdateFields = [
  "name",
  "location",
  "image",
  "investmentGoal",
  "minimumInvestment",
  "roi",
  "durationMonths",
  "status",
  "updates",
] as const;

function pickAllowed(body: any, allowed: readonly string[]) {
  const out: any = {};
  for (const key of allowed) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

// Admin: create farm
export const createFarm = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const data = pickAllowed(req.body, allowedCreateFields);
  // Attach creator
  (data as any).createdBy = (req.user as any)._id;

  // Basic invariant: minimum <= goal already validated by model, but quick check
  if (data.minimumInvestment && data.investmentGoal && data.minimumInvestment > data.investmentGoal) {
    throw new AppError("Minimum investment cannot exceed goal", 400);
  }

  const farm = await Farm.create(data);
  res.status(201).json({ success: true, farm });
});

// Admin: update farm
export const updateFarm = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const data = pickAllowed(req.body, allowedUpdateFields);

  // Never allow direct fundedAmount manipulation
  if ("fundedAmount" in req.body) {
    throw new AppError("fundedAmount cannot be updated directly", 400);
  }

  const farm = await Farm.findByIdAndUpdate(req.params.id, data, {
    new: true,
    runValidators: true,
  });
  if (!farm) return next(new AppError("Farm not found", 404));
  res.json({ success: true, farm });
});

// Admin: delete farm (only if no investments? We allow but warn)
export const deleteFarm = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const farm = await Farm.findByIdAndDelete(req.params.id);
  if (!farm) return next(new AppError("Farm not found", 404));
  res.json({ success: true, message: "Farm deleted" });
});

// Public/Investor: list farms with pagination, search, filtering
export const getFarms = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "10", 10)));
  const skip = (page - 1) * limit;
  const search = (req.query.search as string)?.trim();
  const status = req.query.status as string | undefined;
  const sortParam = (req.query.sort as string) || "-createdAt";

  const filter: any = {};
  if (status) filter.status = status;
  if (search) {
    filter.$text = { $search: search };
  }

  // Build sort
  const sort: any = {};
  // support sort=field or -field comma separated
  for (const field of sortParam.split(",")) {
    const f = field.trim();
    if (!f) continue;
    if (f.startsWith("-")) sort[f.slice(1)] = -1;
    else sort[f] = 1;
  }

  const [farms, total] = await Promise.all([
    Farm.find(filter)
      .sort(search ? { score: { $meta: "textScore" }, ...sort } : sort)
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true }),
    Farm.countDocuments(filter),
  ]);

  res.json({
    success: true,
    farms,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// Investor: get single farm
export const getFarm = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const farm = await Farm.findById(req.params.id);
  if (!farm) return next(new AppError("Farm not found", 404));
  res.json({ success: true, farm });
});

// Admin: get farm stats
export const getFarmStats = catchAsync(async (_req: Request, res: Response, _next: NextFunction) => {
  const stats = await Farm.aggregate([
    {
      $group: {
        _id: null,
        totalFarms: { $sum: 1 },
        totalGoal: { $sum: "$investmentGoal" },
        totalFunded: { $sum: "$fundedAmount" },
        avgROI: { $avg: "$roi" },
      },
    },
  ]);
  res.json({ success: true, stats: stats[0] || { totalFarms: 0 } });
});
