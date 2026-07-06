import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOBBOARD = "jobBoard";
const FEED = "feed";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  try {
    await requireUser(req);
    const snap = await adminDb.collection(JOBBOARD).orderBy("createdAt", "desc").get();
    const posts = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        company: x.company || "",
        role: x.role || "",
        url: x.url || "",
        location: x.location || "",
        notes: x.notes || "",
        ownerUid: x.ownerUid || "",
        ownerName: x.ownerName || "Someone",
        postedAt: x.createdAt?.toDate?.()?.toISOString?.() ?? "",
      };
    });
    return NextResponse.json({ ok: true, posts });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const company = String(body.company || "").trim();
    const role = String(body.role || "").trim();
    const url = String(body.url || "").trim();
    if (!company) throw new HttpError(400, "Company is required");
    if (!role) throw new HttpError(400, "Role is required");
    if (!url) throw new HttpError(400, "Apply URL is required");

    const now = FieldValue.serverTimestamp();
    const ref = await adminDb.collection(JOBBOARD).add({
      company,
      role,
      url,
      location: String(body.location || "").trim(),
      notes: String(body.notes || "").trim(),
      ownerUid: user.uid,
      ownerName: user.name,
      createdAt: now,
    });

    await adminDb.collection(FEED).add({
      type: "job_share",
      company,
      role,
      status: "",
      ownerUid: user.uid,
      ownerName: user.name,
      ts: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id) throw new HttpError(400, "Missing post id");

    const ref = adminDb.collection(JOBBOARD).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ ok: true });
    const existing = snap.data() as Record<string, unknown>;
    if (existing.ownerUid !== user.uid) throw new HttpError(403, "You can only delete your own posts");
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
