import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "dev-secret";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function checkSecret(req: Request): boolean {
  const secret = req.headers.get("x-internal-secret");
  return secret === INTERNAL_SECRET;
}

// GET: Return all users with leetcodeRepoUrl for sync (internal only)
export async function GET(req: Request) {
  if (!checkSecret(req)) {
    return fail(403, "Forbidden");
  }

  try {
    const profiles = await adminDb.collection("userProfiles").get();
    const users: Array<{ uid: string; repoUrl: string; lastSyncedAt: string | null }> = [];

    profiles.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const repoUrl = (data.leetcodeRepoUrl || "") as string;
      if (repoUrl) {
        const lastSynced = data.leetcodeLastSyncedAt;
        users.push({
          uid: doc.id,
          repoUrl,
          lastSyncedAt: lastSynced ? (lastSynced as Timestamp).toDate().toISOString() : null,
        });
      }
    });

    return NextResponse.json({ ok: true, users });
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
    const batch = adminDb.batch();
    const userRef = adminDb.collection("userProfiles").doc(uid);
    batch.update(userRef, { leetcodeLastSyncedAt: FieldValue.serverTimestamp() });

    for (const p of body.problems) {
      const ref = userRef.collection("leetcodeProblems").doc(p.problemId);
      batch.set(ref, {
        problemId: p.problemId,
        title: p.title,
        difficulty: p.difficulty,
        language: p.language,
        commitHash: p.commitHash,
        solvedAt: p.solvedAt,
        syncedAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    return NextResponse.json({ ok: true, synced: body.problems.length });
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
