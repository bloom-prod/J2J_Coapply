import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users, passwordResets } from "@/db/schema";
import { sendOtpEmail } from "@/lib/mailer";
import { rateLimiter, clientIp, RATE_LIMIT_WINDOW_MS, IP_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OTP_TTL_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  const { email } = await req.json().catch(() => ({}));
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) {
    return NextResponse.json({ ok: false, error: "Email is required." }, { status: 400 });
  }

  // Per-IP budget so the endpoint can't be used to flood inboxes from one
  // source, and a per-address budget so an attacker can't spam a victim.
  const ip = clientIp(req);
  if (!rateLimiter.hit(`forgot:${ip}`, IP_LIMITS.forgot, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please wait and try again in 15 minutes." },
      { status: 429 }
    );
  }
  if (!rateLimiter.hit(`forgot-email:${clean}`, IP_LIMITS.forgotPerEmail, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json(
      { ok: false, error: "Too many requests for this address. Please wait and try again." },
      { status: 429 }
    );
  }

  // Always respond ok to avoid revealing which emails exist. Only send when the
  // user actually exists, and never leak that a send failed — a 500 here (or a
  // timing difference) would let an attacker probe which addresses are
  // registered. The same { ok: true } is returned whether or not an address
  // exists and whether or not the mail send succeeded.
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
      // Deliberately indistinguishable from success — see note above.
      console.error("Failed to send OTP email:", e);
    }
  }

  return NextResponse.json({ ok: true });
}