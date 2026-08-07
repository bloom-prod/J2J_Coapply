import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";
import { classifyRole } from "@/lib/job-utils";
import { resolveUserColor } from "@/lib/user-colors";
import {
  STATUSES,
  FUNNEL_STAGES,
  REACHED_FLAG_KEYS,
  reachedStage,
  type ReachedFlag,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rate = (part: number, total: number) =>
  total ? Math.round((part / total) * 100) : 0;

/** Pull the sticky reached* booleans off a raw doc, ignoring anything that
 *  isn't literally `true` (legacy docs may store them as strings or omit them). */
function pickReachedFlags(doc: Record<string, unknown>): Partial<Record<ReachedFlag, boolean>> {
  const out: Partial<Record<ReachedFlag, boolean>> = {};
  for (const k of REACHED_FLAG_KEYS) {
    if (doc[k] === true) out[k] = true;
  }
  return out;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

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
    profilesSnap.docs.forEach((doc) => {
      const data = doc.data();
      const name = (data.name as string) || "Someone";
      const color = resolveUserColor(doc.id, name, data.color as string | undefined);
      uidToName.set(doc.id, name);
      userColors[name] = color;
    });

    // Never returns a raw UID — falls back to "Someone"
    const resolveName = (uid: string) => uidToName.get(uid) || "Someone";

    const statusCounts: Record<string, number> = {};
    STATUSES.forEach((s) => (statusCounts[s] = 0));
    // funnelCounts = how many apps ever reached each funnel stage (sticky), so
    // an app that ended in Rejected still counts in every stage it passed
    // through (Applied / OA / Phone Screen / Interview / Offer).
    const funnelCounts: Record<string, number> = {};
    FUNNEL_STAGES.forEach((s) => (funnelCounts[s] = 0));
    const companyCounts: Record<string, number> = {};
    const monthly: Record<string, number> = {};
    const users = new Set<string>();

    let total = 0;
    let oAish = 0;
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
      const j = doc.data() as Record<string, unknown>;
      total++;
      if (j.ownerUid) users.add(j.ownerUid as string);

      const status = (j.status as string) || "Applied";
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      // Sticky funnel flags live on the doc (reachedApplied / reachedOA / ...).
      // reachedStage honors the flag, then falls back to the current status's
      // rank so legacy docs without flags still count.
      const job = { status, ...pickReachedFlags(j) } as { status: string } & Partial<Record<ReachedFlag, boolean>>;
      for (let i = 0; i < FUNNEL_STAGES.length; i++) {
        if (reachedStage(job, i)) funnelCounts[FUNNEL_STAGES[i]]++;
      }
      if (reachedStage(job, 1)) oAish++;            // ever got an OA
      if (reachedStage(job, 3)) interviewish++;      // ever reached Interview / Offer
      if (reachedStage(job, 4)) offers++;             // ever got an Offer
      // Responded = the company took an action (OA / screen / interview / offer,
      // or a rejection). Sticky flags catch apps that later went to Ghosted /
      // Withdrawn after a real response; the explicit Rejected check catches
      // direct rejections that never set a flag.
      if (reachedStage(job, 1) || status === "Rejected") responded++;

      const company = str(j.company);
      const date = str(j.date);
      const ownerUid = str(j.ownerUid);
      if (company) companyCounts[company] = (companyCounts[company] || 0) + 1;
      if (date) {
        const m = date.slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(m)) monthly[m] = (monthly[m] || 0) + 1;
      }

      // Per-user chart data (keyed by resolved display name, never UID)
      if (ownerUid) {
        const name = resolveName(ownerUid);

        // Weekly per-user (last 12 weeks)
        if (date) {
          const w = weekMonday(date);
          if (weekKeys.includes(w)) {
            if (!weeklyByUser[w]) weeklyByUser[w] = {};
            weeklyByUser[w][name] = (weeklyByUser[w][name] || 0) + 1;
            weeklyUserCounts[name] = (weeklyUserCounts[name] || 0) + 1;
          }
        }

        // Role category per-user
        const cat = str(j.roleCategory) || classifyRole(str(j.role));
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
      oaRate: rate(oAish, total),
      statusCounts,
      funnelCounts,
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
