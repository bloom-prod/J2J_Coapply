import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { logActivity, namesByIds } from "@/db/activity";
import { ensureBucket, putResume, deleteResume } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

const resumeKey = (resumeId: string) => `resumes/${resumeId}.pdf`;

// List — returns metadata only (no base64 to keep responses small)
export async function GET(req: Request) {
  try {
    await requireUser(req);
    const rows = await db.select().from(resumes).orderBy(desc(resumes.createdAt));
    const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
    const nameById = ids.length ? await namesByIds(db, ids) : {};

    const result = rows.map((r) => ({
      id: r.resumeId,
      userId: r.userId,
      userName: nameById[r.userId] ?? "Someone",
      title: r.resumeTitle || "",
      fileName: r.fileName || "",
      uploadedAt: r.createdAt?.toISOString?.() ?? "",
    }));
    return NextResponse.json({ ok: true, resumes: result });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

// Upload — decodes the PDF, writes it to disk, and records metadata (max ~700 KB file)
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const title = String(body.title || "").trim();
    const fileName = String(body.fileName || "resume.pdf").trim();
    const fileBase64 = String(body.fileBase64 || "");

    if (!title) throw new HttpError(400, "Title is required");
    if (!fileBase64) throw new HttpError(400, "File is required");

    const fileBuffer = Buffer.from(fileBase64, "base64");
    if (fileBuffer.byteLength > 700 * 1024) throw new HttpError(400, "File must be under 700 KB");

    const resumeId = randomUUID();
    const key = resumeKey(resumeId);

    const now = new Date();
    await db.transaction(async (tx) => {
      await ensureBucket();
      await putResume(key, fileBuffer);
      await tx.insert(resumes).values({
        resumeId,
        filePath: key,
        userId: user.id,
        fileName,
        resumeTitle: title,
        createdAt: now,
      });
      await logActivity(tx, {
        userId: user.id,
        type: "RESUME_UPLOAD",
        resumeId,
        occuredAt: now,
      });
    });

    return NextResponse.json({
      ok: true,
      resume: {
        id: resumeId,
        userId: user.uid,
        userName: user.name,
        title,
        fileName,
        uploadedAt: now.toISOString(),
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

    const existing = await db.select().from(resumes).where(eq(resumes.resumeId, id)).limit(1);
    if (!existing.length) return NextResponse.json({ ok: true });
    const row = existing[0];
    if (row.userId !== user.id) throw new HttpError(403, "You can only delete your own resumes");

    await db.transaction(async (tx) => {
      await tx.delete(resumes).where(eq(resumes.resumeId, id));
      await logActivity(tx, {
        userId: user.id,
        type: "RESUME_DELETE",
        resumeId: id,
        occuredAt: new Date(),
      });
    });
    await deleteResume(row.filePath);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}