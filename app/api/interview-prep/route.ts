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
    const db = getDb();
    const snapshot = await db.ref("interviewPrep").get();

    if (!snapshot.exists()) {
      return NextResponse.json({ ok: true, posts: [] });
    }

    const postsObj = snapshot.val();
    const posts = Object.entries(postsObj || {})
      .map(([id, data]: [string, any]) => ({
        id,
        title: data.title || "",
        content: data.content || "",
        company: data.company || "general",
        ownerUid: data.ownerUid || "",
        ownerName: data.ownerName || "Someone",
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString(),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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

    const db = getDb();
    const now = new Date().toISOString();
    const newRef = db.ref("interviewPrep").push();

    await newRef.set({
      title,
      content,
      company,
      ownerUid: user.uid,
      ownerName: user.name,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true, id: newRef.key });
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

    const db = getDb();
    const postRef = db.ref(`interviewPrep/${id}`);
    const snapshot = await postRef.get();

    if (!snapshot.exists()) return NextResponse.json({ ok: true });

    const existing = snapshot.val();
    if (existing.ownerUid !== user.uid) throw new HttpError(403, "You can only delete your own posts");

    await postRef.remove();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
