import mongoose from "mongoose";
import { ENV } from "./env";

export const connectDB = async () => {
  try {
    // Mongoose 7+ no longer needs useNewUrlParser / useUnifiedTopology
    await mongoose.connect(ENV.MONGO_URI, {
      autoIndex: true,
      // keepAlive is deprecated but still ok
    });
    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection failed", error);
    // In test or when REQUIRE_DB is not forced, throw so caller can decide (degraded mode)
    if (ENV.NODE_ENV === "test" || process.env.REQUIRE_DB !== "true") {
      throw error;
    }
    process.exit(1);
  }
};

export const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log("MongoDB disconnected");
  } catch (e) {
    console.error("Error disconnecting MongoDB", e);
  }
};

// Graceful handling of connection events
mongoose.connection.on("error", (err) => {
  console.error("MongoDB runtime error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.warn("MongoDB disconnected");
});
