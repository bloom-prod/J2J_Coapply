import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_API_BASE = "https://api.github.com";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function parseRepoURL(raw: string): [string, string] {
  const cleaned = raw.replace(/\.git$/, "").replace(/\/$/, "");
  const match = cleaned.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (match) return [match[1], match[2]];
  return ["", ""];
}

interface StatsJSON {
  leetcode: {
    shas: Record<string, Record<string, unknown>>;
  };
}

async function fetchStatsJSON(owner: string, repo: string): Promise<StatsJSON | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/stats.json`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "bloom-tracker" } });
    if (!res.ok) return null;
    return (await res.json()) as StatsJSON;
  } catch {
    return null;
  }
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { date: string };
  };
}

async function fetchCommits(owner: string, repo: string, since?: string): Promise<GitHubCommit[]> {
  let url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?per_page=100`;
  if (since) url += `&since=${encodeURIComponent(since)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "bloom-tracker",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }
  return (await res.json()) as GitHubCommit[];
}

function parseCommitMessage(msg: string): { problemId: string; title: string } | null {
  const cleaned = msg
    .replace(/\s+- LeetHub$/i, "")
    .replace(/\s+- LeetSync$/i, "")
    .split("\n")[0];

  // Split on Stats: Time: |
  const parts = cleaned.split(/(?:Stats:|Time:|\|)/i);
  const ident = parts[0].trim();
  if (!ident) return null;

  const problemId = ident.toLowerCase();

  // Extract title from problem ID (e.g. "0026-remove-duplicates..." -> "Remove Duplicates From Sorted Array")
  const titlePart = ident
    .replace(/^\d+-/, "")
    .replace(/-/g, " ");
  const title = titlePart.replace(/\b\w/g, (c) => c.toUpperCase());

  return { problemId, title };
}

const EXT_TO_LANG: Record<string, string> = {
  cpp: "C++", cc: "C++", cxx: "C++", "c++": "C++",
  py: "Python", py3: "Python",
  java: "Java",
  js: "JavaScript", jsx: "JavaScript",
  ts: "TypeScript", tsx: "TypeScript",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  cs: "C#",
  swift: "Swift",
  kt: "Kotlin",
  php: "PHP",
  c: "C",
  r: "R",
  scala: "Scala",
  dart: "Dart",
};

function detectLanguage(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) return "Unknown";
  const ext = fileName.slice(dotIndex + 1).toLowerCase();
  return EXT_TO_LANG[ext] || ext[0].toUpperCase() + ext.slice(1);
}

interface ProblemMeta {
  difficulty: string;
  language: string;
}

function buildProblemMeta(stats: StatsJSON): Map<string, ProblemMeta> {
  const map = new Map<string, ProblemMeta>();
  for (const [pid, files] of Object.entries(stats.leetcode.shas)) {
    if (pid === "README.md" || pid === "stats.json") continue;
    let difficulty = "";
    let language = "";
    for (const [key, val] of Object.entries(files)) {
      if (key.toLowerCase() === "difficulty" && typeof val === "string") {
        difficulty = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
      } else if (key.startsWith(pid) && key.includes(".")) {
        language = detectLanguage(key);
      }
    }
    if (difficulty && language) {
      map.set(pid, { difficulty, language });
    }
  }
  return map;
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);

    // Get user's profile
    const profileRef = adminDb.collection("userProfiles").doc(user.uid);
    const profileSnap = await profileRef.get();
    const profileData = profileSnap.data() as Record<string, unknown> | undefined;
    const repoUrl = (profileData?.leetcodeRepoUrl || "") as string;

    if (!repoUrl) {
      throw new HttpError(400, "No LeetCode repo configured — add one in your Profile");
    }

    const [owner, repo] = parseRepoURL(repoUrl);
    if (!owner || !repo) {
      throw new HttpError(400, "Invalid LeetCode repo URL");
    }

    // Fetch stats.json
    const stats = await fetchStatsJSON(owner, repo);
    if (!stats) {
      throw new HttpError(404, "Could not fetch stats.json — make sure the repo is public and has a stats.json at the root");
    }

    const meta = buildProblemMeta(stats);
    if (meta.size === 0) {
      throw new HttpError(404, "No problems found in stats.json");
    }

    // Determine last sync time
    let since: string | undefined;
    const lastSynced = profileData?.leetcodeLastSyncedAt;
    if (lastSynced) {
      try {
        const ts = (lastSynced as { toDate: () => Date }).toDate();
        since = ts.toISOString();
      } catch {
        /* ignore */
      }
    }

    // Fetch commits from GitHub
    const commits = await fetchCommits(owner, repo, since);
    if (commits.length === 0) {
      return NextResponse.json({ ok: true, synced: 0, message: "No new commits since last sync" });
    }

    // Parse commits into problems
    const seen = new Set<string>();
    const newProblems: Array<{
      problemId: string;
      title: string;
      difficulty: string;
      language: string;
      commitHash: string;
      solvedAt: string;
    }> = [];

    for (const c of commits) {
      const parsed = parseCommitMessage(c.commit.message);
      if (!parsed) continue;
      if (seen.has(parsed.problemId)) continue;
      seen.add(parsed.problemId);

      const m = meta.get(parsed.problemId);
      if (!m) continue; // Skip if not in stats.json

      newProblems.push({
        problemId: parsed.problemId,
        title: parsed.title,
        difficulty: m.difficulty,
        language: m.language,
        commitHash: c.sha,
        solvedAt: c.commit.author.date,
      });
    }

    if (newProblems.length === 0) {
      // Still update last synced even if no new problems
      await profileRef.update({ leetcodeLastSyncedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ ok: true, synced: 0, message: "No new LeetCode problems found" });
    }

    // Write to Firestore using batch
    const batch = adminDb.batch();
    batch.update(profileRef, { leetcodeLastSyncedAt: FieldValue.serverTimestamp() });

    for (const p of newProblems) {
      const ref = profileRef.collection("leetcodeProblems").doc(p.problemId);
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

    return NextResponse.json({
      ok: true,
      synced: newProblems.length,
      message: `Synced ${newProblems.length} new problem(s)`,
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
