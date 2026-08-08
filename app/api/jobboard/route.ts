import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { jobboard } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { logActivity, namesByIds } from "@/db/activity";
import { isSafeHttpUrl } from "@/lib/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  try {
    await requireUser(req);
    const rows = await db
      .select()
      .from(jobboard)
      .orderBy(desc(jobboard.createdAt));

    // Resolve owner names
    const nameById = await namesByIds(db, rows.map((r) => r.postedBy));

    const posts = rows.map((r) => {
      const ownerUid = r.postedBy || "";
      const ownerName = nameById[r.postedBy] || "";
      return {
        id: r.postId,
        company: r.company || "",
        role: r.jobRole || "",
        url: r.jobUrl || "",
        location: r.jobLocation || "",
        notes: r.jobNotes || "",
        ownerUid,
        ownerName,
        postedAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : "",
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
    const body = await req.json();
    const company = String(body.company || "").trim();
    const role = String(body.role || "").trim();
    const url = String(body.url || "").trim();
    if (!company) throw new HttpError(400, "Company is required");
    if (!role) throw new HttpError(400, "Role is required");
    if (!url) throw new HttpError(400, "Apply URL is required");
    if (!isSafeHttpUrl(url)) throw new HttpError(400, "Apply URL must be a valid http(s) link");

    const now = new Date();
    const record = await db.transaction(async (tx) => {
      const [post] = await tx
        .insert(jobboard)
        .values({
          company,
          jobRole: role,
          jobUrl: url,
          jobLocation: String(body.location || "").trim(),
          jobNotes: String(body.notes || "").trim(),
          postedBy: user.id,
          createdAt: now,
        })
        .returning();

      await logActivity(tx, {
        userId: user.id,
        type: "JOB_SHARE",
        company,
        role,
        status: "",
        occuredAt: now,
      });
      return post;
    });

    return NextResponse.json({ ok: true, id: record.postId });
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

    const existing = await db.query.jobboard.findFirst({
      where: eq(jobboard.postId, id),
    });
    if (!existing) return NextResponse.json({ ok: true });
    if (existing.postedBy !== user.id) throw new HttpError(403, "You can only delete your own posts");
    await db.delete(jobboard).where(eq(jobboard.postId, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}