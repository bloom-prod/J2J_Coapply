import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLLECTION = "interviewPrepComments";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  try {
    await requireUser(req);
    const { searchParams } = new URL(req.url);
    const postId = searchParams.get("postId");

    if (!postId) throw new HttpError(400, "Missing postId");

    const snap = await adminDb
      .collection(COLLECTION)
      .where("postId", "==", postId)
      .get();

    const comments = snap.docs
      .map((d) => {
        const x = d.data();
        return {
          id: d.id,
          postId: x.postId || "",
          userId: x.userId || "",
          text: x.text || "",
          createdAt: x.createdAt?.toDate?.()?.toISOString?.() ?? "",
        };
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return NextResponse.json({ ok: true, comments });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const postId = String(body.postId || "").trim();
    const text = String(body.text || "").trim();

    if (!postId) throw new HttpError(400, "Missing postId");
    if (!text) throw new HttpError(400, "Comment text is required");

    const ref = await adminDb.collection(COLLECTION).add({
      postId,
      userId: user.uid,
      text,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
