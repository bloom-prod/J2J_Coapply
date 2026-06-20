import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_API_BASE = "https://api.github.com";
const RAW_GITHUB = "https://raw.githubusercontent.com";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function parseRepoURL(raw: string): [string, string] {
  const cleaned = raw.replace(/\.git$/, "").replace(/\/$/, "");
  const match = cleaned.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (match) return [match[1], match[2]];
  return ["", ""];
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

/* ─── GitHub Tree API ──────────────────────────── */

interface TreeItem {
  path: string;
  type: string;
}

async function fetchGitTree(owner: string, repo: string): Promise<TreeItem[]> {
  // Try main first, then master
  for (const branch of ["main", "master"]) {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "bloom-tracker",
        },
      });
      if (res.ok) {
        const data = (await res.json()) as { tree?: TreeItem[] };
        return data.tree || [];
      }
    } catch {
      /* fall through to next branch */
    }
  }
  throw new Error("Could not fetch git tree — check that the repo is public");
}

interface StatsJsonShas {
  [folder: string]: {
    difficulty?: string;
    [key: string]: unknown;
  };
}

async function fetchStatsJson(owner: string, repo: string): Promise<Record<string, string>> {
  // Try main first, then master
  for (const branch of ["main", "master"]) {
    const url = `${RAW_GITHUB}/${owner}/${repo}/${branch}/stats.json`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "bloom-tracker",
        },
      });
      if (res.ok) {
        const data = await res.json() as { leetcode?: { shas?: StatsJsonShas } };
        const difficultyMap: Record<string, string> = {};
        const shas = data?.leetcode?.shas || {};
        for (const [folder, info] of Object.entries(shas)) {
          if (info && typeof info === "object" && info.difficulty) {
            difficultyMap[folder] = info.difficulty.toLowerCase();
          }
        }
        return difficultyMap;
      }
    } catch {
      /* fall through to next branch */
    }
  }
  // Return empty map if stats.json not found or parse failed
  return {};
}

function buildLanguageMap(tree: TreeItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of tree) {
    if (item.type !== "blob") continue;
    const path = item.path;
    // Skip root-level files (README.md, stats.json, etc.)
    if (!path.includes("/")) continue;

    const parts = path.split("/");
    if (parts.length < 2) continue;

    const folder = parts[0]; // e.g., "0001-two-sum"
    const file = parts[1];   // e.g., "0001-two-sum.cpp"

    // Only process solution files, skip README.md / stats.json
    if (file === "README.md" || file === "stats.json") continue;
    if (!file.includes(".")) continue;

    // Map folder (problem ID) to language
    if (!map.has(folder)) {
      map.set(folder, detectLanguage(file));
    }
  }
  return map;
}

/* ─── GitHub Commits API ──────────────────────────── */

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
      Accept: "application/vnd.github+json",
      "User-Agent": "bloom-tracker",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub commits API ${res.status}: ${body}`);
  }
  return (await res.json()) as GitHubCommit[];
}

/** Parse the problem identifier from a LeetHub / LeetSync commit message. */
function parseCommitMessage(msg: string): { problemId: string; title: string } | null {
  const cleaned = msg
    .replace(/\s+- LeetHub$/i, "")
    .replace(/\s+- LeetSync$/i, "")
    .split("\n")[0]
    .trim();

  if (!cleaned) return null;

  // Everything before Stats: / Time: / |
  const ident = cleaned.split(/(?:Stats:|Time:|\|)/i)[0].trim();
  if (!ident) return null;

  // Handle "Create " prefix from LeetHub
  let problemId = ident.toLowerCase();
  problemId = problemId.replace(/^create\s+/, "");

  // Convert "number. title" format to "number-title" format to match folder names
  // e.g., "2163. kth distinct string in an array" -> "2163-kth-distinct-string-in-an-array"
  problemId = problemId
    .replace(/^(\d+)\.\s*/, "$1-")  // Replace "2163. " with "2163-"
    .replace(/\s+/g, "-");            // Replace spaces with hyphens

  // Derive title from the slug
  const titleRaw = problemId
    .replace(/^\d+-/, "")
    .replace(/-/g, " ");
  const title = titleRaw.replace(/\b\w/g, (c) => c.toUpperCase());

  return { problemId, title };
}

/* ─── Main handler ──────────────────────────── */

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);

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

    // Check if this is a forced refresh (from button click)
    const body = await req.json().catch(() => ({})) as { force?: boolean };
    const forceRefresh = body?.force === true;

    // 1) Fetch stats.json FIRST (source of truth for problems + difficulties)
    const difficultyMap = await fetchStatsJson(owner, repo);
    const problemIds = Object.keys(difficultyMap).filter(id => id !== "README.md");
    
    if (problemIds.length === 0) {
      throw new HttpError(404, "No problems found in stats.json — make sure your LeetCode repo has a stats.json file");
    }

    // 2) Fetch git tree → language per problem
    const tree = await fetchGitTree(owner, repo);
    const languageMap = buildLanguageMap(tree);

    // 3) Determine since date (optional — for incremental sync)
    let since: string | undefined;
    if (!forceRefresh) {
      const lastSynced = profileData?.leetcodeLastSyncedAt;
      if (lastSynced) {
        try {
          const ts = (lastSynced as { toDate: () => Date }).toDate();
          since = ts.toISOString();
        } catch {
          /* ignore */
        }
      }
    }

    // 4) Fetch commits → build date map by problemId
    const commits = await fetchCommits(owner, repo, since);
    const dateMap = new Map<string, { date: string; hash: string }>();

    for (const c of commits) {
      const parsed = parseCommitMessage(c.commit.message);
      if (!parsed) continue;

      // Only record the first (most recent) commit for each problem
      if (!dateMap.has(parsed.problemId)) {
        dateMap.set(parsed.problemId, {
          date: c.commit.author.date,
          hash: c.sha,
        });
      }
    }

    // Fallback date: most recent commit (used when commit message format doesn't match)
    const fallbackDate = commits.length > 0 ? commits[0].commit.author.date : new Date().toISOString();

    // 5) Build problem list from stats.json (source of truth)
    const newProblems: Array<{
      problemId: string;
      title: string;
      difficulty: string;
      language: string;
      commitHash: string;
      solvedAt: string;
    }> = [];

    for (const problemId of problemIds) {
      // Get language from git tree (required — must have a solution file)
      const lang = languageMap.get(problemId);
      if (!lang) continue;

      const dateInfo = dateMap.get(problemId);
      // On incremental sync, skip problems with no recent commit (already stored from prior sync)
      if (!dateInfo && !forceRefresh) continue;

      // Derive title from problemId
      const titleRaw = problemId
        .replace(/^\d+-/, "")
        .replace(/-/g, " ");
      const title = titleRaw.replace(/\b\w/g, (c) => c.toUpperCase());

      newProblems.push({
        problemId,
        title,
        difficulty: difficultyMap[problemId] || "unknown",
        language: lang,
        commitHash: dateInfo?.hash ?? "",
        solvedAt: dateInfo?.date ?? fallbackDate,
      });
    }

    if (newProblems.length === 0) {
      await profileRef.update({ leetcodeLastSyncedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ ok: true, synced: 0, message: "No new LeetCode problems found" });
    }

    // 6) Write to Firestore
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
