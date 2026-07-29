import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";
import { generateRoasts, generateSingleRoast } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns today's date as YYYY-MM-DD.
 * Applications store their date using `new Date().toISOString().slice(0,10)` (UTC).
 * To stay consistent, we also use UTC here.
 * If it's before 2 AM in the user's timezone, roll back to yesterday (UTC)
 * since people apply late at night.
 */
function effectiveToday(tz: string): string {
  try {
    const now = new Date();
    // Check the hour in the user's timezone for the 2AM cutoff
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "12", 10);

    if (hour < 6) {
      // Before 6 AM local time — roll back one day from UTC date
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    }
    // Use UTC date to match how applications store their date field
    return now.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
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
    const today = effectiveToday(tz);

    const [appsSnap, profilesSnap] = await Promise.all([
      adminDb.collection("applications").where("date", "==", today).get(),
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
