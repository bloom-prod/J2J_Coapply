import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, communityMembers } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { namesByIds } from "@/db/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function randomCode(len = 8): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// GET /api/communities — list communities the current user belongs to
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);

    const memberships = await db
      .select({
        communityId: communityMembers.communityId,
        role: communityMembers.role,
        joinedAt: communityMembers.joinedAt,
      })
      .from(communityMembers)
      .where(eq(communityMembers.userId, user.id));

    if (!memberships.length) {
      return NextResponse.json({ ok: true, communities: [] });
    }

    const communityIds = memberships.map((m) => m.communityId);
    const roleMap = Object.fromEntries(memberships.map((m) => [m.communityId, m.role]));

    const rows = await Promise.all(
      communityIds.map((id) =>
        db.query.communities.findFirst({ where: eq(communities.communityId, id) })
      )
    );

    const result = rows
      .filter(Boolean)
      .map((c) => ({
        id: c!.communityId,
        name: c!.name,
        inviteCode: c!.inviteCode,
        role: roleMap[c!.communityId] || "member",
        createdAt: c!.createdAt?.toISOString() ?? "",
      }));

    return NextResponse.json({ ok: true, communities: result });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

// POST /api/communities — create a new community
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!name) throw new HttpError(400, "Community name is required");

    const now = new Date();
    let inviteCode = randomCode();

    // Retry on the rare collision
    for (let i = 0; i < 5; i++) {
      const existing = await db.query.communities.findFirst({
        where: eq(communities.inviteCode, inviteCode),
      });
      if (!existing) break;
      inviteCode = randomCode();
    }

    const community = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(communities)
        .values({ name, inviteCode, createdBy: user.id, createdAt: now, updatedAt: now })
        .returning();

      await tx.insert(communityMembers).values({
        communityId: c.communityId,
        userId: user.id,
        role: "owner",
        joinedAt: now,
      });

      return c;
    });

    return NextResponse.json({
      ok: true,
      community: {
        id: community.communityId,
        name: community.name,
        inviteCode: community.inviteCode,
        role: "owner",
        createdAt: community.createdAt?.toISOString() ?? "",
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
