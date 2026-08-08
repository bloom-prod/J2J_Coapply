#!/usr/bin/env node
/**
 * LeetCode force-refresh cron. Runs hourly: for every user with a
 * leetcodeRepoUrl, scrapes GitHub (stats.json + repo tree + commits) and
 * pushes solves into Postgres using the commit timestamps from the repo.
 *
 * Setup:  put DATABASE_URL in cron/sync-leetcode/.env
 * Run:    node cron/sync-leetcode/sync-leetcode.js
 * Cron:   every hour (e.g. `0 * * * *`)
 */

const path = require("path");
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  /* .env optional; vars may come from the process env instead */
}

const postgres = require("postgres");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL in cron/sync-leetcode/.env");
  process.exit(1);
}
const sql = postgres(DATABASE_URL, { max: 5 });

const GITHUB_API_BASE = "https://api.github.com";
const RAW_GITHUB = "https://raw.githubusercontent.com";

// ── GitHub helpers ──────────────────────────────────────────────────────

const EXT_TO_LANG = {
  cpp: "C++", cc: "C++", cxx: "C++", "c++": "C++",
  py: "Python", py3: "Python",
  java: "Java",
  js: "JavaScript", jsx: "JavaScript",
  ts: "TypeScript", tsx: "TypeScript",
  go: "Go", rs: "Rust", rb: "Ruby", cs: "C#",
  swift: "Swift", kt: "Kotlin", php: "PHP", c: "C",
  r: "R", scala: "Scala", dart: "Dart",
};

// stats.json reports lowercase ("easy"); the DB enum is uppercase.
const DIFF_RAW_TO_ENUM = { easy: "EASY", medium: "MEDIUM", hard: "HARD", unknown: "UNKNOWN" };

function detectLanguage(fileName) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) return "Unknown";
  const ext = fileName.slice(dotIndex + 1).toLowerCase();
  return EXT_TO_LANG[ext] || ext[0].toUpperCase() + ext.slice(1);
}

function parseRepoURL(raw) {
  const cleaned = String(raw || "").replace(/\.git$/, "").replace(/\/$/, "");
  const match = cleaned.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (match) return [match[1], match[2]];
  return ["", ""];
}

async function fetchStatsJson(owner, repo) {
  for (const branch of ["main", "master"]) {
    const url = `${RAW_GITHUB}/${owner}/${repo}/${branch}/stats.json`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "bloom-tracker" } });
      if (res.ok) {
        const data = await res.json();
        const difficultyMap = {};
        const shas = data?.leetcode?.shas || {};
        for (const [folder, info] of Object.entries(shas)) {
          if (info && typeof info === "object" && info.difficulty) {
            difficultyMap[folder] = info.difficulty.toLowerCase();
          }
        }
        return difficultyMap;
      }
    } catch {
      /* try next branch */
    }
  }
  return {};
}

async function fetchGitTree(owner, repo) {
  for (const branch of ["main", "master"]) {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "bloom-tracker" },
      });
      if (res.ok) {
        const data = await res.json();
        return data.tree || [];
      }
    } catch {
      /* try next branch */
    }
  }
  throw new Error("Could not fetch git tree — is the repo public?");
}

function buildLanguageMap(tree) {
  const map = new Map();
  for (const item of tree) {
    if (item.type !== "blob") continue;
    const parts = item.path.split("/");
    if (parts.length < 2) continue;
    const folder = parts[0];
    const file = parts[1];
    if (file === "README.md" || file === "stats.json" || !file.includes(".")) continue;
    if (!map.has(folder)) map.set(folder, detectLanguage(file));
  }
  return map;
}

async function fetchCommits(owner, repo) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?per_page=100`;
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "bloom-tracker" },
  });
  if (!res.ok) {
    throw new Error(`GitHub commits API ${res.status}`);
  }
  return res.json();
}

function parseCommitMessage(msg) {
  const cleaned = String(msg || "")
    .replace(/\s+- LeetHub$/i, "")
    .replace(/\s+- LeetSync$/i, "")
    .split("\n")[0]
    .trim();
  if (!cleaned) return null;
  const ident = cleaned.split(/(?:Stats:|Time:|\|)/i)[0].trim();
  if (!ident) return null;
  let problemId = ident.toLowerCase().replace(/^create\s+/, "");
  problemId = problemId
    .replace(/^(\d+)\.\s*/, "$1-")
    .replace(/\s+/g, "-");
  const titleRaw = problemId.replace(/^\d+-/, "").replace(/-/g, " ");
  const title = titleRaw.replace(/\b\w/g, (c) => c.toUpperCase());
  return { problemId, title };
}

// ── Sync one user ───────────────────────────────────────────────────────

async function syncUser(user) {
  const [owner, repo] = parseRepoURL(user.leetcode_repo_url);
  if (!owner || !repo) return { ok: false, error: "Invalid repo URL", problems: 0 };

  try {
    const difficultyMap = await fetchStatsJson(owner, repo);
    const problemIds = Object.keys(difficultyMap).filter((id) => id !== "README.md");
    if (problemIds.length === 0) return { ok: false, error: "No stats.json / no problems", problems: 0 };

    const tree = await fetchGitTree(owner, repo);
    const languageMap = buildLanguageMap(tree);

    const commits = await fetchCommits(owner, repo);
    const dateMap = new Map();
    for (const c of commits) {
      const parsed = parseCommitMessage(c.commit.message);
      if (parsed && !dateMap.has(parsed.problemId)) {
        dateMap.set(parsed.problemId, { date: c.commit.author.date, hash: c.sha });
      }
    }
    const fallbackDate = commits.length > 0 ? commits[0].commit.author.date : new Date().toISOString();

    const solves = [];
    for (const problemId of problemIds) {
      const lang = languageMap.get(problemId);
      if (!lang) continue;
      const dateInfo = dateMap.get(problemId);
      const titleRaw = problemId.replace(/^\d+-/, "").replace(/-/g, " ");
      const title = titleRaw.replace(/\b\w/g, (c) => c.toUpperCase());
      solves.push({
        problemId,
        title,
        difficulty: DIFF_RAW_TO_ENUM[difficultyMap[problemId]] || "UNKNOWN",
        language: lang,
        commitHash: dateInfo?.hash ?? "",
        solvedAt: dateInfo?.date ?? fallbackDate,
      });
    }

    const now = new Date();
    await sql.begin(async (tx) => {
      await tx`UPDATE users SET leetcode_last_synced_at = ${now} WHERE id = ${user.id}`;
      for (const s of solves) {
        await tx`
          INSERT INTO lc_problems (problem_id, problem_name, problem_difficulty)
          VALUES (${s.problemId}, ${s.title}, ${s.difficulty})
          ON CONFLICT (problem_id) DO UPDATE
            SET problem_name = EXCLUDED.problem_name,
                problem_difficulty = EXCLUDED.problem_difficulty`;
        await tx`
          INSERT INTO lc_solved_user (user_id, problem_id, solved_at, language_used, commit_hash)
          VALUES (${user.id}, ${s.problemId}, ${s.solvedAt}, ${s.language}, ${s.commitHash})
          ON CONFLICT (user_id, problem_id) DO UPDATE
            SET solved_at = EXCLUDED.solved_at,
                language_used = EXCLUDED.language_used,
                commit_hash = EXCLUDED.commit_hash`;
      }
    });

    return { ok: true, problems: solves.length };
  } catch (err) {
    return { ok: false, error: err.message, problems: 0 };
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const users = await sql`
    SELECT id, leetcode_repo_url FROM users
    WHERE leetcode_repo_url IS NOT NULL AND leetcode_repo_url <> ''
      AND approved = true AND is_admin = false AND email <> 'system@jobless.local'
    ORDER BY id`;
  console.log(`[sync-leetcode] ${users.length} user(s) with LeetCode repos`);

  let synced = 0;
  let failed = 0;
  for (const u of users) {
    const r = await syncUser(u);
    if (r.ok) {
      synced += r.problems;
      console.log(`  ${String(u.id).slice(0, 8)}… → ${r.problems} problems`);
    } else {
      failed++;
      console.error(`  ${String(u.id).slice(0, 8)}… FAILED: ${r.error}`);
    }
  }

  console.log(`\n[sync-leetcode] Done — synced ${synced} problem(s), ${failed} user(s) failed`);
  await sql.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});