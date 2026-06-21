import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESUMES = "resumes";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// List — returns metadata only (no base64 to keep responses small)
export async function GET(req: Request) {
  try {
    await requireUser(req);
    const snap = await adminDb.collection(RESUMES).orderBy("createdAt", "desc").get();
    const resumes = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        userId: x.userId || "",
        userName: x.userName || "Someone",
        title: x.title || "",
        fileName: x.fileName || "",
        uploadedAt: x.createdAt?.toDate?.()?.toISOString?.() ?? "",
      };
    });
    return NextResponse.json({ ok: true, resumes });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

// Upload — stores the PDF as base64 in Firestore (max ~700 KB file)
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const title = String(body.title || "").trim();
    const fileName = String(body.fileName || "resume.pdf").trim();
    const fileBase64 = String(body.fileBase64 || "");

    if (!title) throw new HttpError(400, "Title is required");
    if (!fileBase64) throw new HttpError(400, "File is required");

    const byteLen = Math.ceil((fileBase64.length * 3) / 4);
    if (byteLen > 700 * 1024) throw new HttpError(400, "File must be under 700 KB");

    const ref = await adminDb.collection(RESUMES).add({
      userId: user.uid,
      userName: user.name,
      title,
      fileName,
      fileBase64,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      resume: {
        id: ref.id,
        userId: user.uid,
        userName: user.name,
        title,
        fileName,
        uploadedAt: new Date().toISOString(),
      },
    });
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
    if (!id) throw new HttpError(400, "Missing resume id");

    const ref = adminDb.collection(RESUMES).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ ok: true });

    const data = snap.data() as Record<string, unknown>;
    if (data.userId !== user.uid) throw new HttpError(403, "You can only delete your own resumes");

    const commentsSnap = await adminDb.collection("resumeComments").where("resumeId", "==", id).get();
    const batch = adminDb.batch();
    commentsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
