import { NextResponse } from "next/server";
import { FieldValue, WriteBatch } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";
import { STATUSES } from "@/lib/types";

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

    const batch: WriteBatch = adminDb.batch();
    const ids: string[] = [];
    let created = 0;

    rows.forEach((raw: Record<string, unknown>) => {
      const data = pickFields(raw);
      if (!data.company || !data.role) return;
      const status = (data.status as string) || "Applied";
      const validStatus = STATUSES.includes(status as (typeof STATUSES)[number])
        ? status
        : "Applied";
      const ref = adminDb.collection(APPLICATIONS).doc();
      ids.push(ref.id);
      batch.set(ref, {
        ...data,
        status: validStatus,
        starred: false,
        ownerUid: user.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      created++;
    });

    if (created === 0) throw new HttpError(400, "No valid rows (company & role required)");

    await batch.commit();

    // Single feed event summarizing the bulk import.
    await adminDb.collection(FEED).add({
      type: "applied",
      company: `${created} applications`,
      role: "Bulk import",
      status: "Applied",
      ownerUid: user.uid,
      ts: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, created, ids });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
