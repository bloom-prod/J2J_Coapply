import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { resumeComments, resumes } from "@/db/schema";
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
    const url = new URL(req.url);
    const resumeId = url.searchParams.get("resumeId") || "";
    if (!resumeId) throw new HttpError(400, "Missing resumeId");

    const rows = await db
      .select()
      .from(resumeComments)
      .where(eq(resumeComments.resumeId, resumeId))
      .orderBy(asc(resumeComments.createdAt));

    // Resolve current names, fallback to stored name or "Someone"
    const nameById = await namesByIds(db, rows.map((r) => r.commenterId));

    const comments = rows.map((r) => {
      const userId = r.commenterId || "";
      const userName = nameById[r.commenterId] || "Someone";
      return {
        id: r.commentId,
        resumeId: r.resumeId || "",
        userId,
        userName,
        text: r.comment || "",
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : "",
        resolved: r.resolvedStatus === true,
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

    const resume = await db.query.resumes.findFirst({
      where: eq(resumes.resumeId, resumeId),
    });
    if (!resume) throw new HttpError(404, "Resume not found");

    const [comment] = await db
      .insert(resumeComments)
      .values({
        resumeId,
        commenterId: user.id,
        comment: text,
        resolvedStatus: false,
      })
      .returning();

    return NextResponse.json({
      ok: true,
      comment: {
        id: comment.commentId,
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

    const [comment, resume] = await Promise.all([
      db.query.resumeComments.findFirst({
        where: eq(resumeComments.commentId, id),
      }),
      db.query.resumes.findFirst({
        where: eq(resumes.resumeId, resumeId),
      }),
    ]);
    if (!comment) throw new HttpError(404, "Comment not found");

    const isCommenter = comment.commenterId === user.id;
    const isResumeOwner = resume?.userId === user.id;
    if (!isCommenter && !isResumeOwner) throw new HttpError(403, "Not allowed");

    await db
      .update(resumeComments)
      .set({ resolvedStatus: !comment.resolvedStatus })
      .where(eq(resumeComments.commentId, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}