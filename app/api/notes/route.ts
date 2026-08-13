import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userNotes } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generous but bounded — this is a scratchpad, not a document store. Keeps a
// runaway paste (or a scripted client) from writing an unbounded row.
const MAX_LENGTH = 100_000;

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// The user's private scratchpad. Deliberately not community-scoped: there is
// exactly one row per user and it is never exposed to anyone else, so no
// X-Community-Id handling here.
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const [row] = await db.select().from(userNotes).where(eq(userNotes.userId, user.id));
    // No row yet just means "never written" — that is an empty scratchpad, not
    // an error, so we don't insert one until the user actually saves.
    return NextResponse.json({
      ok: true,
      notes: {
        content: row?.content ?? "",
        updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : "",
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

    if (body.content === undefined) throw new HttpError(400, "content is required");
    if (typeof body.content !== "string") throw new HttpError(400, "content must be a string");
    if (body.content.length > MAX_LENGTH) {
      throw new HttpError(400, `Notes are limited to ${MAX_LENGTH.toLocaleString()} characters`);
    }

    const updatedAt = new Date();
    const [row] = await db
      .insert(userNotes)
      .values({ userId: user.id, content: body.content, updatedAt })
      .onConflictDoUpdate({
        target: userNotes.userId,
        set: { content: body.content, updatedAt },
      })
      .returning();

    return NextResponse.json({
      ok: true,
      notes: {
        content: row.content,
        updatedAt: row.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
