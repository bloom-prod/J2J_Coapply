import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = [
  "Want to Apply",
  "Applied",
  "Phone Screen",
  "Interview",
  "Offer",
  "Rejected",
  "Ghosted",
  "Withdrawn",
];

const rate = (part: number, total: number) =>
  total ? Math.round((part / total) * 100) : 0;

export async function GET(req: Request) {
  try {
    await requireUser(req); // any signed-in user may view community stats

    const snap = await adminDb.collection("applications").get();

    const statusCounts: Record<string, number> = {};
    STATUSES.forEach((s) => (statusCounts[s] = 0));
    const companyCounts: Record<string, number> = {};
    const monthly: Record<string, number> = {};
    const users = new Set<string>();

    let total = 0;
    let interviewish = 0;
    let offers = 0;
    let responded = 0;

    snap.forEach((doc) => {
      const j = doc.data() as Record<string, string>;
      total++;
      if (j.ownerUid) users.add(j.ownerUid);

      const status = j.status || "Applied";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      if (status === "Interview" || status === "Offer") interviewish++;
      if (status === "Offer") offers++;
      // Exclude "Want to Apply" from response calculation since it's pre-application
      if (status !== "Want to Apply" && status !== "Applied" && status !== "Ghosted") responded++;

      if (j.company) companyCounts[j.company] = (companyCounts[j.company] || 0) + 1;
      if (j.date) {
        const m = String(j.date).slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(m)) monthly[m] = (monthly[m] || 0) + 1;
      }
    });

    const topCompanies = Object.entries(companyCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    const monthlyVolume = Object.entries(monthly)
      .sort((a, b) => (a[0] > b[0] ? 1 : -1))
      .map(([month, count]) => ({ month, count }));

    const totalUsers = users.size;

    return NextResponse.json({
      ok: true,
      totalApps: total,
      totalUsers,
      avgPerUser: totalUsers ? Math.round((total / totalUsers) * 10) / 10 : 0,
      interviewRate: rate(interviewish, total),
      offerRate: rate(offers, total),
      responseRate: rate(responded, total),
      statusCounts,
      topCompanies,
      monthlyVolume,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.statusCode : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Server error" },
      { status }
    );
  }
}
