import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// Returns full resume doc including base64 for PDF viewing
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser(req);
    const snap = await adminDb.collection("resumes").doc(params.id).get();
    if (!snap.exists) throw new HttpError(404, "Resume not found");
    const x = snap.data()!;
    return NextResponse.json({
      ok: true,
      fileBase64: x.fileBase64 || "",
      fileName: x.fileName || "resume.pdf",
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
