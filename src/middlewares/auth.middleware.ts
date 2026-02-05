import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { ENV } from "../config/env";
import { AppError } from "../utils/AppError";
import { User } from "../modules/users/user.model";

interface JwtPayload {
    id: string;
    role: "investor" | "admin";
}

export const protect = async (req: Request, res: Response, next: NextFunction) => {
    try {
        let token: string | undefined;

        // Check Authorization header
        if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
            token = req.headers.authorization.split(" ")[1];
        }

        if (!token) {
            return next(new AppError("Not logged in. Token missing.", 401));
        }

        // Verify token
        const decoded = jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;

        // Find user in DB
        const user = await User.findById(decoded.id);
        if (!user) return next(new AppError("User no longer exists.", 401));

        // Attach user to request
        (req as any).user = user;

        next();
    } catch (err) {
        return next(new AppError("Invalid or expired token", 401));
    }
};
