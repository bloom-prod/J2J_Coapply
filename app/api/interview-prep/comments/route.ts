import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERVIEW_PREP_COMMENTS = "interviewPrepComments";

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
      .collection(INTERVIEW_PREP_COMMENTS)
      .where("postId", "==", postId)
      .orderBy("createdAt", "asc")
      .get();

    const comments = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        postId: x.postId || "",
        userId: x.userId || "",
        userName: x.userName || "Someone",
        text: x.text || "",
        createdAt: x.createdAt?.toDate?.()?.toISOString?.() ?? "",
      };
    });

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

    const now = FieldValue.serverTimestamp();
    const ref = await adminDb.collection(INTERVIEW_PREP_COMMENTS).add({
      postId,
      userId: user.uid,
      userName: user.name,
      text,
      createdAt: now,
    });

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
