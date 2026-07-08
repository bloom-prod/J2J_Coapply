import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { adminAuth } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    await requireUser(req);

    // Get all problems from root collection
    const problemsSnap = await adminDb.collection("leetcodeProblems").get();
    
    // Get all userProfiles for name resolution
    const profilesSnap = await adminDb.collection("userProfiles").get();
    const uidToName = new Map<string, string>();
    profilesSnap.docs.forEach((doc) => {
      uidToName.set(doc.id, doc.data().name || "Someone");
    });

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

    problemsSnap.forEach((doc) => {
      const p = doc.data() as Record<string, unknown>;
      const uid = (p.userId as string) || "";
      const userName = (p.userName as string) || uidToName.get(uid) || "Someone";

      totalSolved++;
      
      // Count per user
      if (!userCounts[uid]) {
        userCounts[uid] = { name: userName, count: 0 };
      }
      userCounts[uid].count++;

      // Language counts
      if (typeof p.language === "string") {
        languageCounts[p.language] = (languageCounts[p.language] || 0) + 1;
      }
      
      // Difficulty counts
      if (typeof p.difficulty === "string") {
        difficultyCounts[p.difficulty] = (difficultyCounts[p.difficulty] || 0) + 1;
      }
      
      // Weekly volume
      if (typeof p.solvedAt === "string") {
        const w = weekMonday(p.solvedAt.slice(0, 10));
        weekly[w] = (weekly[w] || 0) + 1;
        if (!weeklyByUser[w]) weeklyByUser[w] = {};
        weeklyByUser[w][userName] = (weeklyByUser[w][userName] || 0) + 1;

        // Collect for activity feed
        recentActivity.push({
          userName,
          problemId: (p.problemId as string) || doc.id,
          title: (p.title as string) || "Unknown Problem",
          difficulty: (p.difficulty as string) || "unknown",
          language: p.language as string,
          solvedAt: p.solvedAt as string,
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
