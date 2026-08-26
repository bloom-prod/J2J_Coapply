import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, applicationUserStatus } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { logActivity } from "@/db/activity";
import { statusToEnum } from "@/lib/enums";
import { STATUSES } from "@/lib/types";
import { notifyChanges } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 500;

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

interface UpdateRow {
  id: string;
  status: string;
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const updates = Array.isArray(body.updates) ? body.updates : null;
    if (!updates) throw new HttpError(400, "Missing 'updates' array");
    if (updates.length === 0) throw new HttpError(400, "No rows provided");
    if (updates.length > MAX_ROWS) {
      throw new HttpError(400, `Too many rows (max ${MAX_ROWS})`);
    }

    const now = new Date();
    const statusRows: typeof applicationUserStatus.$inferInsert[] = [];
    const updatedApps: { id: string; company: string; role: string; status: string }[] = [];
    let updated = 0;

    // Fetch all applications to verify they exist and user owns them
    const appIds = updates.map((u: UpdateRow) => u.id);
    const existingApps = await Promise.all(
      appIds.map((id: string) =>
        db.query.applications.findFirst({ where: eq(applications.applicationId, id) })
      )
    );

    // Check all exist and user owns them
    for (let i = 0; i < existingApps.length; i++) {
      const app = existingApps[i];
      const update = updates[i];
      if (!app) throw new HttpError(404, `Application ${update.id} not found`);
      if (app.applicantId !== user.id) {
        throw new HttpError(403, `You do not own application ${update.id}`);
      }
    }

    updates.forEach((raw: UpdateRow, idx: number) => {
      const app = existingApps[idx];
      if (!app) return;

      const statusRaw = raw.status || "Applied";
      const validStatus = STATUSES.includes(statusRaw as (typeof STATUSES)[number])
        ? statusRaw
        : "Applied";
      const statusEnum = statusToEnum(validStatus) ?? "APPLIED";

      // Only add status log if status actually changed
      if (app.status !== statusEnum) {
        statusRows.push({
          applicationId: app.applicationId,
          changedById: user.id,
          status: statusEnum,
          changedAt: now,
        });
        updated++;
        updatedApps.push({
          id: app.applicationId,
          company: app.company || "",
          role: app.role || "",
          status: validStatus,
        });
      }
    });

    if (updated === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    await db.transaction(async (tx) => {
      // Update application statuses
      for (const app of updatedApps) {
        const statusEnum = statusToEnum(app.status) ?? "APPLIED";
        await tx
          .update(applications)
          .set({ status: statusEnum, updatedAt: now })
          .where(eq(applications.applicationId, app.id))
          .execute();
      }

      // Insert status log entries
      await tx.insert(applicationUserStatus).values(statusRows);

      // Log activities for status changes (but not Want to Apply)
      for (const a of updatedApps) {
        if (a.status !== "Want to Apply") {
          await logActivity(tx, {
            userId: user.id,
            type: "STATUS",
            company: a.company,
            role: a.role,
            status: a.status,
            occuredAt: now,
          });
        }
      }
    });

    notifyChanges("applications");

    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
