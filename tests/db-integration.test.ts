/**
 * DB integration tests.
 *
 * Runs the project's real Postgres queries against every table the app uses
 * (applications, application_user_status, activity_log, daily_roasts, jobboard,
 * interview_prep, ivp_comments, resumes, resume_comments, lc_problems,
 * lc_solved_user, password_resets, users) plus the subtle domain logic the
 * routes encode (sticky funnel flags, shame-wall day accounting, name-cache
 * invalidation, and the FK/cascade constraints).
 *
 * Everything runs inside a single transaction that is ROLLED BACK, so no test
 * data persists. Safe against a staging DB; also verifies the schema + queries
 * work end-to-end with the real `@/db/activity` helpers and enums.
 *
 * Setup (staging Postgres, e.g. Neon):
 *   DATABASE_URL=<staging-url> npx drizzle-kit migrate   # apply migrations
 *   TEST_DATABASE_URL=<staging-url> npm run test:db
 *
 * Run:  npm run test:db
 */
import assert from "node:assert/strict";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, desc, and, isNull } from "drizzle-orm";
import {
  users,
  applications,
  applicationUserStatus,
  activityLog,
  dailyRoasts,
  jobboard,
  interviewPrep,
  ivpComments,
  resumes,
  resumeComments,
  lcProblems,
  lcSolvedUser,
  passwordResets,
} from "@/db/schema";
import { logActivity, namesByIds, clearNameCache, invalidateName } from "@/db/activity";
import { statusToEnum, enumToStatus, priorityToEnum, roleCategoryToEnum } from "@/lib/enums";
import { reachedFlagsForStatus, type ReachedFlag } from "@/lib/types";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("[db-integration] Set TEST_DATABASE_URL (or DATABASE_URL) to run DB integration tests.");
  process.exit(2);
}

const sql = postgres(url, { max: 2 });
const db = drizzle(sql, { schema: { users, applications, applicationUserStatus, activityLog, dailyRoasts, jobboard, interviewPrep, ivpComments, resumes, resumeComments, lcProblems, lcSolvedUser, passwordResets } });

const results: { name: string; ok: boolean; error?: string }[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    results.push({ name, ok: true });
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.error(`      ${(e as Error).message}`);
    results.push({ name, ok: false, error: (e as Error).message });
  }
}
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    results.push({ name, ok: true });
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string; code?: string }; code?: string };
    const detail = err.cause?.message ? ` | cause: ${err.cause.message}${err.cause.code ? ` (${err.cause.code})` : ""}` : "";
    console.log(`  ✗ ${name}`);
    console.error(`      ${err.message}${detail}`);
    results.push({ name, ok: false, error: `${err.message}${detail}` });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;
const NOW = new Date();
const uniq = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function makeUser(tx: Tx, email: string) {
  const [u] = await tx.insert(users).values({ email, name: email.split("@")[0], isAdmin: false, approved: true }).returning();
  return u!;
}
async function makeApp(tx: Tx, uid: string, status: string | undefined, createdAt = NOW) {
  const [a] = await tx
    .insert(applications)
    .values({
      company: "Acme", role: "SWE", applicantId: uid, starred: false,
      priority: priorityToEnum("Medium") ?? "MEDIUM",
      roleCategory: roleCategoryToEnum("AI Engineering"),
      status: status ? statusToEnum(status)! : undefined,
      createdAt, updatedAt: createdAt,
    })
    .returning();
  return a!;
}
async function addStatus(tx: Tx, appId: string, uid: string, status: string, changedAt: Date) {
  await tx.insert(applicationUserStatus).values({ applicationId: appId, changedById: uid, status: statusToEnum(status)!, changedAt });
}

async function run(tx: Tx) {
  // ── Core round-trip across the main relations ──────────────────────────
  await testAsync("insert+select users/applications/application_user_status round-trip", async () => {
    const u = await makeUser(tx, uniq("roundtrip") + "@test.dev");
    const app = await makeApp(tx, u.id, "Applied");
    await addStatus(tx, app.applicationId, u.id, "Applied", NOW);

    const [back] = await tx.select().from(applications).where(eq(applications.applicationId, app.applicationId));
    assert(back, "application should be selectable");
    assert.strictEqual(enumToStatus(back.status), "Applied");
    assert.strictEqual(back.applicantId, u.id);
    assert.strictEqual(back.priority, priorityToEnum("Medium"));
    assert.strictEqual(back.roleCategory, roleCategoryToEnum("AI Engineering"));

    const statuses = await tx.select().from(applicationUserStatus).where(eq(applicationUserStatus.applicationId, app.applicationId));
    assert.strictEqual(statuses.length, 1);
    assert.strictEqual(enumToStatus(statuses[0]!.status), "Applied");
  });

  // ── Sticky funnel flags recovered from the status log (#13) ────────────
  await testAsync("sticky funnel flags from status history (Applied→Interview→Rejected)", async () => {
    const u = await makeUser(tx, uniq("funnel") + "@test.dev");
    const app = await makeApp(tx, u.id, "Rejected");
    for (const [s, at] of [
      ["Applied", new Date(NOW.getTime() - 3600e3)],
      ["Interview", new Date(NOW.getTime() - 1800e3)],
      ["Rejected", NOW],
    ] as const) {
      await addStatus(tx, app.applicationId, u.id, s, at);
    }
    const rows = await tx.select({ s: applicationUserStatus.status }).from(applicationUserStatus).where(eq(applicationUserStatus.applicationId, app.applicationId));
    const flags: Partial<Record<ReachedFlag, boolean>> = {};
    for (const r of rows) {
      const disp = enumToStatus(r.s);
      if (disp) Object.assign(flags, reachedFlagsForStatus(disp));
    }
    assert.strictEqual(flags.reachedApplied, true, "reachedApplied should be sticky");
    assert.strictEqual(flags.reachedInterview, true, "reachedInterview sticky past Rejected");
    assert.strictEqual(flags.reachedOA, undefined, "OA never reached (skipped)");
    assert.strictEqual(flags.reachedOffer, undefined, "Offer not reached");
  });

  // ── Shame-wall daily accounting (#12) ──────────────────────────────────
  await testAsync("shame wall counts the day an app first left 'Want to Apply'", async () => {
    const u = await makeUser(tx, uniq("shame") + "@test.dev");
    const start = new Date(NOW.getTime() - 12 * 3600e3);
    const end = new Date(NOW.getTime() + 12 * 3600e3);
    const yesterday = new Date(NOW.getTime() - 26 * 3600e3);
    const today = new Date(NOW.getTime() - 2 * 3600e3);

    const flipped = await makeApp(tx, u.id, "Want to Apply", yesterday);
    await addStatus(tx, flipped.applicationId, u.id, "Want to Apply", yesterday);
    await addStatus(tx, flipped.applicationId, u.id, "Applied", today); // real flip today

    const bookmark = await makeApp(tx, u.id, "Want to Apply", today);
    await addStatus(tx, bookmark.applicationId, u.id, "Want to Apply", today); // still wishlist

    const direct = await makeApp(tx, u.id, "Applied", today);
    await addStatus(tx, direct.applicationId, u.id, "Applied", today);

    const rows = await tx.select().from(applicationUserStatus).where(eq(applicationUserStatus.changedById, u.id));
    const firstReal = new Map<string, { at: number }>();
    for (const r of rows) {
      if (r.status === statusToEnum("Want to Apply")) continue;
      const at = new Date(r.changedAt).getTime();
      const ex = firstReal.get(r.applicationId);
      if (!ex || at < ex.at) firstReal.set(r.applicationId, { at });
    }
    const count = [...firstReal.values()].filter((v) => v.at >= start.getTime() && v.at < end.getTime()).length;
    assert.strictEqual(count, 2, "flipped + direct count today; bookmark does not");
  });

  // ── Real db/activity helpers (logActivity + namesByIds + invalidation) ─
  await testAsync("logActivity inserts + namesByIds resolves + invalidateName drops cache", async () => {
    clearNameCache();
    const u = await makeUser(tx, uniq("activity") + "@test.dev");
    await logActivity(tx, { userId: u.id, type: "APPLIED", company: "Acme", role: "SWE", status: "Applied", occuredAt: NOW });
    const acts = await tx.select().from(activityLog).where(eq(activityLog.userId, u.id));
    assert.strictEqual(acts.length, 1);

    assert.strictEqual((await namesByIds(tx, [u.id]))[u.id], u.name);
    await tx.update(users).set({ name: "Toastmaster", updatedAt: new Date() }).where(eq(users.id, u.id));
    invalidateName(u.id);
    assert.strictEqual((await namesByIds(tx, [u.id]))[u.id], "Toastmaster");
  });

  // ── Jobboard (community shares) ────────────────────────────────────────
  await testAsync("jobboard insert / newest-first list / delete", async () => {
    const u = await makeUser(tx, uniq("jb") + "@test.dev");
    await tx.insert(jobboard).values({ postedBy: u.id, company: "Stripe", jobRole: "Eng", jobUrl: "https://x", jobLocation: "Remote", createdAt: NOW }).returning();
    const older = await tx.insert(jobboard).values({ postedBy: u.id, company: "Older", jobRole: "Eng", jobUrl: "https://y", createdAt: new Date(NOW.getTime() - 3600e3) }).returning();
    const rows = await tx.select().from(jobboard).where(eq(jobboard.postedBy, u.id)).orderBy(desc(jobboard.createdAt));
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0]!.company, "Stripe", "newest first");
    await tx.delete(jobboard).where(eq(jobboard.postId, older[0]!.postId));
    assert.strictEqual((await tx.select().from(jobboard).where(eq(jobboard.postedBy, u.id))).length, 1);
  });

  // ── Interview prep + its comments (comments require an existing post) ──
  await testAsync("interview_prep insert/delete + ivp_comments insert/select", async () => {
    const u = await makeUser(tx, uniq("ivp") + "@test.dev");
    const [post] = await tx.insert(interviewPrep).values({ creatorId: u.id, postTitle: "How to system design", postContent: "notes", company: "general", createdAt: NOW, updatedAt: NOW }).returning();
    await tx.insert(ivpComments).values({ commentedOn: post.postId, commentedBy: u.id, commentContent: "nice", commentDate: NOW });
    const comments = await tx.select().from(ivpComments).where(eq(ivpComments.commentedOn, post.postId));
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0]!.commentContent, "nice");
    await tx.delete(interviewPrep).where(eq(interviewPrep.postId, post.postId));
    // ivp_comments.commented_on cascades with the post.
    assert.strictEqual((await tx.select().from(ivpComments).where(eq(ivpComments.commentedOn, post.postId))).length, 0);
  });

  // ── Resumes + their comments (comment cascade, activity set-null) ──────
  await testAsync("resumes insert/delete + resume_comments cascade", async () => {
    const u = await makeUser(tx, uniq("resume") + "@test.dev");
    const [res] = await tx.insert(resumes).values({ userId: u.id, filePath: "resumes/x.pdf", fileName: "cv.pdf", resumeTitle: "CV", createdAt: NOW }).returning();
    const [c] = await tx.insert(resumeComments).values({ resumeId: res.resumeId, commenterId: u.id, comment: "looks good", resolvedStatus: false }).returning();
    assert.strictEqual((await tx.select().from(resumeComments).where(eq(resumeComments.commentId, c.commentId))).length, 1);
    await tx.delete(resumes).where(eq(resumes.resumeId, res.resumeId));
    assert.strictEqual((await tx.select().from(resumeComments).where(eq(resumeComments.resumeId, res.resumeId))).length, 0, "comments cascade on resume delete");
  });

  // ── Application date clears (PUT must send null, not "") ─────────────
  await testAsync("applications update clears date columns with null", async () => {
    const u = await makeUser(tx, uniq("dates") + "@test.dev");
    const app = await makeApp(tx, u.id, "Applied");
    await tx
      .update(applications)
      .set({ followUp: null, appliedDate: null, updatedAt: new Date() })
      .where(eq(applications.applicationId, app.applicationId));
    const [row] = await tx.select().from(applications).where(eq(applications.applicationId, app.applicationId));
    assert.strictEqual(row!.followUp, null);
    assert.strictEqual(row!.appliedDate, null);
  });

  // ── LeetCode upserts (idempotent re-write; same pattern as /api/leetcode/refresh) ─
  await testAsync("lc_problems + lc_solved_user upsert are idempotent", async () => {
    const u = await makeUser(tx, uniq("lc") + "@test.dev");
    const insert = () =>
      tx
        .insert(lcProblems)
        .values({ problemId: "two-sum", problemName: "Two Sum", problemDifficulty: "EASY" })
        .onConflictDoUpdate({ target: lcProblems.problemId, set: { problemName: "Two Sum", problemDifficulty: "EASY" } });
    await insert();
    await insert(); // second write exercises the onConflict path
    const [p] = await tx.select().from(lcProblems).where(eq(lcProblems.problemId, "two-sum"));
    assert(p, "problem should exist after upsert");
    assert.strictEqual(p.problemName, "Two Sum");

    const solved = () =>
      tx
        .insert(lcSolvedUser)
        .values({ userId: u.id, problemId: "two-sum", solvedAt: NOW, languageUsed: "ts", commitHash: "abc" })
        .onConflictDoUpdate({ target: [lcSolvedUser.userId, lcSolvedUser.problemId], set: { solvedAt: NOW, languageUsed: "ts", commitHash: "abc" } });
    await solved();
    await solved();
    assert.strictEqual((await tx.select().from(lcSolvedUser).where(eq(lcSolvedUser.userId, u.id))).length, 1, "no dup rows after re-upsert");
  });

  // ── daily_roasts upsert (the #8a regression: second write must not throw) ─
  await testAsync("daily_roasts upsert survives a second write for same (date,user)", async () => {
    const u = await makeUser(tx, uniq("roast") + "@test.dev");
    const date = NOW.toISOString().slice(0, 10);
    const write = () =>
      tx
        .insert(dailyRoasts)
        .values({ roastDate: date, userId: u.id, roastText: "lazy", appsCount: 1, generatedAt: new Date() })
        .onConflictDoUpdate({ target: [dailyRoasts.roastDate, dailyRoasts.userId], set: { roastText: "lazy", appsCount: 1, generatedAt: new Date() } });
    await write();
    await write(); // ← this was ERR_INVALID_ARG_TYPE before the fix
    const [row] = await tx.select().from(dailyRoasts).where(and(eq(dailyRoasts.userId, u.id), eq(dailyRoasts.roastDate, date)));
    assert(row, "upserted roast row present");
  });

  // ── Password reset flow (#2/#3/#4): insert → latest-unused lookup → use ──
  await testAsync("password_resets insert → latest unused lookup → mark used", async () => {
    const email = uniq("reset") + "@test.dev";
    const now = new Date();
    await tx.insert(passwordResets).values({ email, otpHash: "h1", expiresAt: new Date(now.getTime() + 15 * 60 * 1000), createdAt: new Date(now.getTime() - 60000) });
    await tx.insert(passwordResets).values({ email, otpHash: "h2", expiresAt: new Date(now.getTime() + 15 * 60 * 1000), createdAt: now });
    const [latest] = await tx
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.email, email), isNull(passwordResets.usedAt)))
      .orderBy(desc(passwordResets.createdAt));
    assert(latest, "latest unused reset row");
    assert.strictEqual(latest.otpHash, "h2", "most recent code wins");
    await tx.update(passwordResets).set({ usedAt: now }).where(eq(passwordResets.id, latest.id));
    const [after] = await tx.select().from(passwordResets).where(and(eq(passwordResets.email, email), isNull(passwordResets.usedAt)));
    assert.strictEqual(after?.otpHash, "h1", "only the older unused one remains");
  });

  // ── Feed query (newest activity + name resolution) ─────────────────────
  await testAsync("feed: newest activity_log + name resolution", async () => {
    clearNameCache();
    const u = await makeUser(tx, uniq("feed") + "@test.dev");
    await logActivity(tx, { userId: u.id, type: "JOB_SHARE", company: "Coinbase", occuredAt: new Date(NOW.getTime() - 5000) });
    await logActivity(tx, { userId: u.id, type: "APPLIED", company: "Airbnb", status: "Applied", occuredAt: NOW });
    const rows = await tx.select().from(activityLog).orderBy(desc(activityLog.occuredAt)).limit(10);
    assert.strictEqual(rows[0]!.company, "Airbnb", "newest first");
    const name = await namesByIds(tx, rows.map((r: { userId: string }) => r.userId));
    assert(name[u.id], u.name);
  });

  // ── Community applications list shape (used by /api/applications GET) ──
  await testAsync("applications community list with sticky flags + names", async () => {
    const u = await makeUser(tx, uniq("list") + "@test.dev");
    const app = await makeApp(tx, u.id, "Applied");
    await addStatus(tx, app.applicationId, u.id, "Applied", NOW);
    const apps = await tx.select().from(applications).orderBy(desc(applications.createdAt));
    const appRow = apps.find((a: { applicationId: string }) => a.applicationId === app.applicationId)!;
    assert.strictEqual(enumToStatus(appRow.status), "Applied");
    assert.strictEqual(appRow.starred, false);
    const names = await namesByIds(tx, apps.map((a: { applicantId: string }) => a.applicantId));
    assert.strictEqual(names[u.id], u.name);
  });

  // ── Profile / users update (used by PUT /api/profile and admin) ────────
  await testAsync("users update profile fields + name invalidation", async () => {
    const u = await makeUser(tx, uniq("profile") + "@test.dev");
    await tx.update(users).set({ githubUrl: "https://github.com/x", updatedAt: new Date() }).where(eq(users.id, u.id));
    const [row] = await tx.select().from(users).where(eq(users.id, u.id));
    assert.strictEqual(row!.githubUrl, "https://github.com/x");
  });

  // ── Cascade: deleting an application removes its status rows ───────────
  await testAsync("deleting an application cascades its status rows", async () => {
    const u = await makeUser(tx, uniq("cascade") + "@test.dev");
    const app = await makeApp(tx, u.id, "Applied");
    await addStatus(tx, app.applicationId, u.id, "Applied", NOW);
    await tx.delete(applications).where(eq(applications.applicationId, app.applicationId));
    assert.strictEqual((await tx.select().from(applicationUserStatus).where(eq(applicationUserStatus.applicationId, app.applicationId))).length, 0);
  });

  // ── (must run last) FK: deleting a referenced user errors (no CASCADE) ─
  await testAsync("deleting a user that owns applications errors (FK no-action)", async () => {
    const u = await makeUser(tx, uniq("fk") + "@test.dev");
    await makeApp(tx, u.id, "Applied"); // still references u when we try to delete
    const err = await tx.delete(users).where(eq(users.id, u.id)).catch((e: unknown) => e as { cause?: { code?: string } });
    assert.strictEqual(
      (err as { cause?: { code?: string } }).cause?.code,
      "23503",
      `expected FK violation (23503), got ${(err as { message?: string }).message ?? "no error"}`
    );
  });
}

async function main() {
  console.log(`[db-integration] target DB host: ${(new URL(url!)).host}`);
  console.log("[db-integration] running inside a rollback transaction — nothing persists");

  try {
    const tables = (await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`).map((t) => t.table_name as string);
    const required = ["users", "applications", "application_user_status", "activity_log", "daily_roasts", "jobboard", "resumes", "resume_comments", "interview_prep", "ivp_comments", "lc_problems", "lc_solved_user", "password_resets"];
    test("all core tables exist", () => {
      for (const t of required) assert(tables.includes(t), `${t} missing`);
    });
  } catch (e) {
    test("schema presence (connectivity)", () => {
      throw e as Error;
    });
  }

  try {
    await db.transaction(async (tx) => {
      await run(tx);
      // Force rollback — never persist test data.
      throw new Error("__ROLLBACK__");
    });
  } catch (e) {
    if ((e as Error).message !== "__ROLLBACK__") {
      console.error("[db-integration] suite failed (txn rolled back):", (e as Error).message);
      results.push({ name: "suite", ok: false, error: (e as Error).message });
    }
  }

  await sql.end();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n[db-integration] ${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

void main();