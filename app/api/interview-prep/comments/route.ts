import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { ivpComments } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { namesByIds } from "@/db/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  try {
    await requireUser(req);
    const { searchParams } = new URL(req.url);
    const postId = searchParams.get("postId");

    if (!postId) throw new HttpError(400, "Missing postId");

    const rows = await db
      .select()
      .from(ivpComments)
      .where(eq(ivpComments.commentedOn, postId))
      .orderBy(asc(ivpComments.commentDate));

    // Resolve names
    const nameById = await namesByIds(db, rows.map((r) => r.commentedBy));

    const comments = rows
      .map((r) => {
        const userId = r.commentedBy || "";
        const userName = nameById[r.commentedBy] || "";
        return {
          id: r.commentId,
          postId: r.commentedOn || "",
          userId,
          userName,
          text: r.commentContent || "",
          createdAt: r.commentDate instanceof Date ? r.commentDate.toISOString() : "",
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

    const [comment] = await db
      .insert(ivpComments)
      .values({
        commentedOn: postId,
        commentedBy: user.id,
        commentContent: text,
      })
      .returning();

    return NextResponse.json({ ok: true, id: comment.commentId });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}