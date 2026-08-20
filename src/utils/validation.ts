import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().trim().email("Invalid email").toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  role: z.enum(["investor", "admin"]).optional(), // will be stripped/ignored; only admin creation via seed
  country: z.string().trim().max(100).optional(),
  photo: z.string().url().optional().or(z.literal("")),
});

export const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1, "Password required"),
});

export const farmCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  location: z.string().trim().min(2).max(200),
  image: z.string().url("Image must be a valid URL"),
  investmentGoal: z.number().positive("Goal must be positive").max(1_000_000_000),
  minimumInvestment: z.number().positive().max(1_000_000),
  roi: z.number().min(0).max(1000, "ROI too large"),
  durationMonths: z.number().int().positive().max(600),
  updates: z
    .array(
      z.object({
        stage: z.string().min(1).max(200),
        image: z.string().url().optional(),
        date: z.coerce.date().optional(),
      })
    )
    .optional(),
});

export const farmUpdateSchema = farmCreateSchema.partial().strip();

export const investSchema = z.object({
  farmId: z.string().min(1, "farmId required"),
  amount: z.number().positive("Amount must be positive").max(1_000_000),
  currency: z.string().trim().min(3).max(3).optional().default("NGN"),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sort: z.string().optional(),
  search: z.string().trim().optional(),
});
