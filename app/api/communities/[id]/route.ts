import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, communityMembers, users } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { namesByIds } from "@/db/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// GET /api/communities/[id] — get community details + members
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);

    const membership = await db.query.communityMembers.findFirst({
      where: and(
        eq(communityMembers.communityId, params.id),
        eq(communityMembers.userId, user.id)
      ),
    });
    if (!membership) throw new HttpError(403, "Not a member of this community");

    const community = await db.query.communities.findFirst({
      where: eq(communities.communityId, params.id),
    });
    if (!community) throw new HttpError(404, "Community not found");

    const memberRows = await db
      .select({ userId: communityMembers.userId, role: communityMembers.role, joinedAt: communityMembers.joinedAt })
      .from(communityMembers)
      .where(eq(communityMembers.communityId, params.id));

    const nameById = await namesByIds(db, memberRows.map((m) => m.userId));

    const members = memberRows.map((m) => ({
      userId: m.userId,
      name: nameById[m.userId] || "Someone",
      role: m.role,
      joinedAt: m.joinedAt?.toISOString() ?? "",
    }));

    return NextResponse.json({
      ok: true,
      community: {
        id: community.communityId,
        name: community.name,
        inviteCode: community.inviteCode,
        createdAt: community.createdAt?.toISOString() ?? "",
        myRole: membership.role,
        members,
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

// PUT /api/communities/[id] — rename community (owner only)
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);

    const membership = await db.query.communityMembers.findFirst({
      where: and(
        eq(communityMembers.communityId, params.id),
        eq(communityMembers.userId, user.id)
      ),
    });
    if (!membership) throw new HttpError(403, "Not a member of this community");
    if (membership.role !== "owner") throw new HttpError(403, "Only the owner can rename this community");

    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!name) throw new HttpError(400, "Name is required");

    await db
      .update(communities)
      .set({ name, updatedAt: new Date() })
      .where(eq(communities.communityId, params.id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
