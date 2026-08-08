import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { lcProblems, lcSolvedUser, users } from "@/db/schema";
import { logActivity } from "@/db/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "";

const DIFF_RAW_TO_ENUM: Record<string, "EASY" | "MEDIUM" | "HARD" | "UNKNOWN"> = {
  easy: "EASY",
  medium: "MEDIUM",
  hard: "HARD",
  unknown: "UNKNOWN",
};

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// Fails closed: if the secret isn't configured, no request can pass —
// never fall back to a hardcoded default that could be sent by anyone.
function checkSecret(req: Request): boolean {
  if (!INTERNAL_SECRET) return false;
  const secret = req.headers.get("x-internal-secret");
  return secret === INTERNAL_SECRET;
}

// GET: Return all users with leetcodeRepoUrl for sync (internal only)
export async function GET(req: Request) {
  if (!checkSecret(req)) {
    return fail(403, "Forbidden");
  }

  try {
    const rows = await db
      .select({
        id: users.id,
        repoUrl: users.leetcodeRepoUrl,
        lastSyncedAt: users.leetcodeLastSyncedAt,
      })
      .from(users);

    const usersList: Array<{ uid: string; repoUrl: string; lastSyncedAt: string | null }> = [];
    rows.forEach((u) => {
      const repoUrl = u.repoUrl || "";
      if (repoUrl) {
        usersList.push({
          uid: u.id,
          repoUrl,
          lastSyncedAt: u.lastSyncedAt ? u.lastSyncedAt.toISOString() : null,
        });
      }
    });

    return NextResponse.json({ ok: true, users: usersList });
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

// POST: Receive sync data from cron service (internal only)
export async function POST(req: Request) {
  if (!checkSecret(req)) {
    return fail(403, "Forbidden");
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      uid?: string;
      userName?: string;
      problems?: Array<{
        problemId: string;
        title: string;
        difficulty: string;
        language: string;
        commitHash: string;
        solvedAt: string;
      }>;
    };

    if (!body.uid || !Array.isArray(body.problems)) {
      return fail(400, "Missing uid or problems array");
    }

    const uid = body.uid;
    const problems = body.problems;

    await db.transaction(async (tx) => {
      // Update user's last synced timestamp
      await tx.update(users).set({ leetcodeLastSyncedAt: new Date() }).where(eq(users.id, uid));

      // Upsert each solve (problem metadata + per-solve record) and log it
      for (const p of problems) {
        const solvedAt = new Date(p.solvedAt);
        const problemDifficulty = p.difficulty ? DIFF_RAW_TO_ENUM[p.difficulty] ?? null : null;

        await tx
          .insert(lcProblems)
          .values({
            problemId: p.problemId,
            problemName: p.title,
            problemDifficulty,
          })
          .onConflictDoUpdate({
            target: lcProblems.problemId,
            set: {
              problemName: sql`${p.title}`,
              problemDifficulty: sql`${problemDifficulty ?? null}`,
            },
          });

        await tx
          .insert(lcSolvedUser)
          .values({
            userId: uid,
            problemId: p.problemId,
            solvedAt,
            languageUsed: p.language,
            commitHash: p.commitHash,
          })
          .onConflictDoUpdate({
            target: [lcSolvedUser.userId, lcSolvedUser.problemId],
            set: {
              solvedAt: sql`${solvedAt}`,
              languageUsed: sql`${p.language ?? null}`,
              commitHash: sql`${p.commitHash ?? null}`,
            },
          });

        await logActivity(tx, {
          userId: uid,
          type: "LC_SOLVED",
          problemId: p.problemId,
          occuredAt: solvedAt,
        });
      }
    });

    return NextResponse.json({ ok: true, synced: body.problems.length });
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}