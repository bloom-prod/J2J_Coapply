import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { applications, applicationUserStatus } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { logActivity } from "@/db/activity";
import { statusToEnum, priorityToEnum, roleCategoryToEnum } from "@/lib/enums";
import { STATUSES, NOT_YET_APPLIED_STATUS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = [
  "company",
  "role",
  "roleCategory",
  "status",
  "priority",
  "location",
  "date",
  "salary",
  "url",
  "recruiter",
  "followup",
  "notes",
] as const;

const MAX_ROWS = 500;

function pickFields(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of FIELDS) {
    if (input[k] === undefined) continue;
    out[k] = String(input[k] ?? "").trim();
  }
  return out;
}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const rows = Array.isArray(body.jobs) ? body.jobs : null;
    if (!rows) throw new HttpError(400, "Missing 'jobs' array");
    if (rows.length === 0) throw new HttpError(400, "No rows provided");
    if (rows.length > MAX_ROWS) {
      throw new HttpError(400, `Too many rows (max ${MAX_ROWS})`);
    }

    const now = new Date();
    const appRows: typeof applications.$inferInsert[] = [];
    const statusRows: typeof applicationUserStatus.$inferInsert[] = [];
    const activities: { id: string; company: string; role: string; statusDisplay: string }[] = [];
    const ids: string[] = [];
    let created = 0;
    let appliedCount = 0;

    rows.forEach((raw: Record<string, unknown>) => {
      const data = pickFields(raw);
      if (!data.company || !data.role) return;

      const status = (data.status as string) || "Applied";
      const validStatus = STATUSES.includes(status as (typeof STATUSES)[number])
        ? status
        : "Applied";
      const statusEnum = statusToEnum(validStatus) ?? "APPLIED";

      // Explicit uuid so the status log / activity can reference this row
      // (applications.application_id is a DB default otherwise).
      const id = randomUUID();
      ids.push(id);

      appRows.push({
        applicationId: id,
        company: data.company,
        role: data.role,
        roleCategory: data.roleCategory ? roleCategoryToEnum(data.roleCategory) : null,
        status: statusEnum,
        priority: priorityToEnum((data.priority as string) || "Medium") ?? "MEDIUM",
        location: (data.location as string) || null,
        appliedDate: (data.date as string) || null,
        salary: (data.salary as string) || null,
        url: (data.url as string) || null,
        recruiterName: (data.recruiter as string) || null,
        followUp: (data.followup as string) || null,
        notes: (data.notes as string) || null,
        starred: false,
        applicantId: user.id,
        createdAt: now,
        updatedAt: now,
      });
      statusRows.push({
        applicationId: id,
        changedById: user.id,
        status: statusEnum,
        changedAt: now,
      });
      created++;
      if (validStatus !== NOT_YET_APPLIED_STATUS) {
        appliedCount++;
        activities.push({ id, company: data.company, role: data.role, statusDisplay: validStatus });
      }
    });

    if (created === 0) throw new HttpError(400, "No valid rows (company & role required)");

    await db.transaction(async (tx) => {
      await tx.insert(applications).values(appRows);
      await tx.insert(applicationUserStatus).values(statusRows);

      // Only emit feed events for real applications, not "Want to Apply" rows.
      for (const a of activities) {
        const se = statusToEnum(a.statusDisplay) ?? "APPLIED";
        await logActivity(tx, {
          userId: user.id,
          type: se === "OFFER" ? "OFFER" : "APPLIED",
          company: a.company,
          role: a.role,
          status: a.statusDisplay,
          occuredAt: now,
        });
      }
    });

    return NextResponse.json({ ok: true, created, ids });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}