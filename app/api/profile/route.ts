import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { resolveUserColor } from "@/lib/user-colors";
import { isSafeHttpUrl } from "@/lib/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// Trim + require http(s); empty allowed (field cleared). Throws on disallowed
// schemes so a `javascript:` URL can never be stored/rendered for anyone.
function safeProfileUrl(value: unknown): string {
  const s = String(value || "").trim();
  if (s && !isSafeHttpUrl(s)) {
    throw new HttpError(400, "URL must be a valid http(s) link");
  }
  return s;
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
    if (body.githubUrl !== undefined) updates.githubUrl = safeProfileUrl(body.githubUrl);
    if (body.linkedinUrl !== undefined) updates.linkedinUrl = safeProfileUrl(body.linkedinUrl);
    if (body.websiteUrl !== undefined) updates.websiteUrl = safeProfileUrl(body.websiteUrl);
    if (body.leetcodeRepoUrl !== undefined) {
      const url = safeProfileUrl(body.leetcodeRepoUrl);
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