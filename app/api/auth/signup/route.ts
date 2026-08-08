import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/jwt";
import { pickColorForNewUser } from "@/lib/user-colors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { name, email, password } = await req.json().catch(() => ({}));
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail || !password) {
      return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
    }
    if (String(password).length < 6) {
      return NextResponse.json({ ok: false, error: "Password should be at least 6 characters." }, { status: 400 });
    }

    const existing = await db.query.users.findFirst({ where: eq(users.email, cleanEmail) });
    if (existing) {
      return NextResponse.json({ ok: false, error: "That email already has an account — try logging in." }, { status: 409 });
    }

    // New accounts require admin approval: no token is issued, they're not
    // approved yet, and they're not an admin regardless of the email.
    const passwordHash = await hashPassword(password);
    const takenColors = (await db.select({ color: users.userColor }).from(users).where(eq(users.approved, true))).map((r) => r.color ?? "");
    const color = pickColorForNewUser(cleanEmail, takenColors);

    await db.insert(users).values({
      name: String(name || "").trim() || null,
      email: cleanEmail,
      passwordHash,
      userColor: color,
      isAdmin: false,
      approved: false,
    });

    return NextResponse.json({ ok: true, pendingApproval: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Signup failed." }, { status: 500 });
  }
}