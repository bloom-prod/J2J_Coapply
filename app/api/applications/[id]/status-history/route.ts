import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, applicationUserStatus } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { statusToEnum } from "@/lib/enums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// Append historical status rows to an application (backfill). Does NOT change
// the application's current status. Each entry = { status: display, changedAt: "YYYY-MM-DD" }.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const { entries } = await req.json().catch(() => ({}));
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new HttpError(400, "Provide at least one status entry.");
    }

    const app = await db.query.applications.findFirst({
      where: eq(applications.applicationId, params.id),
    });
    if (!app) throw new HttpError(404, "Application not found");
    if (app.applicantId !== user.id) throw new HttpError(403, "You can only edit your own applications");

    const rows: { applicationId: string; changedById: string; status: (typeof applicationUserStatus.$inferInsert)["status"]; changedAt: Date }[] = [];
    for (const e of entries) {
      const se = statusToEnum(String(e?.status || ""));
      if (!se) throw new HttpError(400, "Invalid status.");
      const changedAt = new Date(String(e?.changedAt || ""));
      if (Number.isNaN(changedAt.getTime())) throw new HttpError(400, "Invalid date.");
      rows.push({ applicationId: params.id, changedById: user.id, status: se, changedAt });
    }

    await db.insert(applicationUserStatus).values(rows);
    return NextResponse.json({ ok: true, added: rows.length });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}