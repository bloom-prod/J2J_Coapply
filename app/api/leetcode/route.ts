import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
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

    const difficultyCounts = { easy: 0, medium: 0, hard: 0 };
    const languageCounts: Record<string, number> = {};
    const weekly: Record<string, number> = {};
    const users = new Set<string>();
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

      problemsSnap.forEach((doc) => {
        const p = doc.data() as Record<string, string>;
        totalSolved++;
        if (p.difficulty) {
          const d = p.difficulty.toLowerCase();
          if (d === "easy") difficultyCounts.easy++;
          else if (d === "medium") difficultyCounts.medium++;
          else if (d === "hard") difficultyCounts.hard++;
        }
        if (p.language) {
          languageCounts[p.language] = (languageCounts[p.language] || 0) + 1;
        }
        if (p.solvedAt) {
          const w = weekMonday(p.solvedAt.slice(0, 10));
          weekly[w] = (weekly[w] || 0) + 1;
        }
      });
    }

    const totalUsers = users.size;
    const weeklyVolume = Object.entries(weekly)
      .sort((a, b) => (a[0] > b[0] ? 1 : -1))
      .slice(-12)
      .map(([week, count]) => ({ week, count }));

    return NextResponse.json({
      ok: true,
      totalUsers,
      totalSolved,
      avgPerUser: totalUsers ? Math.round((totalSolved / totalUsers) * 10) / 10 : 0,
      difficultyCounts,
      languageCounts,
      weeklyVolume,
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
