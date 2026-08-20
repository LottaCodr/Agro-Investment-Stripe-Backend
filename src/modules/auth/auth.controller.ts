import { Request, Response, NextFunction } from "express";
import { signupUser, loginUser, createToken, createRefreshToken, verifyRefreshToken, sanitizeUser } from "./auth.service";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { ENV } from "../../config/env";
import { User } from "../users/user.model";

const cookieOptions = {
  httpOnly: true,
  secure: ENV.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7d
};

const sendTokenResponse = (user: any, statusCode: number, res: Response) => {
  const token = createToken(user._id.toString(), user.role);
  const refreshToken = createRefreshToken(user._id.toString());
  const safeUser = sanitizeUser(user);

  // Set refresh token as httpOnly cookie (optional) and also return in body for mobile
  res.cookie("refreshToken", refreshToken, cookieOptions);

  res.status(statusCode).json({
    success: true,
    token,
    refreshToken,
    user: safeUser,
  });
};

export const signup = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const { name, email, password, country, photo } = req.body;
  if (!name || !email || !password) {
    throw new AppError("Name, email and password are required", 400);
  }
  // Ignore role from body for security - signupUser forces investor
  const user = await signupUser(name, email, password, { country, photo });
  sendTokenResponse(user, 201, res);
});

export const login = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError("Email and password are required", 400);
  const user = await loginUser(email, password);
  sendTokenResponse(user, 200, res);
});

export const refresh = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const token = req.body.refreshToken || req.cookies?.refreshToken;
  if (!token) throw new AppError("Refresh token required", 401);

  const user = await verifyRefreshToken(token);
  const newToken = createToken(user._id.toString(), user.role);
  const newRefresh = createRefreshToken(user._id.toString());

  res.cookie("refreshToken", newRefresh, cookieOptions);
  res.json({ success: true, token: newToken, refreshToken: newRefresh });
});

export const logout = catchAsync(async (_req: Request, res: Response, _next: NextFunction) => {
  res.clearCookie("refreshToken", { ...cookieOptions, maxAge: 0 });
  res.json({ success: true, message: "Logged out" });
});

export const getMe = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  // req.user is already populated by protect middleware
  const user = req.user!;
  // Re-fetch to get latest without password
  const fresh = await User.findById(user._id);
  if (!fresh) throw new AppError("User not found", 404);
  res.json({ success: true, user: sanitizeUser(fresh as any) });
});

export const updateMe = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const user = req.user!;
  const allowed = ["name", "country", "photo"] as const;
  const updates: any = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) throw new AppError("No valid fields to update", 400);

  const updated = await User.findByIdAndUpdate(user._id, updates, {
    new: true,
    runValidators: true,
  });
  res.json({ success: true, user: sanitizeUser(updated as any) });
});
