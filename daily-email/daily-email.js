#!/usr/bin/env node
/**
 * Standalone daily email script.
 * Sends each user their job application count, a supportive LLM note,
 * and job suggestions with direct links.
 *
 * Setup:  cd daily-email && npm install
 * Run:    npm run send
 * Cron:   Schedule this to run daily at 6 AM EST
 */

require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const nodemailer = require("nodemailer");

// ── Config ──────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_EMAIL = process.env.SMTP_FROM;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !FROM_EMAIL) {
  console.error("Missing SMTP_HOST, SMTP_USER, SMTP_PASS, or SMTP_FROM in .env");
  process.exit(1);
}

// ── Firebase Admin ──────────────────────────────────────────────────────
function getAdminApp() {
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const app = getAdminApp();
const db = getFirestore(app);
const auth = getAuth(app);

// ── Date helpers ────────────────────────────────────────────────────────

/** Shift a YYYY-MM-DD string by whole days, independent of the server's timezone.
 *  A bare "T00:00:00" parses as server-local; on a UTC-ahead server toISOString()
 *  would then roll the date back a day and shift the whole report window. */
function shiftDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Get the date string for the report window that just closed.
 * The reporting window is 6 AM to 6 AM EST, so if this runs before 6 AM
 * (e.g. the cron fires a few minutes early, or is rerun manually), the
 * window we should report on is two days back, not one — otherwise we'd
 * report on a window that hasn't closed yet and miss its last applications.
 */
function yesterdayEST() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const todayStr = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = parseInt(get("hour"), 10);
  return shiftDateStr(todayStr, hour < 6 ? -2 : -1);
}

/** Get UTC timestamp range for a given local EST date (6 AM to 6 AM). */
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
  const refUTC = ref.getTime();
  const refLocalMs = new Date(
    `${refLocalDate}T${String(refLocalHour).padStart(2, "0")}:${String(refLocalMin).padStart(2, "0")}:00Z`
  ).getTime();
  const offsetMs = refLocalMs - refUTC;

  const dayStart = new Date(`${dateStr}T06:00:00Z`);
  dayStart.setTime(dayStart.getTime() - offsetMs);

  const dayEnd = new Date(`${shiftDateStr(dateStr, 1)}T06:00:00Z`);
  dayEnd.setTime(dayEnd.getTime() - offsetMs);

  return { dayStart, dayEnd };
}

// ── Groq LLM ────────────────────────────────────────────────────────────
async function callGroq(systemPrompt, userPrompt) {
  if (!GROQ_API_KEY) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 600,
      }),
    });
    if (!res.ok) {
      console.error(`  Groq ${res.status}:`, await res.text());
      return null;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error("  Groq error:", err.message);
    return null;
  }
}

async function generateEmailContent(name, appsYesterday, companiesApplied) {
  const systemPrompt = `You are the most ruthless, no-mercy roast master writing a daily morning email to a job hunter in an accountability group. Your job is to shame them into action. Be brutal, funny, and personal.

Format your response as JSON with these fields:
- "subject": a short, savage email subject line that will make them feel guilty when they see it in their inbox (no emojis)
- "note": 2-3 sentences of brutal roasting based on their yesterday's count. If 0 apps: absolutely destroy them. If 1-3: mock them for barely trying. If 4-9: backhanded compliment. If 10+: props but remind them not to slack today. Make it sting. End with a command to get to work.
- "jobs": an array of exactly 5 objects, each with "company", "role", and "url" fields. Suggest real, well-known companies they haven't applied to yet. Use real career page URLs (e.g. https://careers.google.com, https://www.amazon.jobs, https://careers.microsoft.com, https://jobs.netflix.com, https://www.metacareers.com, https://jobs.apple.com, https://careers.walmart.com, https://www.salesforce.com/company/careers, https://careers.adobe.com, https://www.nvidia.com/en-us/about-nvidia/careers). Pick varied companies and roles for tech job seekers.

Respond ONLY with valid JSON, no markdown fences.`;

  const appliedList = companiesApplied.length > 0
    ? `They already applied to: ${companiesApplied.join(", ")}.`
    : "They haven't applied anywhere yet — not a single one.";

  const userPrompt = `${name} submitted ${appsYesterday} job application${appsYesterday !== 1 ? "s" : ""} yesterday. ${appliedList} Roast them and suggest companies they have NOT applied to.`;

  const raw = await callGroq(systemPrompt, userPrompt);
  if (!raw) return null;

  try {
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    console.error("  Failed to parse LLM response:", raw);
    return null;
  }
}

// ── Fallback content ────────────────────────────────────────────────────
function buildFallbackContent(name, appsYesterday) {
  return {
    subject: appsYesterday === 0
      ? `${name}, zero apps yesterday. Seriously?`
      : `${name}, only ${appsYesterday} app${appsYesterday !== 1 ? "s" : ""}? Step it up.`,
    note: appsYesterday === 0
      ? `${name}, you submitted exactly zero applications yesterday. Your couch called — it wants its best friend back. Get off your butt and start applying NOW.`
      : `${name}, ${appsYesterday} application${appsYesterday !== 1 ? "s" : ""}? That's it? The job market isn't going to beg you to join. Open your laptop and get to work.`,
    jobs: [
      { company: "Google", role: "Software Engineer", url: "https://careers.google.com" },
      { company: "Microsoft", role: "Software Engineer", url: "https://careers.microsoft.com" },
      { company: "Amazon", role: "SDE", url: "https://www.amazon.jobs" },
      { company: "Apple", role: "Software Engineer", url: "https://jobs.apple.com" },
      { company: "Netflix", role: "Software Engineer", url: "https://jobs.netflix.com" },
    ],
  };
}

// ── Email HTML ──────────────────────────────────────────────────────────

/** Escape text interpolated into HTML — the LLM's output isn't trusted markup. */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only allow http(s) URLs through into an href — anything else (javascript:, data:, etc.) is dropped. */
function safeUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "#";
  } catch {
    return "#";
  }
}

function buildEmailHtml(name, appsYesterday, note, jobs) {
  const jobRows = jobs
    .map(
      (j) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">
            <strong>${escapeHtml(j.company)}</strong><br/>
            <span style="color:#666;">${escapeHtml(j.role)}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">
            <a href="${escapeHtml(safeUrl(j.url))}" style="background:#2563eb;color:#fff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px;">Apply</a>
          </td>
        </tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#1a1a1a;">
  <h2 style="margin-bottom:4px;">Good morning, ${escapeHtml(name)}!</h2>
  <p style="color:#666;margin-top:0;">Here's your daily job hunt update.</p>

  <div style="background:#f0f9ff;border-left:4px solid #2563eb;padding:16px;border-radius:0 8px 8px 0;margin:20px 0;">
    <div style="font-size:32px;font-weight:bold;color:#2563eb;">${appsYesterday}</div>
    <div style="color:#666;">application${appsYesterday !== 1 ? "s" : ""} yesterday</div>
  </div>

  <p style="line-height:1.6;">${escapeHtml(note)}</p>

  <h3 style="margin-top:28px;">Jobs to check out today</h3>
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

  console.log(`[daily-email] Reporting on: ${yesterday}`);
  console.log(`[daily-email] Range: ${dayStart.toISOString()} - ${dayEnd.toISOString()}`);

  // 1. Get all users from Firebase Auth
  const listResult = await auth.listUsers(1000);
  const users = listResult.users.filter((u) => u.email);
  console.log(`[daily-email] Found ${users.length} users with emails`);

  // 2. Get yesterday's applications
  const appsSnap = await db
    .collection("applications")
    .where("status", "==", "Applied")
    .where("createdAt", ">=", dayStart)
    .where("createdAt", "<", dayEnd)
    .get();

  const countsByUid = {};
  const companiesByUid = {};
  appsSnap.forEach((doc) => {
    const data = doc.data();
    const uid = data.ownerUid;
    if (!uid) return;
    countsByUid[uid] = (countsByUid[uid] || 0) + 1;
    if (!companiesByUid[uid]) companiesByUid[uid] = [];
    if (data.company) companiesByUid[uid].push(data.company);
  });

  console.log(`[daily-email] Total apps yesterday: ${appsSnap.size}`);

  // 3. Get user names from profiles
  const profilesSnap = await db.collection("userProfiles").get();
  const namesByUid = {};
  profilesSnap.forEach((doc) => {
    namesByUid[doc.id] = doc.data().name || "Someone";
  });

  // 4. Send emails
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  let sent = 0;
  let failed = 0;

  for (const user of users) {
    const uid = user.uid;
    const name = namesByUid[uid] || user.displayName || user.email.split("@")[0];
    const appsYesterday = countsByUid[uid] || 0;
    const companies = companiesByUid[uid] || [];

    let content = await generateEmailContent(name, appsYesterday, companies);
    if (!content) {
      content = buildFallbackContent(name, appsYesterday);
    }

    const html = buildEmailHtml(name, appsYesterday, content.note, content.jobs || []);

    try {
      await transporter.sendMail({
        from: FROM_EMAIL,
        to: user.email,
        subject: content.subject || "Your daily job hunt update",
        html,
      });
      console.log(`  Sent -> ${user.email} (${name}, ${appsYesterday} apps)`);
      sent++;
    } catch (err) {
      console.error(`  FAILED -> ${user.email}:`, err.message);
      failed++;
    }
  }

  console.log(`\n[daily-email] Done! Sent: ${sent}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
