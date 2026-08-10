import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communityMembers } from "@/db/schema";
import { HttpError } from "@/lib/auth-server";

/**
 * Returns the communityId for a user.
 * If the request carries an X-Community-Id header AND the user is a member of
 * that community, that community is returned. Otherwise falls back to the
 * user's first community membership. Throws 403 if they have none.
 */
export async function getUserCommunityId(userId: string, req?: Request): Promise<string> {
  const headerCommunityId = req?.headers.get("X-Community-Id") || null;

  if (headerCommunityId) {
    // Verify the user is actually a member of the requested community
    const [membership] = await db
      .select({ communityId: communityMembers.communityId })
      .from(communityMembers)
      .where(and(
        eq(communityMembers.userId, userId),
        eq(communityMembers.communityId, headerCommunityId)
      ))
      .limit(1);
    if (membership) return membership.communityId;
  }

  // Fall back to first community
  const [membership] = await db
    .select({ communityId: communityMembers.communityId })
    .from(communityMembers)
    .where(eq(communityMembers.userId, userId))
    .limit(1);

  if (!membership) throw new HttpError(403, "You are not a member of any community");
  return membership.communityId;
}

/**
 * Returns all user IDs that are members of a given community.
 */
export async function getCommunityMemberIds(communityId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: communityMembers.userId })
    .from(communityMembers)
    .where(eq(communityMembers.communityId, communityId));
  return rows.map((r) => r.userId);
}
