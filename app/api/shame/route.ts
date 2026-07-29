import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";
import { generateRoasts, generateSingleRoast } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the local date string (YYYY-MM-DD) in the given timezone,
 * with a 6 AM cutoff (before 6 AM counts as the previous day).
 * Also returns the start-of-day timestamp for querying.
 */
function effectiveToday(tz: string): { dateStr: string; dayStart: Date; dayEnd: Date } {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);

    const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
    const hour = parseInt(get("hour"), 10);
    let dateStr = `${get("year")}-${get("month")}-${get("day")}`;

    if (hour < 6) {
      // Before 6 AM — roll back to yesterday
      const d = new Date(dateStr + "T00:00:00");
      d.setDate(d.getDate() - 1);
      dateStr = d.toISOString().slice(0, 10);
    }

    // Compute day boundaries: 6 AM on dateStr to 6 AM the next day (in the user's tz)
    // We approximate by computing the offset from UTC for this timezone
    const refParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "numeric", minute: "numeric", hour12: false,
    }).formatToParts(new Date(`${dateStr}T12:00:00Z`));
    const refGet = (t: string) => refParts.find((p) => p.type === t)?.value || "";
    const refLocalDate = `${refGet("year")}-${refGet("month")}-${refGet("day")}`;
    const refLocalHour = parseInt(refGet("hour"), 10);
    const refLocalMin = parseInt(refGet("minute"), 10);
    // offset = local - UTC (in ms)
    const refUTC = new Date(`${dateStr}T12:00:00Z`).getTime();
    const refLocalMs = new Date(`${refLocalDate}T${String(refLocalHour).padStart(2, "0")}:${String(refLocalMin).padStart(2, "0")}:00Z`).getTime();
    const offsetMs = refLocalMs - refUTC;

    // dayStart = 6 AM local on dateStr = dateStr T06:00 local = dateStr T06:00 - offset in UTC
    const dayStart = new Date(`${dateStr}T06:00:00Z`);
    dayStart.setTime(dayStart.getTime() - offsetMs);

    // dayEnd = 6 AM local the next day
    const nextDay = new Date(dateStr + "T00:00:00");
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDateStr = nextDay.toISOString().slice(0, 10);
    const dayEnd = new Date(`${nextDateStr}T06:00:00Z`);
    dayEnd.setTime(dayEnd.getTime() - offsetMs);

    return { dateStr, dayStart, dayEnd };
  } catch {
    const dateStr = new Date().toISOString().slice(0, 10);
    return {
      dateStr,
      dayStart: new Date(`${dateStr}T00:00:00Z`),
      dayEnd: new Date(`${dateStr}T23:59:59Z`),
    };
  }
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
    const tz = url.searchParams.get("tz") || "America/New_York";
    const forceRegen = url.searchParams.get("force") === "1";
    const { dateStr: today, dayStart, dayEnd } = effectiveToday(tz);

    const [appsSnap, profilesSnap] = await Promise.all([
      adminDb
        .collection("applications")
        .where("createdAt", ">=", dayStart)
        .where("createdAt", "<", dayEnd)
        .get(),
      adminDb.collection("userProfiles").get(),
    ]);

    // Count applications per user for today
    const countsByUid: Record<string, number> = {};
    appsSnap.forEach((doc) => {
      const uid = doc.data().ownerUid as string;
      if (uid) countsByUid[uid] = (countsByUid[uid] || 0) + 1;
    });

    // Build user list from profiles
    const users: { uid: string; name: string }[] = [];
    profilesSnap.forEach((doc) => {
      const data = doc.data();
      users.push({ uid: doc.id, name: (data.name as string) || "Someone" });
    });

    // Check Firestore cache for today's roasts
    const cacheRef = adminDb.collection("dailyRoasts").doc(today);
    const cacheDoc = await cacheRef.get();
    const cached = cacheDoc.exists ? (cacheDoc.data() as Record<string, string>) : null;

    // Parse cached per-user counts for milestone detection
    const cachedCountMap: Record<string, number> = {};
    if (cached?._countMap) {
      try { Object.assign(cachedCountMap, JSON.parse(cached._countMap)); } catch { /* ignore */ }
    }

    const MILESTONES = [5, 10];

    let roastMap: Record<string, string>;
    if (!cached || forceRegen) {
      // No cache or force refresh — generate fresh roasts for everyone
      const userApps = users.map((u) => ({
        name: u.name,
        appsToday: countsByUid[u.uid] || 0,
      }));
      roastMap = await generateRoasts(userApps);
    } else {
      // Use cached roasts, but regenerate for users who crossed a milestone
      roastMap = { ...cached };

      for (const u of users) {
        const count = countsByUid[u.uid] || 0;
        const prev = cachedCountMap[u.uid] || 0;
        // Check if user crossed any milestone since last cache
        const crossedMilestone = MILESTONES.some((m) => count >= m && prev < m);
        if (crossedMilestone) {
          const newRoast = await generateSingleRoast(u.name, count);
          roastMap[u.name] = newRoast;
        }
      }
    }

    // Always update cache with current counts
    const countMap = JSON.stringify(
      Object.fromEntries(users.map((u) => [u.uid, countsByUid[u.uid] || 0]))
    );
    await cacheRef.set({ ...roastMap, _countMap: countMap });

    const entries: ShameEntry[] = users.map((u) => {
      const appsToday = countsByUid[u.uid] || 0;
      return { uid: u.uid, name: u.name, appsToday, roast: roastMap[u.name] || "" };
    });

    // Sort: 0 apps first (most shameful), then ascending
    entries.sort((a, b) => a.appsToday - b.appsToday);

    const totalAppsToday = entries.reduce((s, e) => s + e.appsToday, 0);

    return NextResponse.json({ ok: true, date: today, totalAppsToday, entries });
  } catch (err) {
    const status = err instanceof HttpError ? err.statusCode : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Server error" },
      { status }
    );
  }
}
