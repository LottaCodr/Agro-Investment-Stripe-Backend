import nodemailer from "nodemailer";
import { ENV } from "../config/env";

export const sendEmail = async (to: string, subject: string, html: string) => {
    // Create transporter
    const transporter = nodemailer.createTransport({
        host: ENV.EMAIL_HOST, // e.g., smtp.gmail.com
        port: Number(ENV.EMAIL_PORT) || 587,
        secure: false, // true for 465
        auth: {
            user: ENV.EMAIL_USER,
            pass: ENV.EMAIL_PASS,
        },
    });

    // Send email
    await transporter.sendMail({
        from: `"AYF Investment" <${ENV.EMAIL_USER}>`,
        to,
        subject,
        html,
    });
};
