/**
 * Seed a default admin user.
 * Run: npm run seed:admin
 * Or: npx ts-node src/scripts/seedAdmin.ts
 *
 * Uses env: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME or defaults.
 */
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { User } from "../modules/users/user.model";
import { ENV } from "../config/env";

const seed = async () => {
  const email = process.env.ADMIN_EMAIL || "admin@ayf.local";
  const password = process.env.ADMIN_PASSWORD || "Admin123!";
  const name = process.env.ADMIN_NAME || "AYF Admin";

  if (!ENV.MONGO_URI) {
    console.error("MONGO_URI missing");
    process.exit(1);
  }

  await mongoose.connect(ENV.MONGO_URI);
  console.log("Connected to MongoDB for seeding");

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    console.log(`Admin already exists: ${email} (role: ${existing.role})`);
    // ensure role is admin
    if (existing.role !== "admin") {
      existing.role = "admin";
      await existing.save();
      console.log("Updated existing user to admin");
    }
    await mongoose.disconnect();
    process.exit(0);
  }

  const admin = await User.create({
    name,
    email: email.toLowerCase(),
    password,
    role: "admin",
    isVerified: true,
  });

  console.log("✅ Admin seeded:");
  console.log(`   email: ${admin.email}`);
  console.log(`   password: ${password}  (change after first login)`);
  console.log(`   id: ${admin._id}`);

  await mongoose.disconnect();
  process.exit(0);
};

seed().catch((e) => {
  console.error("Seed failed", e);
  process.exit(1);
});
