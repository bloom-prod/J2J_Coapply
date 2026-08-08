import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { applications, applicationUserStatus } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { logActivity, namesByIds } from "@/db/activity";
import { statusToEnum, enumToStatus, priorityToEnum, enumToPriority, roleCategoryToEnum, enumToRoleCategory } from "@/lib/enums";
import { STATUSES, NOT_YET_APPLIED_STATUS, reachedFlagsForStatus, type ReachedFlag } from "@/lib/types";
import { isSafeHttpUrl } from "@/lib/safe-url";

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

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function cleanInput(input: Record<string, unknown>) {
  const out: Record<string, string | boolean> = {};
  for (const k of FIELDS) {
    if (input[k] === undefined) continue;
    out[k] = String(input[k] ?? "").trim();
  }
  if (typeof out.status === "string" && out.status && !STATUSES.includes(out.status as (typeof STATUSES)[number])) {
    out.status = "Applied";
  }
  if (typeof out.priority === "string" && out.priority && !["High", "Medium", "Low"].includes(out.priority)) {
    out.priority = "Medium";
  }
  if (input.starred !== undefined) out.starred = input.starred === true || input.starred === "true";
  return out;
}

// List all applications (community view), newest first, with owner names.
// Sticky per-stage funnel flags are recovered from the status log (same
// approach as /api/stats) so an app that reached Interview then went Rejected
// still counts toward the OA/Interview buckets in the community/insights tabs.
export async function GET(req: Request) {
  try {
    await requireUser(req);
    const rows = await db.select().from(applications).orderBy(desc(applications.createdAt));

    const ids = rows.map((r) => r.applicationId);
    const logs = ids.length
      ? await db
          .select({
            applicationId: applicationUserStatus.applicationId,
            status: applicationUserStatus.status,
          })
          .from(applicationUserStatus)
          .where(inArray(applicationUserStatus.applicationId, ids))
      : [];
    const history = new Map<string, Set<string>>();
    for (const l of logs) {
      if (!history.has(l.applicationId)) history.set(l.applicationId, new Set());
      history.get(l.applicationId)!.add(l.status);
    }
    const flagsFor = (applicationId: string): Partial<Record<ReachedFlag, boolean>> => {
      const flags: Partial<Record<ReachedFlag, boolean>> = {};
      const seen = history.get(applicationId);
      if (seen) {
        for (const se of seen) {
          if (!se) continue;
          const disp = enumToStatus(se);
          if (disp) Object.assign(flags, reachedFlagsForStatus(disp));
        }
      }
      return flags;
    };

    const nameById = await namesByIds(db, rows.map((r) => r.applicantId));
    const list = rows.map((r) => {
      const flags = flagsFor(r.applicationId);
      return {
      id: r.applicationId,
      company: r.company || "",
      role: r.role || "",
      roleCategory: r.roleCategory ? enumToRoleCategory(r.roleCategory) : "",
      status: r.status ? enumToStatus(r.status) : "Applied",
      priority: r.priority ? enumToPriority(r.priority) : "",
      location: r.location || "",
      date: r.appliedDate || "",
      salary: r.salary || "",
      url: r.url || "",
      recruiter: r.recruiterName || "",
      followup: r.followUp || "",
      notes: r.notes || "",
      starred: r.starred === true,
      reachedApplied: flags.reachedApplied === true,
      reachedOA: flags.reachedOA === true,
      reachedPhoneScreen: flags.reachedPhoneScreen === true,
      reachedInterview: flags.reachedInterview === true,
      reachedOffer: flags.reachedOffer === true,
      ownerUid: r.applicantId,
      ownerName: nameById[r.applicantId] || "",
      added: r.createdAt ? r.createdAt.toISOString() : "",
      updated: r.updatedAt ? r.updatedAt.toISOString() : "",
      };
    });
    return NextResponse.json({ ok: true, applications: list });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const data = cleanInput(body);
    if (!data.company) throw new HttpError(400, "Company is required");
    if (!data.role) throw new HttpError(400, "Role is required");
    if (data.url && !isSafeHttpUrl(data.url)) {
      throw new HttpError(400, "URL must be a valid http(s) link");
    }

    const statusDisplay = (data.status as string) || "Applied";
    const statusEnum = statusToEnum(statusDisplay) ?? "APPLIED";
    const now = new Date();

    const record = await db.transaction(async (tx) => {
      const [app] = await tx
        .insert(applications)
        .values({
          company: data.company as string,
          role: data.role as string,
          roleCategory: data.roleCategory ? roleCategoryToEnum(data.roleCategory as string) : null,
          status: statusEnum,
          priority: priorityToEnum((data.priority as string) || "Medium") ?? "MEDIUM",
          location: (data.location as string) || null,
          appliedDate: (data.date as string) || null,
          salary: (data.salary as string) || null,
          url: (data.url as string) || null,
          recruiterName: (data.recruiter as string) || null,
          followUp: (data.followup as string) || null,
          notes: (data.notes as string) || null,
          starred: data.starred === true,
          applicantId: user.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // Record the starting status in application_user_status.
      await tx.insert(applicationUserStatus).values({
        applicationId: app.applicationId,
        changedById: user.id,
        status: statusEnum,
        changedAt: now,
      });

      // Only emit a feed event for real applications, not "Want to Apply" bookmarks.
      if (statusDisplay !== NOT_YET_APPLIED_STATUS) {
        await logActivity(tx, {
          userId: user.id,
          type: statusEnum === "OFFER" ? "OFFER" : "APPLIED",
          company: app.company,
          role: app.role,
          status: statusDisplay,
          occuredAt: now,
        });
      }
      return app;
    });

    return NextResponse.json({ ok: true, id: record.applicationId });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const id = String(body.id || "").trim();
    if (!id) throw new HttpError(400, "Missing application id");

    const existing = await db.query.applications.findFirst({
      where: eq(applications.applicationId, id),
    });
    if (!existing) throw new HttpError(404, "Application not found");
    if (existing.applicantId !== user.id) {
      throw new HttpError(403, "You can only edit your own applications");
    }

    const data = cleanInput(body);
    if (data.url && !isSafeHttpUrl(data.url)) {
      throw new HttpError(400, "URL must be a valid http(s) link");
    }
    const patch: Record<string, unknown> = {};
    for (const k of FIELDS) {
      if (data[k] === undefined) continue;
      if (k === "status") continue; // handled below
      if (k === "priority") { patch.priority = priorityToEnum(data[k] as string) ?? "MEDIUM"; continue; }
      if (k === "roleCategory") { patch.roleCategory = data[k] ? roleCategoryToEnum(data[k] as string) : null; continue; }
      if (k === "date") { patch.appliedDate = data[k]; continue; }
      if (k === "followup") { patch.followUp = data[k]; continue; }
      if (k === "recruiter") { patch.recruiterName = data[k]; continue; }
      patch[k] = data[k];
    }
    if (data.starred !== undefined) patch.starred = data.starred === true;

    const now = new Date();
    const newStatusDisplay = data.status as string | undefined;
    const prevStatusDisplay = existing.status ? enumToStatus(existing.status) : "";
    const statusChanged = !!newStatusDisplay && newStatusDisplay !== prevStatusDisplay;

    await db.transaction(async (tx) => {
      const values: Record<string, unknown> = { ...patch, updatedAt: now };
      if (newStatusDisplay) {
        values.status = statusToEnum(newStatusDisplay) ?? "APPLIED";
      }
      await tx.update(applications).set(values).where(eq(applications.applicationId, id));

      if (statusChanged) {
        const se = statusToEnum(newStatusDisplay!) ?? "APPLIED";
        await tx.insert(applicationUserStatus).values({
          applicationId: id,
          changedById: user.id,
          status: se,
          changedAt: now,
        });
        // Leaving "Want to Apply" is the real application event.
        const justApplied = prevStatusDisplay === NOT_YET_APPLIED_STATUS && newStatusDisplay === "Applied";
        await logActivity(tx, {
          userId: user.id,
          type: se === "OFFER" ? "OFFER" : justApplied ? "APPLIED" : "STATUS",
          company: (patch.company as string) || existing.company,
          role: (patch.role as string) || existing.role,
          status: newStatusDisplay,
          occuredAt: now,
        });
      }
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const id = String((body.id as string) || url.searchParams.get("id") || "").trim();
    if (!id) throw new HttpError(400, "Missing application id");

    const existing = await db.query.applications.findFirst({
      where: eq(applications.applicationId, id),
    });
    if (!existing) return NextResponse.json({ ok: true, id });
    if (existing.applicantId !== user.id) {
      throw new HttpError(403, "You can only delete your own applications");
    }
    await db.delete(applications).where(eq(applications.applicationId, id));
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}