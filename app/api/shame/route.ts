import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";
import { generateRoasts, generateSingleRoast } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "America/New_York";

/** Get the EST/EDT UTC offset in ms by comparing a known UTC time to its local representation. */
function getEasternOffsetMs(refDate: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(refDate);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const localMs = new Date(
    `${g("year")}-${g("month")}-${g("day")}T${String(parseInt(g("hour"))).padStart(2, "0")}:${g("minute")}:00Z`
  ).getTime();
  return localMs - refDate.getTime(); // negative for US Eastern (UTC-5 or UTC-4)
}

/**
 * Returns the effective "today" date (YYYY-MM-DD) in EST and the 6AM-to-6AM
 * UTC time range for querying applications.
 *
 * Day runs from 6 AM EST to 6 AM EST the next day.
 * If current time is before 6 AM EST, it counts as the previous day.
 */
function effectiveToday(): { dateStr: string; dayStart: Date; dayEnd: Date } {
  const now = new Date();
  const offsetMs = getEasternOffsetMs(now);

  // Get current date & hour in Eastern time
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", hour12: false,
  }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const hour = parseInt(g("hour"), 10);
  let dateStr = `${g("year")}-${g("month")}-${g("day")}`;

  if (hour < 6) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() - 1);
    dateStr = d.toISOString().slice(0, 10);
  }

  // 6 AM Eastern on dateStr → convert to UTC: 6AM_local_as_UTC - offset
  // offset is (local - UTC), so UTC = local - offset → UTC = 06:00_as_UTC - offset
  const dayStart = new Date(`${dateStr}T06:00:00Z`);
  dayStart.setTime(dayStart.getTime() - offsetMs);

  const nextDay = new Date(dateStr + "T00:00:00");
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDateStr = nextDay.toISOString().slice(0, 10);
  const dayEnd = new Date(`${nextDateStr}T06:00:00Z`);
  dayEnd.setTime(dayEnd.getTime() - offsetMs);

  return { dateStr, dayStart, dayEnd };
}

export interface ShameEntry {
  uid: string;
  name: string;
  appsToday: number;
  roast: string;
}

export async function GET(req: Request) {
  try {
    await requireUser(req);

    const url = new URL(req.url);
    const forceRegen = url.searchParams.get("force") === "1";
    const { dateStr: today, dayStart, dayEnd } = effectiveToday();
    console.log("[shame] effectiveToday:", today, "| force:", forceRegen);
    console.log("[shame] dayStart:", dayStart.toISOString(), "| dayEnd:", dayEnd.toISOString());

    let appsSnap, profilesSnap;
    try {
      [appsSnap, profilesSnap] = await Promise.all([
        adminDb
          .collection("applications")
          .where("createdAt", ">=", dayStart)
          .where("createdAt", "<", dayEnd)
          .get(),
        adminDb.collection("userProfiles").get(),
      ]);
      console.log("[shame] Firestore query OK — apps:", appsSnap.size, "| profiles:", profilesSnap.size);
    } catch (dbErr) {
      console.error("[shame] Firestore query FAILED:", dbErr);
      throw dbErr;
    }

    // Count applications per user for today
    const countsByUid: Record<string, number> = {};
    appsSnap.forEach((doc) => {
      const uid = doc.data().ownerUid as string;
      if (uid) countsByUid[uid] = (countsByUid[uid] || 0) + 1;
    });
    console.log("[shame] countsByUid:", JSON.stringify(countsByUid));

    // Build user list from profiles
    const users: { uid: string; name: string }[] = [];
    profilesSnap.forEach((doc) => {
      const data = doc.data();
      users.push({ uid: doc.id, name: (data.name as string) || "Someone" });
    });
    console.log("[shame] users:", users.map((u) => `${u.name} (${u.uid})`).join(", "));

    // Check Firestore cache for today's roasts
    const cacheRef = adminDb.collection("dailyRoasts").doc(today);
    const cacheDoc = await cacheRef.get();
    const cached = cacheDoc.exists ? (cacheDoc.data() as Record<string, string>) : null;
    console.log("[shame] cache exists:", !!cached, "| forceRegen:", forceRegen);

    // Parse cached per-user counts for milestone detection
    const cachedCountMap: Record<string, number> = {};
    if (cached?._countMap) {
      try { Object.assign(cachedCountMap, JSON.parse(cached._countMap)); } catch { /* ignore */ }
    }
    console.log("[shame] cachedCountMap:", JSON.stringify(cachedCountMap));

    const MILESTONES = [5, 10];

    let roastMap: Record<string, string>;
    if (!cached || forceRegen) {
      console.log("[shame] Generating fresh roasts for all users...");
      const userApps = users.map((u) => ({
        name: u.name,
        appsToday: countsByUid[u.uid] || 0,
      }));
      roastMap = await generateRoasts(userApps);
      console.log("[shame] Generated roasts for:", Object.keys(roastMap).join(", "));
    } else {
      roastMap = { ...cached };

      for (const u of users) {
        const count = countsByUid[u.uid] || 0;
        const prev = cachedCountMap[u.uid] || 0;
        const crossedMilestone = MILESTONES.some((m) => count >= m && prev < m);
        if (crossedMilestone) {
          console.log(`[shame] Milestone crossed for ${u.name}: ${prev} -> ${count}`);
          const newRoast = await generateSingleRoast(u.name, count);
          roastMap[u.name] = newRoast;
        }
      }
      console.log("[shame] Using cached roasts");
    }

    // Always update cache with current counts
    const countMap = JSON.stringify(
      Object.fromEntries(users.map((u) => [u.uid, countsByUid[u.uid] || 0]))
    );
    try {
      await cacheRef.set({ ...roastMap, _countMap: countMap });
      console.log("[shame] Cache updated");
    } catch (cacheErr) {
      console.error("[shame] Cache write FAILED:", cacheErr);
    }

    const entries: ShameEntry[] = users.map((u) => {
      const appsToday = countsByUid[u.uid] || 0;
      return { uid: u.uid, name: u.name, appsToday, roast: roastMap[u.name] || "" };
    });

    // Sort: 0 apps first (most shameful), then ascending
    entries.sort((a, b) => a.appsToday - b.appsToday);

    const totalAppsToday = entries.reduce((s, e) => s + e.appsToday, 0);

    console.log("[shame] Returning", entries.length, "entries | totalAppsToday:", totalAppsToday);
    return NextResponse.json({ ok: true, date: today, totalAppsToday, entries });
  } catch (err) {
    console.error("[shame] ROUTE ERROR:", err);
    const status = err instanceof HttpError ? err.statusCode : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Server error" },
      { status }
    );
  }
}
