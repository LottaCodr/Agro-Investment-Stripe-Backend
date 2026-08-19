import nodemailer from "nodemailer";
import { ENV } from "../config/env";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!ENV.EMAIL_HOST || !ENV.EMAIL_USER) {
    console.warn("Email not configured - skipping sendEmail");
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: ENV.EMAIL_HOST,
      port: ENV.EMAIL_PORT,
      secure: ENV.EMAIL_PORT === 465, // true for 465
      auth: {
        user: ENV.EMAIL_USER,
        pass: ENV.EMAIL_PASS,
      },
    });
  }
  return transporter;
}

export const sendEmail = async (to: string, subject: string, html: string, textFallback?: string) => {
  const tx = getTransporter();
  if (!tx) {
    console.log(`[EMAIL MOCK] To: ${to} | Subject: ${subject} | HTML: ${html.slice(0, 500)}`);
    return { mocked: true };
  }

  try {
    const info = await tx.sendMail({
      from: `"AYF Investment" <${ENV.EMAIL_FROM}>`,
      to,
      subject,
      html,
      text: textFallback || html.replace(/<[^>]*>/g, " "),
    });
    console.log(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error(`Failed to send email to ${to}:`, err);
    // Don't throw to avoid blocking business flow - callers can decide
    throw err;
  }
};

export const sendEmailNonBlocking = (to: string, subject: string, html: string) => {
  sendEmail(to, subject, html).catch((e) => console.error("Non-blocking email failed:", e));
};

export const emailTemplates = {
  investmentPending: (farmName: string, amount: number) => ({
    subject: `Investment Pending – ${farmName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h1 style="color:#2e7d32">Investment Pending</h1>
        <p>You invested <strong>$${amount.toLocaleString()}</strong> in <strong>${farmName}</strong>.</p>
        <p>Payment is being processed. You’ll receive a confirmation once it succeeds.</p>
        <p style="color:#777;font-size:12px">AYF Agro Investment</p>
      </div>
    `,
  }),
  investmentCompleted: (farmName: string, amount: number, projectedReturn: number) => ({
    subject: `Investment Completed – ${farmName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h1 style="color:#2e7d32">Congratulations!</h1>
        <p>Your investment of <strong>$${amount.toLocaleString()}</strong> in <strong>${farmName}</strong> has been completed.</p>
        <p>Projected Return: <strong>$${projectedReturn.toLocaleString()}</strong></p>
        <p>Thank you for investing with AYF.</p>
      </div>
    `,
  }),
  investmentFailed: (farmName: string, amount: number) => ({
    subject: `Investment Payment Failed – ${farmName}`,
    html: `
      <h1 style="color:#c62828">Payment Failed</h1>
      <p>Your payment of <strong>$${amount.toLocaleString()}</strong> for <strong>${farmName}</strong> failed.</p>
      <p>Please try again or contact support.</p>
    `,
  }),
  roiPaid: (farmName: string, amount: number) => ({
    subject: `ROI Paid – ${farmName}`,
    html: `
      <h1 style="color:#2e7d32">ROI Credited!</h1>
      <p>Your ROI of <strong>$${amount.toLocaleString()}</strong> for <strong>${farmName}</strong> has been transferred.</p>
    `,
  }),
};
