import { Request, Response, NextFunction } from "express";
import { AppError } from "../../utils/AppError";
import { Farm } from "./farm.model";

// Admin: create farm
export const createFarm = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const farm = await Farm.create(req.body);
        res.status(201).json({ success: true, farm });
    } catch (err: any) {
        next(new AppError(err.message, 400));
    }
};

// Admin: update farm
export const updateFarm = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const farm = await Farm.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!farm) return next(new AppError("Farm not found", 404));
        res.json({ success: true, farm });
    } catch (err: any) {
        next(new AppError(err.message, 400));
    }
};

// Admin: delete farm
export const deleteFarm = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const farm = await Farm.findByIdAndDelete(req.params.id);
        if (!farm) return next(new AppError("Farm not found", 404));
        res.json({ success: true, message: "Farm deleted" });
    } catch (err: any) {
        next(new AppError(err.message, 400));
    }
};

// Investor: list all farms
export const getFarms = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const farms = await Farm.find();
        res.json({ success: true, farms });
    } catch (err: any) {
        next(new AppError(err.message, 400));
    }
};

// Investor: get single farm
export const getFarm = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const farm = await Farm.findById(req.params.id);
        if (!farm) return next(new AppError("Farm not found", 404));
        res.json({ success: true, farm });
    } catch (err: any) {
        next(new AppError(err.message, 400));
    }
};
