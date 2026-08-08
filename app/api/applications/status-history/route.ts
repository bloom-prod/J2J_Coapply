import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { applications, applicationUserStatus } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { enumToStatus } from "@/lib/enums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// The current user's applications with their status-change history
// (application_user_status), oldest first. Powers the Insights Sankey.
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);

    const apps = await db
      .select({ id: applications.applicationId, company: applications.company, role: applications.role, status: applications.status })
      .from(applications)
      .where(eq(applications.applicantId, user.id));

    const ids = apps.map((a) => a.id);
    const logs = ids.length
      ? await db
          .select({
            applicationId: applicationUserStatus.applicationId,
            status: applicationUserStatus.status,
            changedAt: applicationUserStatus.changedAt,
          })
          .from(applicationUserStatus)
          .where(inArray(applicationUserStatus.applicationId, ids))
          .orderBy(asc(applicationUserStatus.applicationId), asc(applicationUserStatus.changedAt))
      : [];

    const byApp = new Map<string, { status: string; changedAt: string }[]>();
    for (const l of logs) {
      const arr = byApp.get(l.applicationId) || [];
      arr.push({ status: enumToStatus(l.status) || "", changedAt: l.changedAt ? l.changedAt.toISOString() : "" });
      byApp.set(l.applicationId, arr);
    }

    return NextResponse.json({
      ok: true,
      applications: apps.map((a) => ({
        id: a.id,
        company: a.company || "",
        role: a.role || "",
        currentStatus: a.status ? enumToStatus(a.status) : "",
        history: byApp.get(a.id) || [],
      })),
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}