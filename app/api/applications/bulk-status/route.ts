import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { applications, applicationUserStatus } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { logActivity } from "@/db/activity";
import { getUserCommunityId } from "@/lib/community";
import { statusToEnum, enumToStatus } from "@/lib/enums";
import { STATUSES, NOT_YET_APPLIED_STATUS } from "@/lib/types";
import { notifyChanges } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Move many applications to one status in a single call — the shape an agent
 * needs to close out a batch of rejections without one PUT per row.
 *
 * POST { ids: string[], status?: Status }  ->  { ok, status, updated, results }
 *
 * `status` defaults to "Rejected", the case this exists for. Unlike PUT
 * /api/applications, an unrecognized status is a 400 rather than a silent
 * fallback to "Applied": a caller sweeping dozens of rows at once can't
 * eyeball the result, so a typo must fail loudly instead of writing the
 * wrong status everywhere.
 */

const MAX_IDS = 500;

/** Per-id outcome, so a partial batch tells the caller exactly what happened. */
type Outcome = "updated" | "unchanged" | "not_found" | "forbidden";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const communityId = await getUserCommunityId(user.id, req);
    const body = await req.json().catch(() => ({}));

    if (!Array.isArray(body.ids)) throw new HttpError(400, "Missing 'ids' array");
    const ids = [...new Set(body.ids.map((v: unknown) => String(v ?? "").trim()).filter(Boolean))] as string[];
    if (ids.length === 0) throw new HttpError(400, "No application ids provided");
    if (ids.length > MAX_IDS) throw new HttpError(400, `Too many ids (max ${MAX_IDS})`);

    const statusDisplay = String(body.status ?? "Rejected").trim() || "Rejected";
    if (!STATUSES.includes(statusDisplay as (typeof STATUSES)[number])) {
      throw new HttpError(400, `Unknown status '${statusDisplay}'. Expected one of: ${STATUSES.join(", ")}`);
    }
    const statusEnum = statusToEnum(statusDisplay)!;

    const rows = await db
      .select({
        applicationId: applications.applicationId,
        applicantId: applications.applicantId,
        company: applications.company,
        role: applications.role,
        status: applications.status,
      })
      .from(applications)
      .where(inArray(applications.applicationId, ids));
    const byId = new Map(rows.map((r) => [r.applicationId, r]));

    const results: { id: string; result: Outcome }[] = [];
    const toUpdate: typeof rows = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        results.push({ id, result: "not_found" });
      } else if (row.applicantId !== user.id) {
        // Same rule as PUT: you can only move your own applications. Reported
        // per id rather than failing the batch, so one stray id from someone
        // else's row doesn't strand the rest.
        results.push({ id, result: "forbidden" });
      } else if (row.status === statusEnum) {
        results.push({ id, result: "unchanged" });
      } else {
        results.push({ id, result: "updated" });
        toUpdate.push(row);
      }
    }

    if (toUpdate.length) {
      const now = new Date();
      const changedIds = toUpdate.map((r) => r.applicationId);
      await db.transaction(async (tx) => {
        await tx
          .update(applications)
          .set({ status: statusEnum, updatedAt: now })
          .where(inArray(applications.applicationId, changedIds));

        await tx.insert(applicationUserStatus).values(
          changedIds.map((id) => ({
            applicationId: id,
            changedById: user.id,
            status: statusEnum,
            changedAt: now,
          }))
        );

        // One feed event per row, matching the single-row PUT — the funnel and
        // insights read this log, so skipping it would leave a batch invisible.
        for (const row of toUpdate) {
          const justApplied =
            enumToStatus(row.status) === NOT_YET_APPLIED_STATUS && statusDisplay === "Applied";
          await logActivity(tx, {
            userId: user.id,
            type: statusEnum === "OFFER" ? "OFFER" : justApplied ? "APPLIED" : "STATUS",
            company: row.company,
            role: row.role,
            status: statusDisplay,
            communityId,
            occuredAt: now,
          });
        }
      });
      notifyChanges("applications");
    }

    return NextResponse.json({
      ok: true,
      status: statusDisplay,
      updated: toUpdate.length,
      results,
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
