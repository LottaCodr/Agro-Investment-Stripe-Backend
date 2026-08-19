import { Request, Response, NextFunction } from "express";

// Simple NoSQL injection + XSS sanitization without extra deps
const sanitizeObject = (obj: any): any => {
  if (!obj || typeof obj !== "object") return obj;
  for (const key in obj) {
    if (key.startsWith("$") || key.includes(".")) {
      const val = obj[key];
      delete obj[key];
      const cleanKey = key.replace(/^\$/, "").replace(/\./g, "");
      obj[cleanKey] = val;
    }
    if (typeof obj[key] === "object") {
      sanitizeObject(obj[key]);
    } else if (typeof obj[key] === "string") {
      // Basic XSS strip for <script> tags
      obj[key] = obj[key].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    }
  }
  return obj;
};

export const sanitize = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body) sanitizeObject(req.body);
  if (req.query) sanitizeObject(req.query);
  if (req.params) sanitizeObject(req.params);
  next();
};
