import jwt from "jsonwebtoken";
import { ENV } from "../../config/env";
import { User, IUser } from "../users/user.model";
import { AppError } from "../../utils/AppError";

export const signToken = (userId: string, role: string, expiresIn: string = ENV.JWT_EXPIRES_IN) => {
  return jwt.sign({ id: userId, role }, ENV.JWT_SECRET, {
    expiresIn: expiresIn as any,
  });
};

export const createToken = (userId: string, role: string) => signToken(userId, role, ENV.JWT_EXPIRES_IN);
export const createRefreshToken = (userId: string) => signToken(userId, "investor", ENV.JWT_REFRESH_EXPIRES_IN);

// For backwards compatibility alias
export const signRefreshToken = createRefreshToken;

export const sanitizeUser = (user: IUser) => {
  const obj: any = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.__v;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  return obj;
};

export const signupUser = async (name: string, email: string, password: string, extra: Partial<IUser> = {}) => {
  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) throw new AppError("Email already registered", 409, "DUPLICATE_EMAIL");

  // SECURITY: Never allow client to set role to admin. Force investor.
  // Admin creation must go via seed script or direct DB / protected admin endpoint.
  const safeRole = "investor";

  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password,
    role: safeRole,
    country: extra.country,
    photo: extra.photo,
  });

  return user;
};

export const loginUser = async (email: string, password: string) => {
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password");
  if (!user) throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");

  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");

  return user;
};

export const verifyRefreshToken = async (token: string) => {
  try {
    const decoded = jwt.verify(token, ENV.JWT_SECRET) as { id: string };
    const user = await User.findById(decoded.id);
    if (!user) throw new AppError("User no longer exists", 401);
    return user;
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw new AppError("Invalid or expired refresh token", 401, "INVALID_REFRESH_TOKEN");
  }
};
