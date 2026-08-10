import { NextResponse } from "next/server";
import { and, ne, inArray } from "drizzle-orm";
import { db } from "@/db";
import { applications, applicationUserStatus, users } from "@/db/schema";
import { requireUser, HttpError } from "@/lib/auth-server";
import { getUserCommunityId, getCommunityMemberIds } from "@/lib/community";
import { enumToStatus, enumToRoleCategory } from "@/lib/enums";
import { classifyRole } from "@/lib/job-utils";
import { resolveUserColor } from "@/lib/user-colors";
import {
  STATUSES,
  FUNNEL_STAGES,
  reachedStage,
  reachedFlagsForStatus,
  type ReachedFlag,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rate = (part: number, total: number) =>
  total ? Math.round((part / total) * 100) : 0;

/** Format a Postgres `date` value back to YYYY-MM-DD (the shape Firestore
 *  stored / the client chart keys expect). Already-string dates pass through. */
function dateStr(d: string | Date | null): string {
  if (!d) return "";
  if (typeof d === "string") return d;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekMonday(dateStrIn: string): string {
  const d = new Date(dateStrIn + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req); // any signed-in user may view community stats
    const communityId = await getUserCommunityId(user.id, req);
    const memberIds = await getCommunityMemberIds(communityId);

    const [apps, statusLogs, userRows] = await Promise.all([
      memberIds.length
        ? db.select().from(applications).where(inArray(applications.applicantId, memberIds))
        : Promise.resolve([]),
      memberIds.length
        ? db.select().from(applicationUserStatus).where(inArray(applicationUserStatus.changedById, memberIds))
        : Promise.resolve([]),
      memberIds.length
        ? db
            .select({ id: users.id, name: users.name, userColor: users.userColor })
            .from(users)
            .where(and(ne(users.isAdmin, true), ne(users.email, "system@jobless.local"), inArray(users.id, memberIds)))
        : Promise.resolve([]),
    ]);

    // Build uid -> name and name -> color maps from users (replaces userProfiles)
    const uidToName = new Map<string, string>();
    const userColors: Record<string, string> = {};
    userRows.forEach((u) => {
      const name = u.name || "Someone";
      uidToName.set(u.id, name);
      userColors[name] = resolveUserColor(u.id, name, u.userColor ?? undefined);
    });

    // Never returns a raw UID — falls back to "Someone"
    const resolveName = (uid: string) => uidToName.get(uid) || "Someone";

    // Sticky funnel history per application, recovered from the status log
    // (replaces the reached* booleans Firestore stored on the doc).
    const history = new Map<string, Set<string>>();
    statusLogs.forEach((s) => {
      if (!history.has(s.applicationId)) history.set(s.applicationId, new Set());
      history.get(s.applicationId)!.add(s.status);
    });
    const flagsFor = (applicationId: string): Partial<Record<ReachedFlag, boolean>> => {
      const flags: Partial<Record<ReachedFlag, boolean>> = {};
      const seen = history.get(applicationId);
      if (seen) {
        for (const se of seen) {
          if (!se) continue;
          const disp = enumToStatus(se);
          if (disp) Object.assign(flags, reachedFlagsForStatus(disp));
        }
      }
      return flags;
    };

    const statusCounts: Record<string, number> = {};
    STATUSES.forEach((s) => (statusCounts[s] = 0));
    // funnelCounts = how many apps ever reached each funnel stage (sticky), so
    // an app that ended in Rejected still counts in every stage it passed
    // through (Applied / OA / Phone Screen / Interview / Offer).
    const funnelCounts: Record<string, number> = {};
    FUNNEL_STAGES.forEach((s) => (funnelCounts[s] = 0));
    const companyCounts: Record<string, number> = {};
    const monthly: Record<string, number> = {};
    const seenUsers = new Set<string>();

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

    apps.forEach((j) => {
      total++;
      if (j.applicantId) seenUsers.add(j.applicantId);

      const status = enumToStatus(j.status) || "Applied";
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      // Sticky funnel flags come from the status history, falling back to the
      // current status's rank so apps without a log still count.
      const job = { status, ...flagsFor(j.applicationId) } as { status: string } & Partial<Record<ReachedFlag, boolean>>;
      for (let i = 0; i < FUNNEL_STAGES.length; i++) {
        if (reachedStage(job, i)) funnelCounts[FUNNEL_STAGES[i]]++;
      }
      if (reachedStage(job, 1)) oAish++;            // ever got an OA
      if (reachedStage(job, 3)) interviewish++;      // ever reached Interview / Offer
      if (reachedStage(job, 4)) offers++;             // ever got an Offer
      // Responded = the company took an action (OA / screen / interview / offer,
      // or a rejection). History flags catch apps that later went to Ghosted /
      // Withdrawn after a real response; the explicit Rejected check catches
      // direct rejections.
      if (reachedStage(job, 1) || status === "Rejected") responded++;

      const company = j.company || "";
      const date = dateStr(j.appliedDate);
      const ownerUid = j.applicantId;
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
        const cat = (j.roleCategory ? enumToRoleCategory(j.roleCategory) : "") || classifyRole(j.role || "");
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

    const totalUsers = seenUsers.size;

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