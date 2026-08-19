import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { AppError } from "../utils/AppError";

export const validate =
  (schema: ZodSchema, source: "body" | "query" | "params" = "body") =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req[source]);
      // replace with parsed (includes defaults, coercion, transforms)
      (req as any)[source] = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const issues: any[] = (err as any).issues || (err as any).errors || [];
        const message = issues.map((e: any) => `${(e.path || []).join(".")}: ${e.message}`).join(", ");
        return next(new AppError(message, 400, "VALIDATION_ERROR"));
      }
      next(err);
    }
  };
