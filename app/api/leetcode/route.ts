import { NextResponse } from "next/server";
import { and, eq, ne, inArray } from "drizzle-orm";
import { db } from "@/db";
import { lcProblems, lcSolvedUser, users } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { getUserCommunityId, getCommunityMemberIds } from "@/lib/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIFF_ENUM_TO_RAW: Record<string, string> = {
  EASY: "easy",
  MEDIUM: "medium",
  HARD: "hard",
  UNKNOWN: "unknown",
};

function weekMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const communityId = await getUserCommunityId(user.id, req);
    const memberIds = await getCommunityMemberIds(communityId);

    if (!memberIds.length) {
      return NextResponse.json({
        ok: true,
        totalUsers: 0,
        totalSolved: 0,
        avgPerUser: 0,
        languageCounts: {},
        difficultyCounts: {},
        weeklyVolume: [],
        weeklyData: [],
        weeklyUsers: [],
        userLeaderboard: [],
        recentActivity: [],
      });
    }

    // Get all solves (metadata via lcProblems, names via users)
    const rows = await db
      .select({
        uid: lcSolvedUser.userId,
        problemId: lcSolvedUser.problemId,
        language: lcSolvedUser.languageUsed,
        solvedAt: lcSolvedUser.solvedAt,
        userName: users.name,
        title: lcProblems.problemName,
        difficulty: lcProblems.problemDifficulty,
      })
      .from(lcSolvedUser)
      .leftJoin(lcProblems, eq(lcSolvedUser.problemId, lcProblems.problemId))
      .leftJoin(users, eq(lcSolvedUser.userId, users.id))
      // System / admin accounts aren't jobbing — keep them off the leaderboard.
      .where(and(ne(users.isAdmin, true), ne(users.email, "system@jobless.local"), inArray(lcSolvedUser.userId, memberIds)));

    const languageCounts: Record<string, number> = {};
    const difficultyCounts: Record<string, number> = {};
    const weekly: Record<string, number> = {};
    const weeklyByUser: Record<string, Record<string, number>> = {};
    const userCounts: Record<string, { name: string; count: number }> = {};
    const recentActivity: Array<{
      userName: string;
      problemId: string;
      title: string;
      difficulty: string;
      language: string;
      solvedAt: string;
    }> = [];
    let totalSolved = 0;

    rows.forEach((r) => {
      const uid = r.uid || "";
      const userName = r.userName || "Someone";
      const difficulty =
        r.difficulty && DIFF_ENUM_TO_RAW[r.difficulty] ? DIFF_ENUM_TO_RAW[r.difficulty] : "unknown";

      totalSolved++;

      // Count per user
      if (!userCounts[uid]) {
        userCounts[uid] = { name: userName, count: 0 };
      }
      userCounts[uid].count++;

      // Language counts
      if (typeof r.language === "string") {
        languageCounts[r.language] = (languageCounts[r.language] || 0) + 1;
      }

      // Difficulty counts (report original lowercase values)
      if (typeof difficulty === "string") {
        difficultyCounts[difficulty] = (difficultyCounts[difficulty] || 0) + 1;
      }

      // Weekly volume
      if (r.solvedAt) {
        const w = weekMonday(r.solvedAt.toISOString().slice(0, 10));
        weekly[w] = (weekly[w] || 0) + 1;
        if (!weeklyByUser[w]) weeklyByUser[w] = {};
        weeklyByUser[w][userName] = (weeklyByUser[w][userName] || 0) + 1;

        // Collect for activity feed
        recentActivity.push({
          userName,
          problemId: r.problemId || "",
          title: r.title || "Unknown Problem",
          difficulty,
          language: r.language || "",
          solvedAt: r.solvedAt.toISOString(),
        });
      }
    });

    const totalUsers = Object.keys(userCounts).length;
    const weeklyVolume = Object.entries(weekly)
      .sort((a, b) => (a[0] > b[0] ? 1 : -1))
      .map(([week, count]) => ({ week, count }));

    const userLeaderboard = Object.values(userCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Get unique user names from leaderboard for weekly breakdown
    const weeklyUsers = userLeaderboard.map((u) => u.name);
    const weeklyData = Object.entries(weeklyByUser)
      .sort((a, b) => (a[0] > b[0] ? 1 : -1))
      .map(([week, byUser]) => {
        const obj: Record<string, string | number> = { week };
        weeklyUsers.forEach((name) => { obj[name] = byUser[name] || 0; });
        return obj;
      });

    // Sort activity by solved date, newest first, take last 20
    const sortedActivity = recentActivity
      .sort((a, b) => new Date(b.solvedAt).getTime() - new Date(a.solvedAt).getTime())
      .slice(0, 20);

    return NextResponse.json({
      ok: true,
      totalUsers,
      totalSolved,
      avgPerUser: totalUsers ? Math.round((totalSolved / totalUsers) * 10) / 10 : 0,
      languageCounts,
      difficultyCounts,
      weeklyVolume,
      weeklyData,
      weeklyUsers,
      userLeaderboard,
      recentActivity: sortedActivity,
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}