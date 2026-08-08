import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { signToken, verifyPassword } from "@/lib/jwt";
import { rateLimiter, clientIp, RATE_LIMIT_WINDOW_MS, IP_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json().catch(() => ({}));
    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
    }

    // Per-IP budget to blunt password brute-forcing.
    if (!rateLimiter.hit(`login:${clientIp(req)}`, IP_LIMITS.login, RATE_LIMIT_WINDOW_MS)) {
      return NextResponse.json(
        { ok: false, error: "Too many attempts. Please wait and try again in 15 minutes." },
        { status: 429 }
      );
    }

    const row = await db.query.users.findFirst({
      where: eq(users.email, String(email).trim().toLowerCase()),
    });
    // Constant-ish response whether the email exists or not.
    if (!row || !row.passwordHash) {
      return NextResponse.json({ ok: false, error: "Email or password is incorrect." }, { status: 401 });
    }
    const ok = await verifyPassword(password, row.passwordHash);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "Email or password is incorrect." }, { status: 401 });
    }
    if (!row.approved) {
      return NextResponse.json(
        { ok: false, error: "Your account is awaiting admin approval." },
        { status: 403 }
      );
    }

    const token = await signToken({ id: row.id, email: row.email, isAdmin: row.isAdmin });
    return NextResponse.json({
      ok: true,
      token,
      user: { id: row.id, name: row.name, email: row.email, isAdmin: row.isAdmin },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Login failed." }, { status: 500 });
  }
}