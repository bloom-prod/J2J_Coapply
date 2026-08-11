import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, applicationUserStatus } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { logActivity } from "@/db/activity";
import { enumToStatus, statusToEnum } from "@/lib/enums";
import { getUserCommunityId } from "@/lib/community";
import { NOT_YET_APPLIED_STATUS } from "@/lib/types";
import { notifyChanges } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// Append historical status rows to an application (backfill). After insert, the
// application's current status is synced to the status with the latest
// changedAt for that application. Each entry = { status: display, changedAt: "YYYY-MM-DD" }.
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

    const communityId = await getUserCommunityId(user.id, req);
    const latest = await db.transaction(async (tx) => {
      await tx.insert(applicationUserStatus).values(rows);

      // Current status on applications must match the chronologically latest
      // status-history row (by changed_at), not just the most recently edited one.
      const [top] = await tx
        .select({ status: applicationUserStatus.status })
        .from(applicationUserStatus)
        .where(eq(applicationUserStatus.applicationId, params.id))
        .orderBy(desc(applicationUserStatus.changedAt))
        .limit(1);

      if (top && top.status !== app.status) {
        await tx
          .update(applications)
          .set({ status: top.status, updatedAt: new Date() })
          .where(eq(applications.applicationId, params.id));

        // A backfill that changes the visible status is a real move — surface
        // it in the activity feed (same type logic as /api/applications PUT).
        const statusDisplay = enumToStatus(top.status);
        if (statusDisplay && statusDisplay !== NOT_YET_APPLIED_STATUS) {
          await logActivity(tx, {
            userId: user.id,
            type: top.status === "OFFER" ? "OFFER" : "STATUS",
            company: app.company,
            role: app.role,
            status: statusDisplay,
            communityId,
            occuredAt: new Date(),
          });
        }
      }
      return top?.status ?? app.status;
    });

    notifyChanges("applications");
    return NextResponse.json({
      ok: true,
      added: rows.length,
      status: latest ? enumToStatus(latest) : null,
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}