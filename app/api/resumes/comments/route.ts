import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMENTS = "resumeComments";
const RESUMES = "resumes";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  try {
    await requireUser(req);
    const url = new URL(req.url);
    const resumeId = url.searchParams.get("resumeId") || "";
    if (!resumeId) throw new HttpError(400, "Missing resumeId");

    const snap = await adminDb
      .collection(COMMENTS)
      .where("resumeId", "==", resumeId)
      .get();

    // Fetch userProfiles to resolve current names
    const profilesSnap = await adminDb.collection("userProfiles").get();
    const uidToName = new Map();
    profilesSnap.docs.forEach((d) => {
      const name = d.data().name;
      if (name) uidToName.set(d.id, name);
    });

    const comments = snap.docs.map((d) => {
      const x = d.data();
      const userId = x.userId || "";
      // Resolve current name from userProfiles, fallback to stored name or "Someone"
      const userName = uidToName.get(userId) || x.userName || "Someone";
      return {
        id: d.id,
        resumeId: x.resumeId || "",
        userId,
        userName,
        text: x.text || "",
        createdAt: x.createdAt?.toDate?.()?.toISOString?.() ?? "",
        resolved: x.resolved === true,
      };
    });
    comments.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
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
    const resumeId = String(body.resumeId || "").trim();
    const text = String(body.text || "").trim();

    if (!resumeId) throw new HttpError(400, "Missing resumeId");
    if (!text) throw new HttpError(400, "Comment text is required");

    const resumeSnap = await adminDb.collection(RESUMES).doc(resumeId).get();
    if (!resumeSnap.exists) throw new HttpError(404, "Resume not found");

    const ref = await adminDb.collection(COMMENTS).add({
      resumeId,
      userId: user.uid,
      userName: user.name,
      text,
      resolved: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      comment: {
        id: ref.id,
        resumeId,
        userId: user.uid,
        userName: user.name,
        text,
        createdAt: new Date().toISOString(),
        resolved: false,
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

// PATCH: toggle resolved on a comment
export async function PATCH(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const id = String(body.id || "").trim();
    const resumeId = String(body.resumeId || "").trim();
    if (!id || !resumeId) throw new HttpError(400, "Missing id or resumeId");

    const commentRef = adminDb.collection(COMMENTS).doc(id);
    const [commentSnap, resumeSnap] = await Promise.all([
      commentRef.get(),
      adminDb.collection(RESUMES).doc(resumeId).get(),
    ]);
    if (!commentSnap.exists) throw new HttpError(404, "Comment not found");

    const cData = commentSnap.data() as Record<string, unknown>;
    const rData = resumeSnap.data() as Record<string, unknown> | undefined;

    const isCommenter = cData.userId === user.uid;
    const isResumeOwner = rData?.userId === user.uid;
    if (!isCommenter && !isResumeOwner) throw new HttpError(403, "Not allowed");

    await commentRef.update({ resolved: !cData.resolved });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
