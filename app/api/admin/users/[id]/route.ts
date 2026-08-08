import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// Approve (approved=true) or deny (delete) a user. Admin only.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const { approve } = await req.json().catch(() => ({}));
    if (approve === undefined) throw new HttpError(400, "Missing `approve` (true/false)");

    const existing = await db.query.users.findFirst({ where: eq(users.id, params.id) });
    if (!existing) throw new HttpError(404, "User not found");
    if (existing.isAdmin) throw new HttpError(400, "Admin accounts can't be managed here");

    if (approve === true) {
      await db.update(users).set({ approved: true, updatedAt: new Date() }).where(eq(users.id, params.id));
    } else {
      await db.delete(users).where(eq(users.id, params.id));
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}