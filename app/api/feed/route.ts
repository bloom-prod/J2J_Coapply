import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { activityLog } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { namesByIds } from "@/db/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// Recent community activity feed (replaces the Firestore "feed" collection),
// newest first.
export async function GET(req: Request) {
  try {
    await requireUser(req);
    const url = new URL(req.url);
    const limitN = Math.max(1, Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200));

    const rows = await db.select().from(activityLog).orderBy(desc(activityLog.occuredAt)).limit(limitN);
    const nameById = await namesByIds(db, rows.map((r) => r.userId));

    const events = rows.map((r) => ({
      id: r.activityId,
      type: (r.type as string)?.toLowerCase() || "",
      company: r.company || "",
      role: r.role || "",
      status: r.status || "",
      ownerUid: r.userId,
      ownerName: nameById[r.userId] || "",
      ts: r.occuredAt,
    }));

    return NextResponse.json({ ok: true, feed: events });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}