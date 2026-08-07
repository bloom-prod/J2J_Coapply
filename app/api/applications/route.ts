import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";
import { STATUSES, NOT_YET_APPLIED_STATUS, reachedFlagsForStatus, computeReachedFlags, type ReachedFlag } from "@/lib/types";

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

const APPLICATIONS = "applications";
const FEED = "feed";

function pickFields(input: Record<string, unknown>): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const k of FIELDS) {
    if (input[k] === undefined) continue;
    out[k] = String(input[k] ?? "").trim();
  }
  if (typeof out.status === "string" && out.status) {
    if (!STATUSES.includes(out.status as (typeof STATUSES)[number])) out.status = "Applied";
  }
  if (input.starred !== undefined) out.starred = input.starred === true || input.starred === "true";
  return out;
}

async function addFeedEvent(ev: {
  type: "applied" | "status" | "offer";
  company: string;
  role: string;
  status: string;
  ownerUid: string;
}) {
  await adminDb.collection(FEED).add({ ...ev, ts: FieldValue.serverTimestamp() });
}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const data = pickFields(body);
    if (!data.company) throw new HttpError(400, "Company is required");
    if (!data.role) throw new HttpError(400, "Role is required");

    const status = (data.status as string) || "Applied";
    const now = FieldValue.serverTimestamp();
    // Seed sticky funnel flags from the starting status so a newly-created
    // "Interview" row immediately counts in the interview funnel/rate.
    const reached = reachedFlagsForStatus(status) as Record<ReachedFlag, true>;
    const ref = await adminDb.collection(APPLICATIONS).add({
      ...data,
      status,
      starred: data.starred === true,
      ownerUid: user.uid,
      ...reached,
      createdAt: now,
      updatedAt: now,
    });

    // Adding a "Want to Apply" row is bookmarking a job, not applying to one —
    // no feed event, or the activity list announces "applied to X" for jobs the
    // user has only shortlisted. The real event fires on the status change in PUT.
    if (status !== NOT_YET_APPLIED_STATUS) {
      await addFeedEvent({
        type: status === "Offer" ? "offer" : "applied",
        company: data.company as string,
        role: data.role as string,
        status,
        ownerUid: user.uid,
      });
    }

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const id = body.id as string | undefined;
    if (!id) throw new HttpError(400, "Missing application id");

    const ref = adminDb.collection(APPLICATIONS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, "Application not found");
    const existing = snap.data() as Record<string, unknown>;
    if (existing.ownerUid !== user.uid) {
      throw new HttpError(403, "You can only edit your own applications");
    }

    const data = pickFields(body);
    const newStatus = data.status as string | undefined;
    const update: Record<string, unknown> = { ...data, updatedAt: FieldValue.serverTimestamp() };
    // Sticky flags: merge the new status's flags into the ones already on the
    // doc so a later Rejected / Ghosted / Withdrawn never erases the funnel
    // stages the app passed through (Applied → OA → Interview → Rejected stays
    // counted as 1 applied, 1 OA, 1 interview, plus the rejection).
    if (newStatus) {
      Object.assign(update, computeReachedFlags(newStatus, existing as Partial<Record<ReachedFlag, boolean>>));
    }
    await ref.update(update);

    if (newStatus && newStatus !== existing.status) {
      // Leaving "Want to Apply" is the moment they actually applied, so report it
      // as an application rather than a generic status change.
      const justApplied = existing.status === NOT_YET_APPLIED_STATUS && newStatus === "Applied";
      await addFeedEvent({
        type: newStatus === "Offer" ? "offer" : justApplied ? "applied" : "status",
        company: (data.company as string) || (existing.company as string) || "",
        role: (data.role as string) || (existing.role as string) || "",
        status: newStatus,
        ownerUid: user.uid,
      });
    }

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
    const id = (body.id as string) || url.searchParams.get("id") || "";
    if (!id) throw new HttpError(400, "Missing application id");

    const ref = adminDb.collection(APPLICATIONS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ ok: true, id });
    const existing = snap.data() as Record<string, unknown>;
    if (existing.ownerUid !== user.uid) {
      throw new HttpError(403, "You can only delete your own applications");
    }
    await ref.delete();
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
