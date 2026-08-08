import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { resolveUserColor } from "@/lib/user-colors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    // The logged-in user's profile lives directly on the `users` row; they were
    // always seeded, so there is always a row to select.
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    const name = row?.name || user.name;
    return NextResponse.json({
      ok: true,
      profile: {
        uid: user.id,
        name,
        email: row?.email || user.email,
        // Same resolution as the charts/listeners use, so the Profile dialog
        // never shows a different color than the rest of the app.
        color: resolveUserColor(user.id, name, row?.userColor ?? undefined),
        githubUrl: row?.githubUrl || "",
        linkedinUrl: row?.linkedinUrl || "",
        websiteUrl: row?.websiteUrl || "",
        leetcodeRepoUrl: row?.leetcodeRepoUrl || "",
        leetcodeLastSyncedAt: row?.leetcodeLastSyncedAt ? row.leetcodeLastSyncedAt.toISOString() : "",
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name || "").trim();
      if (!name) throw new HttpError(400, "Name cannot be empty");
      updates.name = name;
    }
    if (body.githubUrl !== undefined) updates.githubUrl = String(body.githubUrl || "").trim();
    if (body.linkedinUrl !== undefined) updates.linkedinUrl = String(body.linkedinUrl || "").trim();
    if (body.websiteUrl !== undefined) updates.websiteUrl = String(body.websiteUrl || "").trim();
    if (body.leetcodeRepoUrl !== undefined) {
      const url = String(body.leetcodeRepoUrl || "").trim();
      if (url && !isValidUrl(url)) {
        throw new HttpError(400, "Invalid LeetCode repo URL");
      }
      updates.leetcodeRepoUrl = url;
      if (url) updates.leetcodeLastSyncedAt = null; // Reset sync time when connecting
    }
    if (Object.keys(updates).length === 0) {
      throw new HttpError(400, "No fields to update");
    }

    await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}