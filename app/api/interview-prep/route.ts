import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERVIEW_PREP = "interviewPrep";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  try {
    await requireUser(req);
    const snap = await adminDb.collection(INTERVIEW_PREP).orderBy("createdAt", "desc").get();
    const posts = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        title: x.title || "",
        content: x.content || "",
        company: x.company || "general",
        ownerUid: x.ownerUid || "",
        ownerName: x.ownerName || "Someone",
        createdAt: x.createdAt?.toDate?.()?.toISOString?.() ?? "",
        updatedAt: x.updatedAt?.toDate?.()?.toISOString?.() ?? "",
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
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();
    const company = String(body.company || "general").trim();

    if (!title) throw new HttpError(400, "Title is required");
    if (!content) throw new HttpError(400, "Content is required");

    const now = FieldValue.serverTimestamp();
    const ref = await adminDb.collection(INTERVIEW_PREP).add({
      title,
      content,
      company,
      ownerUid: user.uid,
      ownerName: user.name,
      createdAt: now,
      updatedAt: now,
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

    const ref = adminDb.collection(INTERVIEW_PREP).doc(id);
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
