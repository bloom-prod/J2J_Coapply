import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { getResumeBuffer } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// Returns the resume PDF as base64 (fetched from MinIO/S3) for PDF viewing.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser(req);
    const row = await db.query.resumes.findFirst({ where: eq(resumes.resumeId, params.id) });
    if (!row) throw new HttpError(404, "Resume not found");

    const buf = await getResumeBuffer(row.filePath);
    return NextResponse.json({
      ok: true,
      fileBase64: buf ? buf.toString("base64") : "",
      fileName: row.fileName || "resume.pdf",
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}