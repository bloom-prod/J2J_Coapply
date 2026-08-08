import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

let cached: Transporter | null = null;

// Build the transport lazily so `next build` works without SMTP creds; they're
// only required at runtime when an email is actually sent.
function transport(): Transporter {
  if (cached) return cached;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  if (!host || !user || !pass) {
    throw new Error("Missing SMTP_HOST/SMTP_USER/SMTP_PASS — cannot send email.");
  }
  cached = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return cached;
}

const from = () => process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@pxndey.com";

export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  await transport().sendMail({
    from: from(),
    to,
    subject: "bloom tracker — password reset code",
    text:
      `Hi,\n\n` +
      `You asked to reset your bloom tracker password. Your one-time code is:\n\n` +
      `  ${otp}\n\n` +
      `It expires in 15 minutes. If you didn't request this, you can ignore this email.\n\n` +
      `— bloom tracker 🌿`,
  });
}