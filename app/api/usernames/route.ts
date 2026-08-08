import { NextResponse } from "next/server";
import { and, ne } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { resolveUserColor } from "@/lib/user-colors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// uid -> name/color resolution for the whole group.
//
// This MUST stay a server endpoint. The old Firestore-backed implementation
// had a regression where a client-side onSnapshot left uidNameMap empty and
// made every name in the feed and community views render as "Someone" (it was
// introduced twice — see commit 07d6514). Resolution lives on the server now;
// don't move it to a client listener.
export async function GET(req: Request) {
  try {
    await requireUser(req);

    // System and admin accounts aren't jobbing — keep them out of the
    // community roster so they never show on leaderboards or in the feed.
    const rows = await db
      .select()
      .from(users)
      .where(and(ne(users.isAdmin, true), ne(users.email, "system@jobless.local")));
    const uidToName: Record<string, string> = {};
    const userColors: Record<string, string> = {};

    rows.forEach((u) => {
      const name = u.name || "Someone";
      uidToName[u.id] = name;
      userColors[name] = resolveUserColor(u.id, name, u.userColor ?? undefined);
    });

    return NextResponse.json({ ok: true, uidToName, userColors });
  } catch (err) {
    const status = err instanceof HttpError ? err.statusCode : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Server error" },
      { status }
    );
  }
}