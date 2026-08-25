#!/usr/bin/env node
/**
 * Daily email cron — sends each user a recap of their LAST 24H from
 * activity_log (applications applied, leetcode solves, job shares, status
 * changes) plus job suggestions pulled from the real jobboard.
 *
 * Requires Node 20.6+ (process.loadEnvFile) and uses the repo root's deps
 * (`postgres`, `nodemailer`) — no per-module node_modules.
 *
 * Setup:  put DATABASE_URL + SMTP_* (+ optional OPENROUTER_API_KEY) in cron/daily-email/.env
 * Run:    node cron/daily-email/daily-email.js            (sends email)
 *         node cron/daily-email/daily-email.js --dry-run  (print, don't send)
 * Cron:   schedule daily at ~6 AM EST
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  /* .env optional; vars may come from the process env instead */
}

// ── Shared app log (~/logs/jobless.logs) ────────────────────────────────
// Append JSONL lines to the same file the Next app writes (see lib/logger.ts),
// so cron email activity appears alongside auth/data events. Best-effort and
// never throws; falls back to stderr if the file can't be written.
function logFilePath() {
  const env = process.env.LOG_FILE;
  return env ? env.replace(/^~\//, `${os.homedir()}/`) : `${os.homedir()}/logs/jobless.logs`;
}
const LOG_PATH = logFilePath();
function logEvent(level, event, fields) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    service: "daily-email",
    ...(fields || {}),
  });
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line + "\n");
  } catch (e) {
    console.error(`[daily-email] log write failed: ${e && e.message ? e.message : e}`);
  }
}

const DRY_RUN = process.argv.includes("--dry-run");

const postgres = require("postgres");
const nodemailer = require("nodemailer");

// ── Config ──────────────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_EMAIL = process.env.SMTP_FROM;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL in cron/daily-email/.env");
  process.exit(1);
}
if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !FROM_EMAIL) {
  console.error("Missing SMTP_HOST, SMTP_USER, SMTP_PASS, or SMTP_FROM in .env");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 5 });

// ── Date helpers (6 AM to 6 AM EST) ─────────────────────────────────────

function shiftDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Report window that just closed: 6AM-6AM EST. Before 6 AM EST → two days back. */
function yesterdayEST() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const todayStr = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = parseInt(get("hour"), 10);
  return shiftDateStr(todayStr, hour < 6 ? -2 : -1);
}

function dayRange(dateStr) {
  const ref = new Date(`${dateStr}T12:00:00Z`);
  const refParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(ref);
  const rg = (t) => refParts.find((p) => p.type === t)?.value || "";
  const refLocalDate = `${rg("year")}-${rg("month")}-${rg("day")}`;
  const refLocalHour = parseInt(rg("hour"), 10);
  const refLocalMin = parseInt(rg("minute"), 10);
  const offsetMs =
    new Date(`${refLocalDate}T${String(refLocalHour).padStart(2, "0")}:${String(refLocalMin).padStart(2, "0")}:00Z`).getTime() -
    ref.getTime();

  const dayStart = new Date(`${dateStr}T06:00:00Z`);
  dayStart.setTime(dayStart.getTime() - offsetMs);
  const dayEnd = new Date(`${shiftDateStr(dateStr, 1)}T06:00:00Z`);
  dayEnd.setTime(dayEnd.getTime() - offsetMs);
  return { dayStart, dayEnd };
}

// ── Activity → per-user summary ─────────────────────────────────────────
function summarizeActivity(rows) {
  const byUser = {};
  for (const a of rows) {
    const u = byUser[a.user_id] || (byUser[a.user_id] = { applied: [], solves: 0, shares: 0, statusChanges: 0 });
    switch (a.type) {
      case "APPLIED": u.applied.push(a.company || a.role || "a job"); break;
      case "LC_SOLVED": u.solves++; break;
      case "JOB_SHARE": u.shares++; break;
      case "STATUS":
      case "OFFER":
        u.statusChanges++; break;
    }
  }
  return byUser;
}

function summaryLine(u) {
  const parts = [];
  if (u.applied.length) parts.push(`applied to ${u.applied.length} job${u.applied.length !== 1 ? "s" : ""}${u.applied.length ? ` (${u.applied.slice(0, 5).join(", ")}${u.applied.length > 5 ? "…" : ""})` : ""}`);
  if (u.solves) parts.push(`solved ${u.solves} LeetCode problem${u.solves !== 1 ? "s" : ""}`);
  if (u.shares) parts.push(`shared ${u.shares} job${u.shares !== 1 ? "s" : ""}`);
  if (u.statusChanges) parts.push(`updated ${u.statusChanges} application status${u.statusChanges !== 1 ? "es" : ""}`);
  return parts.length ? parts.join(", ") : "did absolutely nothing";
}

// ── LLM ─────────────────────────────────────────────────────────────────
// OpenAI-compatible calls via OpenRouter (deepseek).

async function postChat({ endpoint, token, model, systemPrompt, userPrompt }) {
  if (!token) return null;
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 400,
        reasoning: { enabled: true },
      }),
    });
  } catch (err) {
    console.error(`  ${model} error:`, err.message);
    return null;
  }
  if (res.status === 429) { console.error(`  ${model} 429 rate limit`); return null; }
  if (!res.ok) { console.error(`  ${model} ${res.status}:`, await res.text()); return null; }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || null;
}

async function callLLM(systemPrompt, userPrompt) {
  return postChat({
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    token: OPENROUTER_API_KEY,
    model: "deepseek/deepseek-v4-flash-0731",
    systemPrompt,
    userPrompt,
  });
}

/** LLM writes only subject + note; jobs ALWAYS come from the real jobboard. */
async function generateEmailContent(name, summary, availableJobs) {
  const jobLines = availableJobs
    .map((j, i) => `- ${j.company}: ${j.job_role} (${j.job_location || "remote"})`)
    .join("\n");

  const systemPrompt = `You are the most ruthless, no-mercy roast master writing a daily morning email to a job hunter in an accountability group. Shame them into action. Be brutal, funny, and personal.

Respond ONLY with valid JSON, no markdown fences, with exactly two fields:
- "subject": a short, savage subject line (no emojis).
- "note": 2-3 sentences roasting their activity (or lack of it) in the last 24h, then commanding them to get to work.`;

  const userPrompt = `${name}'s last 24h: ${summary}.
Available jobs they could apply to today:
${jobLines}
Roast them and tell them to apply.`;

  const raw = await callLLM(systemPrompt, userPrompt);
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return { subject: parsed.subject, note: parsed.note };
  } catch {
    console.error("  Failed to parse LLM response:", raw);
    return null;
  }
}

function buildFallbackContent(name, summary) {
  const idle = /did absolutely nothing/.test(summary);
  return {
    subject: idle
      ? `${name}, nothing in 24h? Seriously?`
      : `${name}, here's your recap. Step it up.`,
    note: idle
      ? `${name}, your last 24 hours were a total zero: ${summary}. The job market isn't going to apply to itself. Open your laptop and get to work NOW.`
      : `${name}, you ${summary} in the last 24h. Cute. Now do more — those jobs below aren't going to apply to themselves.`,
  };
}

// ── Email HTML ──────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "#";
  } catch {
    return "#";
  }
}

function buildEmailHtml(name, summary, note, jobs) {
  const jobRows = jobs
    .map(
      (j) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">
            <strong>${escapeHtml(j.company)}</strong><br/>
            <span style="color:#666;">${escapeHtml(j.job_role || j.role || "")}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">
            <a href="${escapeHtml(safeUrl(j.job_url || j.url))}" style="background:#2563eb;color:#fff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px;">Apply</a>
          </td>
        </tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#1a1a1a;">
  <h2 style="margin-bottom:4px;">Good morning, ${escapeHtml(name)}!</h2>
  <p style="color:#666;margin-top:0;">Your last 24 hours in the garden.</p>

  <div style="background:#f0f9ff;border-left:4px solid #2563eb;padding:16px;border-radius:0 8px 8px 0;margin:20px 0;">
    <div style="color:#666;">You ${escapeHtml(summary)}</div>
  </div>

  <p style="line-height:1.6;">${escapeHtml(note)}</p>

  <h3 style="margin-top:28px;">From the job board — apply today</h3>
  <table style="width:100%;border-collapse:collapse;">
    ${jobRows}
  </table>

  <p style="color:#999;font-size:12px;margin-top:32px;text-align:center;">
    Stop reading this footer and go apply. <a href="https://j2j.pxndey.com" style="color:#2563eb;">j2j.pxndey.com</a>
  </p>
</body>
</html>`;
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const yesterday = yesterdayEST();
  const { dayStart, dayEnd } = dayRange(yesterday);

  console.log(`[daily-email] Reporting on: ${yesterday} ${DRY_RUN ? "(DRY RUN — no mail sent)" : ""}`);
  logEvent("info", "cron.start", { reportDate: yesterday, dryRun: DRY_RUN });

  const [users, activities, jobBoard] = await Promise.all([
    sql`
      SELECT id, name, email FROM users
      WHERE email IS NOT NULL AND approved = true
        AND is_admin = false AND email <> 'system@jobless.local'
      ORDER BY id`,
    sql`
      SELECT user_id, type, company, role, status FROM activity_log
      WHERE occured_at >= ${dayStart} AND occured_at < ${dayEnd}`,
    sql`SELECT company, job_role, job_url, job_location FROM jobboard ORDER BY created_at DESC LIMIT 8`,
  ]);

  const summaryByUser = summarizeActivity(activities);
  console.log(`[daily-email] ${users.length} users, ${activities.length} activity rows, ${jobBoard.length} jobs on the board`);
  logEvent("info", "cron.inputs", { users: users.length, activityRows: activities.length, jobs: jobBoard.length });
  if (!jobBoard.length) console.warn("[daily-email] No jobboard posts — emails will have an empty jobs table");

  let sent = 0;
  let failed = 0;

  for (const user of users) {
    const name = user.name || (user.email ? user.email.split("@")[0] : "Someone");
    const activity = summaryByUser[user.id] || { applied: [], solves: 0, shares: 0, statusChanges: 0 };
    const summary = summaryLine(activity);

    let content = await generateEmailContent(name, summary, jobBoard);
    if (!content) content = buildFallbackContent(name, summary);

    const html = buildEmailHtml(name, summary, content.note, jobBoard);

    if (DRY_RUN) {
      console.log(`  [dry] -> ${user.email} (${name}) | ${summary}`);
      console.log(`        subject: ${content.subject}`);
      console.log(`        note: ${content.note}`);
      logEvent("info", "email.preview", { to: user.email, name, subject: content.subject });
      continue;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      await transporter.sendMail({
        from: FROM_EMAIL,
        to: user.email,
        subject: content.subject || "Your daily job hunt update",
        html,
      });
      console.log(`  Sent -> ${user.email} (${name})`);
      logEvent("info", "email.sent", { to: user.email, name, subject: content.subject, summary });
      sent++;
    } catch (err) {
      console.error(`  FAILED -> ${user.email}:`, err.message);
      logEvent("error", "email.failed", { to: user.email, name, err: err.message });
      failed++;
    }
  }

  console.log(`\n[daily-email] Done! Sent: ${sent}, Failed: ${failed}`);
  logEvent("info", "cron.done", { sent, failed });
  await sql.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});