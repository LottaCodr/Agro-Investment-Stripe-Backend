import { User } from "../users/user.model";
import jwt from "jsonwebtoken";
import { ENV } from "../../config/env";

export const createToken = (userId: string, role: string) => {
    return jwt.sign({ id: userId, role }, ENV.JWT_SECRET, {
        expiresIn: "15m"
    });
};

export const createRefreshToken = (userId: string) => {
    return jwt.sign({ id: userId }, ENV.JWT_SECRET, {
        expiresIn: "7d"
    });
};

export const signupUser = async (name: string, email: string, password: string, role = "investor") => {
    const existing = await User.findOne({ email });
    if (existing) throw new Error("Email already registered");
    const user = await User.create({ name, email, password, role });
    return user;
};

export const loginUser = async (email: string, password: string) => {
    const user = await User.findOne({ email });
    if (!user) throw new Error("Invalid email or password");
    const isMatch = await user.comparePassword(password);
    if (!isMatch) throw new Error("Invalid email or password");
    return user;
};
