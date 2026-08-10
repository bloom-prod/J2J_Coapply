import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { interviewPrep } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { namesByIds } from "@/db/activity";
import { notifyChanges } from "@/lib/live";
import { getUserCommunityId } from "@/lib/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const communityId = await getUserCommunityId(user.id, req);
    const rows = await db
      .select()
      .from(interviewPrep)
      .where(eq(interviewPrep.communityId, communityId))
      .orderBy(desc(interviewPrep.createdAt));

    // Resolve creator names
    const nameById = await namesByIds(db, rows.map((r) => r.creatorId));

    const posts = rows.map((r) => {
      const ownerUid = r.creatorId || "";
      const ownerName = nameById[r.creatorId] || "";
      return {
        id: r.postId,
        title: r.postTitle || "",
        content: r.postContent || "",
        company: r.company || "general",
        ownerUid,
        ownerName,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : "",
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : "",
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
    const communityId = await getUserCommunityId(user.id, req);
    const body = await req.json();
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();
    const company = String(body.company || "general").trim();

    if (!title) throw new HttpError(400, "Title is required");
    if (!content) throw new HttpError(400, "Content is required");

    const now = new Date();
    const [post] = await db
      .insert(interviewPrep)
      .values({
        postTitle: title,
        postContent: content,
        company,
        creatorId: user.id,
        communityId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    notifyChanges("interview-prep");
    return NextResponse.json({ ok: true, id: post.postId });
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

    const existing = await db.query.interviewPrep.findFirst({
      where: eq(interviewPrep.postId, id),
    });
    if (!existing) return NextResponse.json({ ok: true });
    if (existing.creatorId !== user.id) throw new HttpError(403, "You can only delete your own posts");
    await db.delete(interviewPrep).where(eq(interviewPrep.postId, id));
    notifyChanges("interview-prep");
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}