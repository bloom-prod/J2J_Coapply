/**
 * Shame Wall Logic Test Suite
 * Run: node tests/shame-wall.test.mjs
 *
 * Tests the date/time logic and counting logic from app/api/shame/route.ts
 * to diagnose why displayed counts, prompt counts, and actual counts disagree.
 */

import assert from "assert/strict";

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

function group(name) {
  console.log(`\n── ${name} ──`);
}

// ═══════════════════════════════════════════════════════════════════════════
// COPIED LOGIC from app/api/shame/route.ts
// (parameterized so we can pass in a specific `now` for deterministic tests)
// ═══════════════════════════════════════════════════════════════════════════

const TZ = "America/New_York";

function getEasternOffsetMs(refDate) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(refDate);
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "";
  const hourStr = g("hour");
  const localMs = new Date(
    `${g("year")}-${g("month")}-${g("day")}T${String(parseInt(hourStr)).padStart(2, "0")}:${g("minute")}:00Z`
  ).getTime();
  return localMs - refDate.getTime();
}

/** Production version (uses new Date() internally — untestable) */
function effectiveTodayProduction() {
  const now = new Date();
  return effectiveTodayWith(now);
}

/** Parameterized version for testing */
function effectiveTodayWith(now) {
  const offsetMs = getEasternOffsetMs(now);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", hour12: false,
  }).formatToParts(now);
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(g("hour"), 10);
  let dateStr = `${g("year")}-${g("month")}-${g("day")}`;

  if (hour < 6) {
    // BUG CANDIDATE: new Date(dateStr + "T00:00:00") parses as LOCAL server time.
    // If the server is NOT UTC, d.toISOString() may return the wrong date.
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() - 1);
    dateStr = d.toISOString().slice(0, 10);
  }

  const dayStart = new Date(`${dateStr}T06:00:00Z`);
  dayStart.setTime(dayStart.getTime() - offsetMs);

  // BUG CANDIDATE: same local-time parse issue for nextDay
  const nextDay = new Date(dateStr + "T00:00:00");
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDateStr = nextDay.toISOString().slice(0, 10);
  const dayEnd = new Date(`${nextDateStr}T06:00:00Z`);
  dayEnd.setTime(dayEnd.getTime() - offsetMs);

  return { dateStr, dayStart, dayEnd, offsetMs };
}

/** Fixed version using UTC-only date arithmetic */
function effectiveTodayFixed(now) {
  const offsetMs = getEasternOffsetMs(now);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", hour12: false,
  }).formatToParts(now);
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(g("hour"), 10);
  let dateStr = `${g("year")}-${g("month")}-${g("day")}`;

  if (hour < 6) {
    // FIX: use UTC-safe date parsing
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    dateStr = d.toISOString().slice(0, 10);
  }

  const dayStart = new Date(`${dateStr}T06:00:00Z`);
  dayStart.setTime(dayStart.getTime() - offsetMs);

  // FIX: use UTC-safe date parsing
  const nextDay = new Date(dateStr + "T00:00:00Z");
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDateStr = nextDay.toISOString().slice(0, 10);
  const dayEnd = new Date(`${nextDateStr}T06:00:00Z`);
  dayEnd.setTime(dayEnd.getTime() - offsetMs);

  return { dateStr, dayStart, dayEnd, offsetMs };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function toEastern(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(date);
}

function describeRange(dayStart, dayEnd) {
  return `${dayStart.toISOString()} → ${dayEnd.toISOString()} (Eastern: ${toEastern(dayStart)} → ${toEastern(dayEnd)})`;
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

group("1. Eastern UTC offset (getEasternOffsetMs)");

test("EDT (summer, UTC-4): offset should be -14400000 ms", () => {
  // 2026-07-29 14:00 UTC = 10:00 AM EDT
  const now = new Date("2026-07-29T14:00:00Z");
  const offset = getEasternOffsetMs(now);
  assert.equal(offset, -14400000, `Got ${offset} ms (${offset / 3600000}h), expected -14400000 (-4h)`);
});

test("EST (winter, UTC-5): offset should be -18000000 ms", () => {
  // 2026-01-15 14:00 UTC = 09:00 AM EST
  const now = new Date("2026-01-15T14:00:00Z");
  const offset = getEasternOffsetMs(now);
  assert.equal(offset, -18000000, `Got ${offset} ms (${offset / 3600000}h), expected -18000000 (-5h)`);
});

test("Offset is consistent regardless of time of day (not just midnight)", () => {
  const morningUTC = new Date("2026-07-29T08:00:00Z"); // 4 AM EDT
  const afternoonUTC = new Date("2026-07-29T20:00:00Z"); // 4 PM EDT
  const morningOffset = getEasternOffsetMs(morningUTC);
  const afternoonOffset = getEasternOffsetMs(afternoonUTC);
  assert.equal(morningOffset, afternoonOffset,
    `Offset changed between morning (${morningOffset}) and afternoon (${afternoonOffset})`);
});

test("Offset at midnight UTC (edge case: hour may return '24' in some locales)", () => {
  const midnight = new Date("2026-07-29T00:00:00Z"); // midnight UTC = 8 PM EDT prev day
  const offset = getEasternOffsetMs(midnight);
  // 8 PM EDT = 20:00 local → offsetMs = 20:00 UTC - 00:00 UTC = +20h???
  // OR if hour returns '24' instead of '0', it could be badly wrong
  console.log(`    Offset at midnight UTC: ${offset} ms (${offset / 3600000}h)`);
  // The correct EDT offset is -14400000 regardless of time of day
  assert.equal(offset, -14400000,
    `BUG: Offset at midnight UTC is ${offset} ms (${offset / 3600000}h), expected -14400000 (-4h EDT)`);
});

group("2. effectiveToday: date string and 6AM–6AM window");

// Helper to verify a window is correct
function assertCorrectWindow(label, now, expectedDate, expectedStartUTC, expectedEndUTC) {
  const result = effectiveTodayWith(now);
  const bugResult = effectiveTodayWith(now);
  const fixResult = effectiveTodayFixed(now);

  console.log(`    Time: ${now.toISOString()} = ${toEastern(now)} Eastern`);
  console.log(`    dateStr: ${result.dateStr} (expected: ${expectedDate})`);
  console.log(`    dayStart: ${result.dayStart.toISOString()} (expected: ${expectedStartUTC})`);
  console.log(`    dayEnd:   ${result.dayEnd.toISOString()} (expected: ${expectedEndUTC})`);
  if (bugResult.dateStr !== fixResult.dateStr || bugResult.dayStart.toISOString() !== fixResult.dayStart.toISOString()) {
    console.log(`    ⚠️  DISCREPANCY: bug version vs fixed version differ!`);
    console.log(`    Bug:   dateStr=${bugResult.dateStr}, start=${bugResult.dayStart.toISOString()}`);
    console.log(`    Fixed: dateStr=${fixResult.dateStr}, start=${fixResult.dayStart.toISOString()}`);
  }

  assert.equal(result.dateStr, expectedDate, `dateStr: got "${result.dateStr}", expected "${expectedDate}"`);
  assert.equal(result.dayStart.toISOString(), expectedStartUTC,
    `dayStart: got "${result.dayStart.toISOString()}", expected "${expectedStartUTC}"`);
  assert.equal(result.dayEnd.toISOString(), expectedEndUTC,
    `dayEnd: got "${result.dayEnd.toISOString()}", expected "${expectedEndUTC}"`);
}

test("Afternoon (2 PM EDT on Jul 29) → date=2026-07-29, window 10AM UTC Jul 29 to 10AM UTC Jul 30", () => {
  // 2 PM EDT = 18:00 UTC; EDT = UTC-4, so 6AM EDT = 10AM UTC
  assertCorrectWindow(
    "2 PM EDT Jul 29",
    new Date("2026-07-29T18:00:00Z"),
    "2026-07-29",
    "2026-07-29T10:00:00.000Z", // 6 AM EDT = 10 AM UTC
    "2026-07-30T10:00:00.000Z"  // 6 AM EDT next day = 10 AM UTC next day
  );
});

test("After midnight (1 AM EDT Jul 29 = before 6 AM) → should count as Jul 28", () => {
  // 1 AM EDT Jul 29 = 05:00 UTC Jul 29 → hour < 6 → count as Jul 28
  // day for Jul 28: dayStart = Jul 28 6AM EDT = Jul 28 10AM UTC
  // dayEnd = Jul 29 6AM EDT = Jul 29 10AM UTC
  assertCorrectWindow(
    "1 AM EDT Jul 29 (before 6 AM)",
    new Date("2026-07-29T05:00:00Z"),
    "2026-07-28",
    "2026-07-28T10:00:00.000Z",
    "2026-07-29T10:00:00.000Z"
  );
});

test("Exactly 6 AM EDT (10 AM UTC) → counts as that day (not previous)", () => {
  // 6 AM EDT Jul 29 = 10:00 UTC Jul 29 → hour == 6, NOT < 6 → same day
  assertCorrectWindow(
    "6 AM EDT Jul 29 exactly",
    new Date("2026-07-29T10:00:00Z"),
    "2026-07-29",
    "2026-07-29T10:00:00.000Z",
    "2026-07-30T10:00:00.000Z"
  );
});

test("5:59 AM EDT (just before cutoff) → counts as previous day", () => {
  // 5:59 AM EDT Jul 29 = 09:59 UTC Jul 29 → hour=5 < 6 → counts as Jul 28
  assertCorrectWindow(
    "5:59 AM EDT Jul 29",
    new Date("2026-07-29T09:59:00Z"),
    "2026-07-28",
    "2026-07-28T10:00:00.000Z",
    "2026-07-29T10:00:00.000Z"
  );
});

test("Winter EST (Jan 15, 2 PM EST = 19:00 UTC) → window uses 11AM UTC (6AM EST)", () => {
  // EST = UTC-5, so 6 AM EST = 11 AM UTC
  assertCorrectWindow(
    "2 PM EST Jan 15",
    new Date("2026-01-15T19:00:00Z"),
    "2026-01-15",
    "2026-01-15T11:00:00.000Z", // 6 AM EST = 11 AM UTC
    "2026-01-16T11:00:00.000Z"
  );
});

test("DST transition — day before spring forward (2 AM EST = 7 AM UTC)", () => {
  // Mar 8 2026 is when DST begins. This tests the day before.
  // 2 PM EST Mar 7 = 19:00 UTC → should be EST (UTC-5), 6AM EST = 11AM UTC
  assertCorrectWindow(
    "2 PM EST Mar 7 2026 (day before DST)",
    new Date("2026-03-07T19:00:00Z"),
    "2026-03-07",
    "2026-03-07T11:00:00.000Z",
    "2026-03-08T11:00:00.000Z"
  );
});

group("3. Query window — does it capture the right apps?");

test("App at 9 AM EDT (13:00 UTC) should be IN today's window", () => {
  const now = new Date("2026-07-29T18:00:00Z"); // 2 PM EDT
  const { dayStart, dayEnd } = effectiveTodayWith(now);
  const appTime = new Date("2026-07-29T13:00:00Z"); // 9 AM EDT
  const inWindow = appTime >= dayStart && appTime < dayEnd;
  assert.ok(inWindow,
    `App at 9 AM EDT (13:00 UTC) NOT in window: ${describeRange(dayStart, dayEnd)}`);
});

test("App at 5 AM EDT (09:00 UTC) should NOT be in today's window (before 6 AM cutoff)", () => {
  const now = new Date("2026-07-29T18:00:00Z"); // 2 PM EDT
  const { dayStart, dayEnd } = effectiveTodayWith(now);
  const appTime = new Date("2026-07-29T09:00:00Z"); // 5 AM EDT
  const inWindow = appTime >= dayStart && appTime < dayEnd;
  assert.ok(!inWindow,
    `App at 5 AM EDT (09:00 UTC) is incorrectly IN window: ${describeRange(dayStart, dayEnd)}`);
});

test("App at midnight EDT (04:00 UTC) should NOT be in today's window", () => {
  const now = new Date("2026-07-29T18:00:00Z"); // 2 PM EDT
  const { dayStart, dayEnd } = effectiveTodayWith(now);
  const appTime = new Date("2026-07-29T04:00:00Z"); // midnight EDT
  const inWindow = appTime >= dayStart && appTime < dayEnd;
  assert.ok(!inWindow,
    `App at midnight EDT (04:00 UTC) is incorrectly IN window: ${describeRange(dayStart, dayEnd)}`);
});

test("App at exactly 6 AM EDT (10:00 UTC) should be IN window", () => {
  const now = new Date("2026-07-29T18:00:00Z");
  const { dayStart, dayEnd } = effectiveTodayWith(now);
  const appAt6amEDT = new Date("2026-07-29T10:00:00Z"); // exactly 6 AM EDT
  const inWindow = appAt6amEDT >= dayStart && appAt6amEDT < dayEnd;
  assert.ok(inWindow,
    `App at exactly 6 AM EDT (10:00 UTC) NOT in window: ${describeRange(dayStart, dayEnd)}`);
});

test("App at 6 AM EDT next day (10:00 UTC next day) should NOT be in window (exclusive end)", () => {
  const now = new Date("2026-07-29T18:00:00Z");
  const { dayStart, dayEnd } = effectiveTodayWith(now);
  const appAtEndBoundary = new Date("2026-07-30T10:00:00Z"); // 6 AM EDT next day
  const inWindow = appAtEndBoundary >= dayStart && appAtEndBoundary < dayEnd;
  assert.ok(!inWindow,
    `App at 6 AM EDT next day incorrectly IN window: ${describeRange(dayStart, dayEnd)}`);
});

group("4. countsByUid aggregation logic — status filtering");

test("'Want to Apply' entries must NOT be counted (was the bug)", () => {
  const fakeDocs = [
    { ownerUid: "uid1", status: "Applied" },
    { ownerUid: "uid1", status: "Want to Apply" }, // should be excluded
    { ownerUid: "uid1", status: "Interview" },
    { ownerUid: "uid2", status: "Want to Apply" }, // should be excluded
  ];

  // OLD (buggy) logic — counts everything
  const buggyCountsByUid = {};
  fakeDocs.forEach((d) => {
    const uid = d.ownerUid;
    if (uid) buggyCountsByUid[uid] = (buggyCountsByUid[uid] || 0) + 1;
  });

  // NEW (fixed) logic — excludes "Want to Apply"
  const fixedCountsByUid = {};
  fakeDocs.forEach((d) => {
    const uid = d.ownerUid;
    if (!uid) return;
    if (d.status === "Want to Apply") return;
    fixedCountsByUid[uid] = (fixedCountsByUid[uid] || 0) + 1;
  });

  // Bug: uid1 counted as 3 (includes Want to Apply), uid2 counted as 1
  assert.equal(buggyCountsByUid["uid1"], 3, `Buggy count includes Want to Apply`);
  assert.equal(buggyCountsByUid["uid2"], 1, `Buggy count includes uid2's Want to Apply`);

  // Fixed: uid1 = 2 (Applied + Interview), uid2 = 0 (only had Want to Apply)
  assert.equal(fixedCountsByUid["uid1"], 2, `Fixed count: uid1 should have 2`);
  assert.equal(fixedCountsByUid["uid2"], undefined, `Fixed count: uid2 has no real apps`);
});

test("All non-Want-to-Apply statuses ARE counted", () => {
  const countedStatuses = ["Applied", "Phone Screen", "Interview", "Offer", "Rejected", "Ghosted", "Withdrawn"];
  const fakeDocs = countedStatuses.map((status) => ({ ownerUid: "uid1", status }));

  const countsByUid = {};
  fakeDocs.forEach((d) => {
    const uid = d.ownerUid;
    if (!uid) return;
    if (d.status === "Want to Apply") return;
    countsByUid[uid] = (countsByUid[uid] || 0) + 1;
  });

  assert.equal(countsByUid["uid1"], countedStatuses.length,
    `All ${countedStatuses.length} non-Want-to-Apply statuses should be counted`);
});

test("Apps with valid ownerUid are counted correctly", () => {
  const fakeDocs = [
    { ownerUid: "uid1", createdAt: "2026-07-29T13:00:00Z" },
    { ownerUid: "uid1", createdAt: "2026-07-29T14:00:00Z" },
    { ownerUid: "uid2", createdAt: "2026-07-29T15:00:00Z" },
  ];

  const countsByUid = {};
  fakeDocs.forEach((d) => {
    const uid = d.ownerUid;
    if (uid) countsByUid[uid] = (countsByUid[uid] || 0) + 1;
  });

  assert.equal(countsByUid["uid1"], 2, `uid1 count: got ${countsByUid["uid1"]}, expected 2`);
  assert.equal(countsByUid["uid2"], 1, `uid2 count: got ${countsByUid["uid2"]}, expected 1`);
});

test("Apps without ownerUid are silently excluded from counts", () => {
  const fakeDocs = [
    { ownerUid: "uid1" },
    { ownerUid: null },      // no uid
    { ownerUid: undefined }, // no uid
    { ownerUid: "" },        // empty string — falsy, excluded
  ];

  const countsByUid = {};
  fakeDocs.forEach((d) => {
    const uid = d.ownerUid;
    if (uid) countsByUid[uid] = (countsByUid[uid] || 0) + 1;
  });

  // Only uid1 should be counted
  assert.equal(countsByUid["uid1"], 1);
  // Total appsSnap.size would be 4, but totalAppsToday in response would be 1
  const appsSnapSize = fakeDocs.length;
  const totalFromEntries = Object.values(countsByUid).reduce((s, c) => s + c, 0);
  assert.notEqual(appsSnapSize, totalFromEntries,
    `BUG REPRODUCED: appsSnap.size (${appsSnapSize}) ≠ sum from entries (${totalFromEntries}). Apps without ownerUid are excluded from user counts!`);
});

test("User with profile but no apps today shows 0", () => {
  const countsByUid = { uid1: 3 };
  const profiles = [
    { uid: "uid1", name: "Alice" },
    { uid: "uid2", name: "Bob" },  // Bob has no apps today
  ];

  const entries = profiles.map((u) => ({
    uid: u.uid,
    name: u.name,
    appsToday: countsByUid[u.uid] || 0,
  }));

  const bob = entries.find(e => e.uid === "uid2");
  assert.equal(bob.appsToday, 0, `Bob should show 0 apps`);
});

test("User with apps but no userProfile is excluded from entries (and totalAppsToday)", () => {
  const countsByUid = { uid1: 3, uid3: 5 }; // uid3 has apps
  const profiles = [
    { uid: "uid1", name: "Alice" }, // only uid1 has a profile
    // uid3 has no profile — won't appear in userProfiles collection
  ];

  const entries = profiles.map((u) => ({
    uid: u.uid,
    name: u.name,
    appsToday: countsByUid[u.uid] || 0,
  }));

  const totalAppsToday = entries.reduce((s, e) => s + e.appsToday, 0);
  const actualTotal = Object.values(countsByUid).reduce((s, c) => s + c, 0);

  assert.notEqual(totalAppsToday, actualTotal,
    `BUG REPRODUCED: totalAppsToday (${totalAppsToday}) ≠ actual apps (${actualTotal}). User uid3 has ${countsByUid["uid3"]} apps but no profile — excluded from total!`);

  assert.equal(totalAppsToday, 3, `Only Alice's apps are counted: ${totalAppsToday}`);
  assert.equal(actualTotal, 8, `Actual apps in Firestore: ${actualTotal}`);
});

group("5. Cache staleness — roast text vs. displayed counts");

test("REPRODUCE BUG: cached roast references old count, display shows new count", () => {
  // Simulate: cache was written when Alice had 3 apps; now she has 7
  const cachedRoastMap = {
    "Alice": "Alice, 3 apps? You're barely breathing, let alone hustling.",
    "_countMap": JSON.stringify({ "uid1": 3 }),
  };

  const currentCountsByUid = { "uid1": 7 };

  // Parse the cached counts
  const cachedCountMap = {};
  if (cachedRoastMap._countMap) {
    Object.assign(cachedCountMap, JSON.parse(cachedRoastMap._countMap));
  }

  const MILESTONES = [5, 10];
  const users = [{ uid: "uid1", name: "Alice" }];

  // Simulate route logic: use cached roasts, check milestones
  let roastMap = { ...cachedRoastMap };
  const milestoneRegens = [];

  for (const u of users) {
    const count = currentCountsByUid[u.uid] || 0;
    const prev = cachedCountMap[u.uid] || 0;
    const crossedMilestone = MILESTONES.some((m) => count >= m && prev < m);
    if (crossedMilestone) {
      milestoneRegens.push(u.name);
      // Would regenerate roast here
      roastMap[u.name] = `Alice regenerated roast for ${count} apps`;
    }
  }

  // Build entries
  const entries = users.map((u) => ({
    uid: u.uid,
    name: u.name,
    appsToday: currentCountsByUid[u.uid] || 0, // CURRENT count
    roast: roastMap[u.name] || "",              // roast may use OLD count
  }));

  const alice = entries[0];

  if (milestoneRegens.includes("Alice")) {
    // Milestone crossed (3→7 crosses 5) — roast was regenerated ✓
    assert.ok(alice.roast.includes("7"),
      `After milestone regen, roast should mention 7 apps. Got: "${alice.roast}"`);
  } else {
    // BUG: roast still says "3 apps" but display shows 7
    console.log(`    Displayed appsToday: ${alice.appsToday}`);
    console.log(`    Roast text: "${alice.roast}"`);
    const roastMentionsOldCount = alice.roast.includes("3");
    const displayedCount = alice.appsToday;
    assert.equal(displayedCount, 7, `Displayed count should be 7`);
    assert.ok(roastMentionsOldCount,
      `BUG REPRODUCED: Roast says "${alice.roast}" (mentions old count 3) but display shows ${displayedCount}`);
  }
});

test("Milestone at 5 triggers regen (3→7 crosses milestone 5)", () => {
  const cachedCountMap = { "uid1": 3 };
  const currentCounts = { "uid1": 7 };
  const MILESTONES = [5, 10];
  const u = { uid: "uid1", name: "Alice" };

  const count = currentCounts[u.uid] || 0;
  const prev = cachedCountMap[u.uid] || 0;
  const crossedMilestone = MILESTONES.some((m) => count >= m && prev < m);

  assert.ok(crossedMilestone, `Should detect milestone crossing (${prev} → ${count})`);
});

test("No milestone crossed (3→4) means roast stays stale", () => {
  const cachedCountMap = { "uid1": 3 };
  const currentCounts = { "uid1": 4 };
  const MILESTONES = [5, 10];
  const u = { uid: "uid1", name: "Alice" };

  const count = currentCounts[u.uid] || 0;
  const prev = cachedCountMap[u.uid] || 0;
  const crossedMilestone = MILESTONES.some((m) => count >= m && prev < m);

  assert.ok(!crossedMilestone, `Should NOT detect milestone crossing (${prev} → ${count})`);
  // Result: roast says "3 apps" but display shows "4 apps"
  console.log(`    ⚠️  Roast will say "3 apps" but display shows "4 apps" — stale cache bug`);
});

test("Corrupt _countMap silently fails and treats prev count as 0", () => {
  const cachedRoastMap = {
    "Alice": "You're pathetic.",
    "_countMap": "NOT VALID JSON {{{",
  };

  const cachedCountMap = {};
  if (cachedRoastMap._countMap) {
    try {
      Object.assign(cachedCountMap, JSON.parse(cachedRoastMap._countMap));
    } catch { /* silently ignored */ }
  }

  const prev = cachedCountMap["uid1"] || 0;
  assert.equal(prev, 0, `Corrupt _countMap results in prev=0 for all users`);

  // With prev=0, every user with >=5 apps will trigger a milestone regen
  const MILESTONES = [5, 10];
  const count = 7;
  const crossedMilestone = MILESTONES.some((m) => count >= m && prev < m);
  assert.ok(crossedMilestone, `With corrupt cache, every user at 7+ apps triggers unnecessary regen`);
  console.log(`    Note: corrupt _countMap causes excessive regen, burning LLM API calls`);
});

group("6. totalAppsToday consistency");

test("totalAppsToday from entries matches sum of per-user counts when all users have profiles", () => {
  const countsByUid = { uid1: 5, uid2: 3, uid3: 0 };
  const profiles = [
    { uid: "uid1", name: "Alice" },
    { uid: "uid2", name: "Bob" },
    { uid: "uid3", name: "Carol" },
  ];

  const entries = profiles.map((u) => ({
    uid: u.uid, name: u.name,
    appsToday: countsByUid[u.uid] || 0,
  }));

  const totalAppsToday = entries.reduce((s, e) => s + e.appsToday, 0);
  assert.equal(totalAppsToday, 8, `totalAppsToday should be 8, got ${totalAppsToday}`);
});

test("totalAppsToday does NOT include apps from users with no profile (gap)", () => {
  // uid4 applied today but has no userProfile document
  const countsByUid = { uid1: 5, uid4: 10 };
  const profiles = [{ uid: "uid1", name: "Alice" }];

  const entries = profiles.map((u) => ({
    uid: u.uid, name: u.name,
    appsToday: countsByUid[u.uid] || 0,
  }));

  const totalAppsToday = entries.reduce((s, e) => s + e.appsToday, 0);
  const appsSnapTotal = Object.values(countsByUid).reduce((s, c) => s + c, 0);

  assert.equal(totalAppsToday, 5, `totalAppsToday only counts profiled users: ${totalAppsToday}`);
  assert.equal(appsSnapTotal, 15);
  console.log(`    BUG: totalAppsToday=${totalAppsToday} but Firestore appsSnap.size would show ${appsSnapTotal}`);
});

group("7. Local time parse bug — server timezone safety");

test("new Date('YYYY-MM-DDT00:00:00') vs UTC-safe parsing — diagnosing date rollback risk", () => {
  const serverTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`    Server timezone: ${serverTZ}`);

  // The bug: production code uses local-time parsing for date arithmetic.
  // Test a date where a UTC+ server would parse it as the PREVIOUS day in UTC.
  // e.g., "2026-07-01T00:00:00" in UTC+5:30 = "2026-06-30T18:30:00Z" → date is "2026-06-30"!
  const dateStr = "2026-07-01";

  const localParse = new Date(dateStr + "T00:00:00");
  const utcParse = new Date(dateStr + "T00:00:00Z");

  const localDateInUTC = localParse.toISOString().slice(0, 10);
  const utcDateInUTC = utcParse.toISOString().slice(0, 10);

  console.log(`    new Date("${dateStr}T00:00:00")  → ${localParse.toISOString()} (date in UTC: ${localDateInUTC})`);
  console.log(`    new Date("${dateStr}T00:00:00Z") → ${utcParse.toISOString()} (date in UTC: ${utcDateInUTC})`);

  if (localDateInUTC !== utcDateInUTC) {
    // The rollback would subtract from the wrong date
    const localMinus1 = new Date(dateStr + "T00:00:00");
    localMinus1.setDate(localMinus1.getDate() - 1);
    const utcMinus1 = new Date(dateStr + "T00:00:00Z");
    utcMinus1.setUTCDate(utcMinus1.getUTCDate() - 1);
    assert.fail(
      `ACTIVE BUG on this server (TZ=${serverTZ}): local parse gives date "${localDateInUTC}" but UTC parse gives "${utcDateInUTC}". ` +
      `After day-rollback: production gives "${localMinus1.toISOString().slice(0, 10)}", correct gives "${utcMinus1.toISOString().slice(0, 10)}".`
    );
  } else {
    // Dates agree — server is UTC or UTC- (behind UTC, so midnight local is same or later day in UTC)
    console.log(`    OK on this server (UTC or UTC-). Would break on UTC+ servers (e.g. IST, JST).`);
    assert.ok(true);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY REPORT
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════");
console.log(`RESULTS: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log("\nFAILURES:");
  failures.forEach((f, i) => {
    console.log(`  ${i + 1}. ${f.name}`);
    console.log(`     ${f.message}`);
  });
}

console.log("\n─── Root cause analysis ───");
console.log(`
The three numbers that disagree:

  1. "Count in display" (entry.appsToday)  = live Firestore query result
  2. "Number in roast/prompt"              = count used when LLM roast was generated (may be stale from cache)
  3. "Actual applied applications"         = what user actually sees in their tracker

IDENTIFIED BUGS:

  Bug A (Cache staleness): The roast text is cached with counts from earlier
    in the day. When new apps are added, the display shows updated counts, but
    the roast text still refers to the count at cache time.
    → Fixed by adding count to roast cache key, or always re-generating when count changes.

  Bug B (Missing profile): Apps from users without a userProfile document are
    counted in appsSnap.size (logged) but excluded from totalAppsToday.
    → Display shows lower number than actual applications in Firestore.

  Bug C (Apps without ownerUid): Apps missing ownerUid are excluded from
    per-user counts silently. appsSnap.size includes them, but counts don't.

  Bug D (Local time parse): new Date(dateStr + "T00:00:00") uses server local
    time for date arithmetic. If server TZ ≠ UTC, the day rollback and nextDay
    calculations can be off by a day, shifting the entire query window.
    → Safe fix: use dateStr + "T00:00:00Z" and setUTCDate() instead.
`);

process.exit(failed > 0 ? 1 : 0);
