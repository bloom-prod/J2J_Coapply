import { NextResponse } from "next/server";
import * as admin from "firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function getDb() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "{}");
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: process.env.FIREBASE_DATABASE_URL });
  }
  return admin.database();
}

export async function GET(req: Request) {
  try {
    await requireUser(req);
    const { searchParams } = new URL(req.url);
    const postId = searchParams.get("postId");

    if (!postId) throw new HttpError(400, "Missing postId");

    const db = getDb();
    const snapshot = await db.ref("interviewPrepComments").get();

    if (!snapshot.exists()) {
      return NextResponse.json({ ok: true, comments: [] });
    }

    const commentsObj = snapshot.val();
    const comments = Object.entries(commentsObj || {})
      .filter(([, data]: [string, any]) => data.postId === postId)
      .map(([id, data]: [string, any]) => ({
        id,
        postId: data.postId || "",
        userId: data.userId || "",
        userName: data.userName || "Someone",
        text: data.text || "",
        createdAt: data.createdAt || new Date().toISOString(),
      }))
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

    const db = getDb();
    const now = new Date().toISOString();
    const newRef = db.ref("interviewPrepComments").push();

    await newRef.set({
      postId,
      userId: user.uid,
      userName: user.name,
      text,
      createdAt: now,
    });

    return NextResponse.json({ ok: true, id: newRef.key });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
