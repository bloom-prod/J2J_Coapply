import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";
import { classifyRole } from "@/lib/job-utils";

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

const USER_COLORS = ["#E07BA0","#7BB87B","#78AEDE","#DDB060","#A87BD4","#5FC5C5","#E8895A"];
const NAME_COLOR_OVERRIDES: Record<string, string> = { "Shruti": "#FF69B4" };

const rate = (part: number, total: number) =>
  total ? Math.round((part / total) * 100) : 0;

function weekMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    await requireUser(req); // any signed-in user may view community stats

    const [appsSnap, profilesSnap] = await Promise.all([
      adminDb.collection("applications").get(),
      adminDb.collection("userProfiles").get(),
    ]);

    // Build uid -> name and name -> color maps from userProfiles
    const uidToName = new Map<string, string>();
    const userColors: Record<string, string> = {};
    profilesSnap.docs.forEach((doc, i) => {
      const data = doc.data();
      const name = (data.name as string) || "Someone";
      const color = NAME_COLOR_OVERRIDES[name] || (data.color as string) || USER_COLORS[i % USER_COLORS.length];
      uidToName.set(doc.id, name);
      userColors[name] = color;
    });

    // Never returns a raw UID — falls back to "Someone"
    const resolveName = (uid: string) => uidToName.get(uid) || "Someone";

    const statusCounts: Record<string, number> = {};
    STATUSES.forEach((s) => (statusCounts[s] = 0));
    const companyCounts: Record<string, number> = {};
    const monthly: Record<string, number> = {};
    const users = new Set<string>();

    let total = 0;
    let interviewish = 0;
    let offers = 0;
    let responded = 0;

    // Per-user chart data
    const todayW = new Date(); todayW.setHours(0, 0, 0, 0);
    const thisMon = weekMonday(todayW.toISOString().slice(0, 10));
    const weekKeys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(thisMon + "T00:00:00"); d.setDate(d.getDate() - i * 7);
      weekKeys.push(d.toISOString().slice(0, 10));
    }
    const weeklyByUser: Record<string, Record<string, number>> = {};
    const weeklyUserCounts: Record<string, number> = {};

    const roleCatByUser: Record<string, Record<string, number>> = {};
    const roleCatUserCounts: Record<string, number> = {};

    appsSnap.forEach((doc) => {
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

      // Per-user chart data (keyed by resolved display name, never UID)
      if (j.ownerUid) {
        const name = resolveName(j.ownerUid);

        // Weekly per-user (last 12 weeks)
        if (j.date) {
          const w = weekMonday(j.date);
          if (weekKeys.includes(w)) {
            if (!weeklyByUser[w]) weeklyByUser[w] = {};
            weeklyByUser[w][name] = (weeklyByUser[w][name] || 0) + 1;
            weeklyUserCounts[name] = (weeklyUserCounts[name] || 0) + 1;
          }
        }

        // Role category per-user
        const cat = j.roleCategory || classifyRole(j.role || "");
        if (cat) {
          if (!roleCatByUser[cat]) roleCatByUser[cat] = {};
          roleCatByUser[cat][name] = (roleCatByUser[cat][name] || 0) + 1;
          roleCatUserCounts[name] = (roleCatUserCounts[name] || 0) + 1;
        }
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

    // Top 10 users by weekly application volume
    const weeklyUsers = Object.entries(weeklyUserCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);

    const weeklyData = weekKeys.map((iso) => {
      const obj: Record<string, string | number> = { week: iso };
      weeklyUsers.forEach((name) => { obj[name] = weeklyByUser[iso]?.[name] || 0; });
      return obj;
    });

    // Top 10 users by role-category application volume
    const roleCatUsers = Object.entries(roleCatUserCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);

    const roleCatData = Object.entries(roleCatByUser)
      .sort((a, b) => Object.values(b[1]).reduce((s, n) => s + n, 0) - Object.values(a[1]).reduce((s, n) => s + n, 0))
      .slice(0, 8)
      .map(([cat, byUser]) => {
        const obj: Record<string, string | number> = { cat };
        roleCatUsers.forEach((name) => { obj[name] = byUser[name] || 0; });
        return obj;
      });

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
      uidToName: Object.fromEntries(uidToName),
      userColors,
      weeklyData,
      weeklyUsers,
      roleCatData,
      roleCatUsers,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.statusCode : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Server error" },
      { status }
    );
  }
}
