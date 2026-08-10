import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, communityMembers } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// POST /api/communities/join — join a community by invite code
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const code = String(body.code || "").trim().toLowerCase();
    if (!code) throw new HttpError(400, "Invite code is required");

    const community = await db.query.communities.findFirst({
      where: eq(communities.inviteCode, code),
    });
    if (!community) throw new HttpError(404, "Invalid invite code");

    // Check if already a member
    const existing = await db.query.communityMembers.findFirst({
      where: and(
        eq(communityMembers.communityId, community.communityId),
        eq(communityMembers.userId, user.id)
      ),
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        community: { id: community.communityId, name: community.name, role: existing.role },
        alreadyMember: true,
      });
    }

    await db.insert(communityMembers).values({
      communityId: community.communityId,
      userId: user.id,
      role: "member",
      joinedAt: new Date(),
    });

    return NextResponse.json({
      ok: true,
      community: { id: community.communityId, name: community.name, role: "member" },
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
