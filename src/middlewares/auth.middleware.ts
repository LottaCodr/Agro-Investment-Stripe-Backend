import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { ENV } from "../config/env";
import { AppError } from "../utils/AppError";
import { User } from "../modules/users/user.model";

interface JwtPayload {
  id: string;
  role: "investor" | "admin";
  iat?: number;
  exp?: number;
}

export const protect = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    let token: string | undefined;

    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    } else if ((req as any).cookies?.token) {
      token = (req as any).cookies.token;
    }

    if (!token) {
      return next(new AppError("Not logged in. Token missing.", 401, "UNAUTHORIZED"));
    }

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;
    } catch (err: any) {
      if (err.name === "TokenExpiredError") {
        return next(new AppError("Token expired. Please log in again.", 401, "TOKEN_EXPIRED"));
      }
      if (err.name === "JsonWebTokenError") {
        return next(new AppError("Invalid token.", 401, "INVALID_TOKEN"));
      }
      throw err;
    }

    const user = await User.findById(decoded.id).select("+password");
    if (!user) {
      return next(new AppError("User no longer exists.", 401, "USER_NOT_FOUND"));
    }

    // attach sanitized user (without password) to request
    const userObj = user.toObject() as any;
    delete userObj.password;
    req.user = user as any;
    // also attach plain object for convenience; but keep mongoose doc
    (req.user as any)._plain = userObj;

    next();
  } catch (err) {
    return next(new AppError("Authentication failed", 401));
  }
};

// Optional auth - populates req.user if token present but doesn't require it
export const optionalAuth = async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next();
  return protect(req, _res, next);
};
