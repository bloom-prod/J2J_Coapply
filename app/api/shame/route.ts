import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";
import { generateRoasts, generateSingleRoast } from "@/lib/gemini";
import { NOT_YET_APPLIED_STATUS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Shame Wall is a shared group leaderboard: everyone must see the same
// "day", the same counts, and the same cached roasts. The day boundary is
// therefore fixed to US Eastern for the whole group — honoring each client's
// own timezone would split the cache per viewer and desync the totals.
const TZ = "America/New_York";

/** Read the wall-clock fields of `d` as rendered in Eastern time.
 *  Values come back as numbers so nothing depends on how ICU pads or formats
 *  them — rebuilding a parseable "YYYY-MM-DDTHH:mm:ssZ" string here is fragile
 *  (a single-digit minute, or an "24" hour under an h24 hour cycle, yields an
 *  unparseable string, and the resulting NaN propagates into the Firestore
 *  query as an Invalid Date). `hour % 24` folds the h24 midnight spelling. */
function easternParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const n = (t: string) => {
    const v = parseInt(parts.find((p) => p.type === t)?.value ?? "", 10);
    if (!Number.isFinite(v)) {
      throw new Error(`[shame] Intl produced no usable "${t}" for ${TZ}`);
    }
    return v;
  };
  return { year: n("year"), month: n("month"), day: n("day"), hour: n("hour") % 24, minute: n("minute") };
}

/** Get the EST/EDT UTC offset in ms by comparing a known UTC time to its local representation. */
function getEasternOffsetMs(refDate: Date): number {
  const p = easternParts(refDate);
  const localMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // localMs is truncated to the minute, so compare against refDate truncated the
  // same way. Subtracting the raw refDate would fold its seconds/milliseconds
  // into the "offset", drifting the 6 AM window boundary by up to 59.999s
  // depending on what time the request happened to arrive.
  const refFloored = Math.floor(refDate.getTime() / 60000) * 60000;
  return localMs - refFloored; // negative for US Eastern (UTC-5 or UTC-4)
}

/** Shift a YYYY-MM-DD string by whole days without touching server-local time. */
function shiftDateStr(dateStr: string, days: number): string {
  // Parsing as UTC ("...T00:00:00Z") and using setUTCDate keeps the arithmetic
  // independent of the server's timezone — a bare "T00:00:00" is parsed as
  // server-local, and on a UTC-ahead server toISOString() would roll the date
  // back a day, shifting the entire query window.
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns the effective "today" date (YYYY-MM-DD) in Eastern time and the
 * 6AM-to-6AM UTC time range for querying applications.
 *
 * Day runs from 6 AM Eastern to 6 AM Eastern the next day.
 * If current time is before 6 AM Eastern, it counts as the previous day.
 */
function effectiveToday(): { dateStr: string; dayStart: Date; dayEnd: Date } {
  const now = new Date();
  const offsetMs = getEasternOffsetMs(now);
  const p = easternParts(now);

  const pad = (n: number) => String(n).padStart(2, "0");
  let dateStr = `${p.year}-${pad(p.month)}-${pad(p.day)}`;

  if (p.hour < 6) dateStr = shiftDateStr(dateStr, -1);

  const dayStart = new Date(`${dateStr}T06:00:00Z`);
  dayStart.setTime(dayStart.getTime() - offsetMs);

  const dayEnd = new Date(`${shiftDateStr(dateStr, 1)}T06:00:00Z`);
  dayEnd.setTime(dayEnd.getTime() - offsetMs);

  // Never hand an Invalid Date to Firestore: it surfaces as the opaque
  // 'Value for argument "seconds" is not a valid integer' from Timestamp.fromDate,
  // with nothing in the message pointing back at this window calculation.
  if (Number.isNaN(dayStart.getTime()) || Number.isNaN(dayEnd.getTime())) {
    throw new Error(
      `[shame] invalid day window: dateStr=${dateStr} offsetMs=${offsetMs} parts=${JSON.stringify(p)}`
    );
  }

  return { dateStr, dayStart, dayEnd };
}

export interface ShameEntry {
  uid: string;
  name: string;
  appsToday: number;
  roast: string;
}

interface RoastCache {
  roasts?: Record<string, string>; // uid -> roast text
  countMap?: Record<string, number>; // uid -> app count, for milestone detection
  generating?: boolean;
  generatingAt?: Timestamp;
}

const MILESTONES = [5, 10];
const GENERATION_LOCK_TIMEOUT_MS = 30_000;

export async function GET(req: Request) {
  try {
    await requireUser(req);

    const url = new URL(req.url);
    const forceRegen = url.searchParams.get("force") === "1";
    const { dateStr: today, dayStart, dayEnd } = effectiveToday();
    console.log("[shame] effectiveToday:", today, "| force:", forceRegen);

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
    } catch (dbErr) {
      console.error("[shame] Firestore query FAILED:", dbErr);
      throw dbErr;
    }

    // Count applications per user for today — exclude "Want to Apply" (not yet applied)
    const countsByUid: Record<string, number> = {};
    appsSnap.forEach((doc) => {
      const data = doc.data();
      const uid = data.ownerUid as string;
      if (!uid) return;
      if (data.status === NOT_YET_APPLIED_STATUS) return;
      countsByUid[uid] = (countsByUid[uid] || 0) + 1;
    });

    const users: { uid: string; name: string }[] = [];
    profilesSnap.forEach((doc) => {
      const data = doc.data();
      users.push({ uid: doc.id, name: (data.name as string) || "Someone" });
    });

    const cacheRef = adminDb.collection("dailyRoasts").doc(today);
    const cacheDoc = await cacheRef.get();
    const cached = cacheDoc.exists ? (cacheDoc.data() as RoastCache) : null;
    // A doc without a `roasts` field is either a pre-migration cache (old code
    // stored name-keyed roasts at the top level) or a lock-only doc from a
    // request that claimed generation and died — both need fresh generation,
    // otherwise everyone would see blank roasts for the rest of the day.
    const needsGeneration = !cached?.roasts || forceRegen;

    // Claim the generation slot atomically so two concurrent requests (e.g. the
    // Shame Wall embed and the popup both fetching on mount) don't both pay for
    // an LLM call and race to write the cache — whichever gets here first wins,
    // the other reuses whatever's already cached (or waits for the next poll).
    let claimedGeneration = false;
    if (needsGeneration) {
      claimedGeneration = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(cacheRef);
        const data = snap.exists ? (snap.data() as RoastCache) : null;
        const lockAgeMs = data?.generatingAt ? Date.now() - data.generatingAt.toDate().getTime() : Infinity;
        if (data?.generating && lockAgeMs < GENERATION_LOCK_TIMEOUT_MS && !forceRegen) {
          return false;
        }
        tx.set(cacheRef, { generating: true, generatingAt: FieldValue.serverTimestamp() }, { merge: true });
        return true;
      });
    }

    const cachedCountMap = cached?.countMap || {};
    const countMap = Object.fromEntries(users.map((u) => [u.uid, countsByUid[u.uid] || 0]));
    let roastByUid: Record<string, string>;

    if (needsGeneration && claimedGeneration) {
      try {
        const userApps = users.map((u) => ({ name: u.name, appsToday: countsByUid[u.uid] || 0 }));
        const roastByName = await generateRoasts(userApps);
        roastByUid = {};
        users.forEach((u) => { roastByUid[u.uid] = roastByName[u.name] || ""; });
        await cacheRef.set({ roasts: roastByUid, countMap, generating: false }, { merge: true });
      } catch (genErr) {
        // Release the lock immediately on failure so the next request can retry
        // rather than waiting out the lock timeout.
        await cacheRef.set({ generating: false }, { merge: true }).catch(() => {});
        throw genErr;
      }
    } else if (needsGeneration && !claimedGeneration) {
      // Another request is generating right now — serve whatever roasts exist
      // (empty on the very first request of the day) WITHOUT touching the cache:
      // writing here would clear the winner's `generating` lock mid-flight and
      // let a third request start a duplicate LLM call.
      roastByUid = { ...(cached?.roasts || {}) };
    } else {
      roastByUid = { ...(cached!.roasts || {}) };
      let regenerated = false;
      for (const u of users) {
        const count = countsByUid[u.uid] || 0;
        const prev = cachedCountMap[u.uid] || 0;
        const crossedMilestone = MILESTONES.some((m) => count >= m && prev < m);
        if (crossedMilestone) {
          roastByUid[u.uid] = await generateSingleRoast(u.name, count);
          regenerated = true;
        }
      }
      // Persist updated counts (and any milestone roasts) so milestone detection
      // has a fresh baseline. Safe to write here: this branch only runs when no
      // generation lock is in play.
      try {
        if (regenerated) {
          await cacheRef.set({ roasts: roastByUid, countMap }, { merge: true });
        } else {
          await cacheRef.set({ countMap }, { merge: true });
        }
      } catch (cacheErr) {
        console.error("[shame] Cache write FAILED:", cacheErr);
      }
    }

    const entries: ShameEntry[] = users.map((u) => {
      const appsToday = countsByUid[u.uid] || 0;
      return { uid: u.uid, name: u.name, appsToday, roast: roastByUid[u.uid] || "" };
    });

    entries.sort((a, b) => a.appsToday - b.appsToday);
    const totalAppsToday = entries.reduce((s, e) => s + e.appsToday, 0);

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
