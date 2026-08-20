/**
 * Streak logic tests.
 * Run: npx tsx tests/streak.test.ts   (part of `npm test`)
 *
 * Exercises currentStreak() from lib/job-utils.ts: consecutive-day counting,
 * backfill, duplicates, gaps that break a streak, and the "still alive" rule
 * when today hasn't recorded an application yet.
 */
import assert from "node:assert/strict";
import { currentStreak } from "@/lib/job-utils";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

console.log("\n── currentStreak ──");

test("no dates → 0", () => {
  assert.equal(currentStreak([], new Date("2026-08-20T12:00:00")), 0);
});

test("only unused/junk dates → 0", () => {
  assert.equal(currentStreak([""], new Date("2026-08-20T12:00:00")), 0);
  assert.equal(currentStreak(["not-a-date"], new Date("2026-08-20T12:00:00")), 0);
});

test("today only → 1", () => {
  assert.equal(currentStreak(["2026-08-20"], new Date("2026-08-20T12:00:00")), 1);
});

test("today's app plus full backward run → 6", () => {
  const dates = ["2026-08-20", "2026-08-19", "2026-08-18", "2026-08-17", "2026-08-16", "2026-08-15"];
  assert.equal(currentStreak(dates, new Date("2026-08-20T23:59:00")), 6);
});

test("backfilled batch with a gap → counts only the contiguous tail", () => {
  // 2026-08-16 is missing, so the run ends there; streak = 4 (20,19,18,17)
  const dates = ["2026-08-20", "2026-08-19", "2026-08-18", "2026-08-17", "2026-08-15", "2026-07-30"];
  assert.equal(currentStreak(dates, new Date("2026-08-20T12:00:00")), 4);
});

test("no app today but streak alive through yesterday → keeps counting", () => {
  const dates = ["2026-08-19", "2026-08-18", "2026-08-17"];
  assert.equal(currentStreak(dates, new Date("2026-08-20T12:00:00")), 3);
});

test("streak broken (skipped a full day) → 0 when yesterday is missing", () => {
  const dates = ["2026-08-18", "2026-08-17", "2026-08-15"];
  assert.equal(currentStreak(dates, new Date("2026-08-20T12:00:00")), 0);
});

test("multiple apps on the same day count as one day", () => {
  const dates = ["2026-08-20", "2026-08-20", "2026-08-19", "2026-08-18"];
  assert.equal(currentStreak(dates, new Date("2026-08-20T12:00:00")), 3);
});

test("rolls across month boundary", () => {
  const dates = ["2026-08-01", "2026-07-31", "2026-07-30", "2026-07-29"];
  assert.equal(currentStreak(dates, new Date("2026-08-01T12:00:00")), 4);
});

test("rolls across year boundary", () => {
  const dates = ["2026-01-01", "2025-12-31", "2025-12-30"];
  assert.equal(currentStreak(dates, new Date("2026-01-01T12:00:00")), 3);
});

test("junk entries are ignored, valid ones still count", () => {
  const dates = ["2026-08-20", "nope", "", "2026-08-19", "2026-08-18", "2026-08-17"];
  assert.equal(currentStreak(dates, new Date("2026-08-20T12:00:00")), 4);
});

console.log(`\n${failed === 0 ? "✓" : "✗"} ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);