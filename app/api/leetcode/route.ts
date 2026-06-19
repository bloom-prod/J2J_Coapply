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

    const profiles = await adminDb.collection("userProfiles").get();

    const languageCounts: Record<string, number> = {};
    const weekly: Record<string, number> = {};
    const users = new Set<string>();
    const userCounts: Record<string, { name: string; count: number }> = {};
    let totalSolved = 0;

    for (const profile of profiles.docs) {
      const uid = profile.id;
      const profileData = profile.data() as { name?: string; leetcodeRepoUrl?: string };
      if (profileData.leetcodeRepoUrl) users.add(uid);

      const problemsSnap = await adminDb
        .collection("userProfiles")
        .doc(uid)
        .collection("leetcodeProblems")
        .get();

      let userCount = 0;
      
      // Get name from profile, or fallback to Firebase Auth displayName, or "Someone"
      let userName = profileData.name;
      if (!userName) {
        try {
          const userRecord = await adminAuth.getUser(uid);
          userName = userRecord.displayName || userRecord.email || "Someone";
        } catch {
          userName = "Someone";
        }
      }

      problemsSnap.forEach((doc) => {
        const p = doc.data() as Record<string, unknown>;
        totalSolved++;
        userCount++;
        if (typeof p.language === "string") {
          languageCounts[p.language] = (languageCounts[p.language] || 0) + 1;
        }
        if (typeof p.solvedAt === "string") {
          const w = weekMonday(p.solvedAt.slice(0, 10));
          weekly[w] = (weekly[w] || 0) + 1;
        }
      });

      if (userCount > 0) {
        userCounts[uid] = { name: userName, count: userCount };
      }
    }

    const totalUsers = users.size;
    const weeklyVolume = Object.entries(weekly)
      .sort((a, b) => (a[0] > b[0] ? 1 : -1))
      .map(([week, count]) => ({ week, count }));

    const userLeaderboard = Object.values(userCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return NextResponse.json({
      ok: true,
      totalUsers,
      totalSolved,
      avgPerUser: totalUsers ? Math.round((totalSolved / totalUsers) * 10) / 10 : 0,
      languageCounts,
      weeklyVolume,
      userLeaderboard,
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
