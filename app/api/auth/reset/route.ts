import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users, passwordResets } from "@/db/schema";
import { hashPassword } from "@/lib/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { email, otp, newPassword } = await req.json().catch(() => ({}));
  const clean = String(email || "").trim().toLowerCase();
  const otpStr = String(otp || "").trim();
  const pass = String(newPassword || "");

  if (!clean || !otpStr || !pass) {
    return NextResponse.json({ ok: false, error: "Email, code, and new password are required." }, { status: 400 });
  }
  if (pass.length < 6) {
    return NextResponse.json({ ok: false, error: "Password should be at least 6 characters." }, { status: 400 });
  }
  if (!/^\d{6}$/.test(otpStr)) {
    return NextResponse.json({ ok: false, error: "Code must be 6 digits." }, { status: 400 });
  }

  const user = await db.query.users.findFirst({ where: eq(users.email, clean) });
  if (!user) {
    return NextResponse.json({ ok: false, error: "Invalid or expired code." }, { status: 400 });
  }

  // Most recent unused, unexpired reset code for this address.
  const reset = await db.query.passwordResets.findFirst({
    where: and(eq(passwordResets.email, clean), isNull(passwordResets.usedAt)),
    orderBy: desc(passwordResets.createdAt),
  });
  if (!reset || reset.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ ok: false, error: "Invalid or expired code." }, { status: 400 });
  }
  const matches = await bcrypt.compare(otpStr, reset.otpHash);
  if (!matches) {
    return NextResponse.json({ ok: false, error: "Invalid or expired code." }, { status: 400 });
  }

  const passwordHash = await hashPassword(pass);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
  await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, reset.id));

  return NextResponse.json({ ok: true });
}