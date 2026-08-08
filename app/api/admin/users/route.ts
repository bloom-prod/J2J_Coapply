import { NextResponse } from "next/server";
import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// List all users, pending approval first. Admin only.
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        approved: users.approved,
        isAdmin: users.isAdmin,
        createdAt: users.updatedAt,
      })
      .from(users)
      .orderBy(asc(users.approved), desc(users.updatedAt));

    return NextResponse.json({
      ok: true,
      users: rows.map((r) => ({
        id: r.id,
        name: r.name || "",
        email: r.email,
        approved: r.approved,
        isAdmin: r.isAdmin,
        createdAt: r.createdAt ? r.createdAt.toISOString() : "",
      })),
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}