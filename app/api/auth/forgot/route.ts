import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users, passwordResets } from "@/db/schema";
import { sendOtpEmail } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OTP_TTL_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  const { email } = await req.json().catch(() => ({}));
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) {
    return NextResponse.json({ ok: false, error: "Email is required." }, { status: 400 });
  }

  // Always respond ok to avoid revealing which emails exist. Only send when the
  // user actually exists.
  const user = await db.query.users.findFirst({ where: eq(users.email, clean) });
  if (user) {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpH = await bcrypt.hash(otp, 10);
    const now = new Date();

    // Invalidate any previous active codes for this address.
    await db
      .update(passwordResets)
      .set({ usedAt: now })
      .where(and(eq(passwordResets.email, clean), isNull(passwordResets.usedAt)));

    await db.insert(passwordResets).values({
      email: clean,
      otpHash: otpH,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      createdAt: now,
    });

    try {
      await sendOtpEmail(clean, otp);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Failed to send email." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}