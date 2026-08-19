import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError";
import { ENV } from "../config/env";
import { ZodError } from "zod";

export const notFound = (req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(`Not Found - ${req.originalUrl}`, 404, "NOT_FOUND"));
};

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || "Internal Server Error";
  let code = err.code;

  // Mongoose validation
  if (err.name === "ValidationError" && err.errors) {
    statusCode = 400;
    const messages = Object.values(err.errors).map((e: any) => e.message);
    message = messages.join(", ");
    code = "VALIDATION_ERROR";
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || "field";
    message = `Duplicate value for ${field}: ${Object.values(err.keyValue || {})[0]}`;
    code = "DUPLICATE_KEY";
  }

  // Mongoose CastError (invalid ObjectId)
  if (err.name === "CastError") {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
    code = "CAST_ERROR";
  }

  // Zod (v3 uses .errors, v4 uses .issues - support both)
  if (err instanceof ZodError) {
    statusCode = 400;
    const issues: any[] = (err as any).issues || (err as any).errors || [];
    message = issues.map((e: any) => `${(e.path || []).join(".")}: ${e.message}`).join(", ");
    code = "VALIDATION_ERROR";
  }

  // JWT
  if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token";
    code = "INVALID_TOKEN";
  }
  if (err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Token expired";
    code = "TOKEN_EXPIRED";
  }

  // Stripe errors
  if (err.type && err.type.startsWith("Stripe")) {
    statusCode = err.statusCode || 400;
    message = err.message;
    code = err.code || "STRIPE_ERROR";
  }

  // Default to 500 for unknown
  if (statusCode === 500 && ENV.NODE_ENV === "production" && !(err instanceof AppError)) {
    message = "Internal Server Error";
  }

  const isAppOperational = err instanceof AppError && err.isOperational;

  // Log unexpected errors
  if (statusCode === 500 || !isAppOperational) {
    console.error("ERROR 💥", err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(code && { code }),
    ...(ENV.NODE_ENV === "development" && { stack: err.stack, error: err }),
  });
};
