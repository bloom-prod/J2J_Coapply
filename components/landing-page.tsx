"use client";

import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

type AuthMode = "login" | "signup";

// Sample rows for the hero preview. Illustrative only — not real users.
const PREVIEW_ROWS = [
  { co: "Linear", role: "Software Engineer, New Grad", status: "Interview", date: "Sep 12" },
  { co: "Ramp", role: "Fullstack Engineer", status: "OA", date: "Sep 10" },
  { co: "Figma", role: "Product Engineer", status: "Applied", date: "Sep 09" },
  { co: "Stripe", role: "SWE Intern, Summer '27", status: "Offer", date: "Sep 02" },
  { co: "Notion", role: "Backend Engineer", status: "Rejected", date: "Aug 28" },
] as const;

const FEED = [
  { who: "maya", color: "#D4537E", text: "moved Stripe to", status: "Offer" },
  { who: "dev", color: "#6B9E6B", text: "solved Two Sum II", status: null },
  { who: "sam", color: "#5A6B85", text: "shared a role at Anthropic", status: null },
  { who: "ria", color: "#B8862B", text: "moved Ramp to", status: "OA" },
] as const;

const STAGES = [
  { label: "Want to Apply", note: "seed" },
  { label: "Applied", note: "sprout" },
  { label: "OA", note: "first leaves" },
  { label: "Interview", note: "bud" },
  { label: "Offer", note: "bloom" },
] as const;

const FEATURES = [
  {
    k: "tracker",
    icon: "ti-list-check",
    title: "A tracker that remembers",
    body: "Every application with its status history, priority, recruiter, follow-up date and notes. Import a spreadsheet, export a CSV, add one with ⌘K.",
    wide: true,
  },
  {
    k: "community",
    icon: "ti-plant-2",
    title: "A shared garden",
    body: "Join a community and watch everyone's progress land in a live feed. Wins are louder when someone's cheering.",
  },
  {
    k: "insights",
    icon: "ti-chart-dots-3",
    title: "Insights that tell the truth",
    body: "Response rates, funnel Sankeys and a timeline of where things stall.",
  },
  {
    k: "leetcode",
    icon: "ti-code",
    title: "LeetCode, synced",
    body: "Problems sync daily and count toward a group leaderboard.",
  },
  {
    k: "jobs",
    icon: "ti-briefcase",
    title: "A job board fed by friends",
    body: "Share a posting in one click. Save someone else's find straight into your tracker.",
  },
  {
    k: "prep",
    icon: "ti-messages",
    title: "Interview prep & resume review",
    body: "Post what a company asked, upload resumes and trade line-by-line comments.",
    wide: true,
  },
  {
    k: "shame",
    icon: "ti-flame",
    title: "The wall of shame",
    body: "Didn't apply today? A daily roast will find you. Streaks keep the fire going.",
  },
] as const;

function slug(s: string) {
  return s.replace(/\s+/g, "-");
}

function useFeedTicker(length: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % length), 2800);
    return () => clearInterval(t);
  }, [length]);
  return i;
}

function Stem({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 420" fill="none" aria-hidden="true">
      <path className="lp-stem-path" d="M60 420 C 58 330, 70 270, 56 190 S 62 70, 60 20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path className="lp-leaf" d="M58 300 C 30 290, 16 262, 18 240 C 42 246, 56 270, 58 300 Z" fill="var(--sage-200)" />
      <path className="lp-leaf" d="M60 220 C 88 212, 104 186, 102 164 C 78 170, 62 192, 60 220 Z" fill="var(--sage-400)" opacity=".8" />
      <path className="lp-leaf" d="M57 130 C 34 124, 22 102, 24 84 C 44 90, 56 108, 57 130 Z" fill="var(--sage-200)" />
      <g className="lp-flower">
        <circle cx="60" cy="20" r="11" fill="var(--pink-200)" />
        <circle cx="48" cy="14" r="9" fill="var(--pink-200)" opacity=".85" />
        <circle cx="72" cy="14" r="9" fill="var(--pink-200)" opacity=".85" />
        <circle cx="60" cy="6" r="8" fill="var(--pink-200)" opacity=".9" />
        <circle cx="60" cy="17" r="5" fill="var(--pink-400)" />
      </g>
    </svg>
  );
}

export function LandingPage({ onAuth }: { onAuth: (mode: AuthMode) => void }) {
  const feedIdx = useFeedTicker(FEED.length);
  const item = FEED[feedIdx];

  return (
    <div className="lp">
      <div className="lp-grain" aria-hidden="true" />

      <header className="lp-nav">
        <a href="#top" className="lp-brand">
          <span className="lp-brand-icon">🌿</span>
          <span>bloom tracker</span>
        </a>
        <nav className="lp-nav-links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
        </nav>
        <div className="lp-nav-actions">
          <ThemeToggle />
          <button className="lp-btn lp-btn-ghost" onClick={() => onAuth("login")}>Log in</button>
          <button className="lp-btn lp-btn-primary lp-hide-sm" onClick={() => onAuth("signup")}>Request access</button>
        </div>
      </header>

      <main id="top">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">
              <span className="lp-dot" /> A job search garden, grown together
            </p>
            <h1 className="lp-h1">
              Plant every application.
              <br />
              Watch the <em>offers</em> bloom.
            </h1>
            <p className="lp-lede">
              bloom tracker is where you and your friends log every application, OA and interview, and see
              everyone's progress in one shared feed. You'll feel less alone in the rejections and have people
              to celebrate the wins with.
            </p>
            <div className="lp-cta-row">
              <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={() => onAuth("signup")}>
                Start your garden <i className="ti ti-arrow-right" />
              </button>
              <button className="lp-btn lp-btn-outline lp-btn-lg" onClick={() => onAuth("login")}>
                I have an account
              </button>
            </div>
            <p className="lp-fine">Invite-only communities · new accounts are approved by an admin</p>
          </div>

          <div className="lp-hero-art">
            <Stem className="lp-stem lp-stem-a" />
            <Stem className="lp-stem lp-stem-b" />

            <div className="lp-window">
              <div className="lp-window-bar">
                <span /><span /><span />
                <div className="lp-window-title">📋 Applications</div>
              </div>
              <div className="lp-window-stats">
                <div><b>142</b><small>applied</small></div>
                <div><b>18</b><small>OAs</small></div>
                <div><b>7</b><small>interviews</small></div>
                <div className="lp-stat-hot"><b>🔥 12</b><small>day streak</small></div>
              </div>
              <ul className="lp-rows">
                {PREVIEW_ROWS.map((r) => (
                  <li key={r.co}>
                    <span className="lp-co-avatar">{r.co[0]}</span>
                    <span className="lp-row-main">
                      <b>{r.co}</b>
                      <small>{r.role}</small>
                    </span>
                    <span className={`pill s-${slug(r.status)}`}>{r.status}</span>
                    <span className="lp-row-date">{r.date}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lp-toast" key={feedIdx} aria-live="polite">
              <span className="lp-toast-avatar" style={{ background: item.color }}>{item.who[0]}</span>
              <span>
                <b>{item.who}</b> {item.text}{" "}
                {item.status && <span className={`pill s-${slug(item.status)}`}>{item.status}</span>}
              </span>
            </div>
          </div>
        </section>

        {/* ── Growth stages ribbon ─────────────────────────────── */}
        <section className="lp-stages" aria-label="Application stages">
          {STAGES.map((s, i) => (
            <div className="lp-stage" key={s.label}>
              <span className="lp-stage-num">0{i + 1}</span>
              <span className={`pill s-${slug(s.label)}`}>{s.label}</span>
              <span className="lp-stage-note">{s.note}</span>
            </div>
          ))}
        </section>

        {/* ── Features ─────────────────────────────────────────── */}
        <section className="lp-section" id="features">
          <div className="lp-section-head">
            <p className="lp-kicker">What grows here</p>
            <h2 className="lp-h2">
              Everything the job hunt needs, <em>in one bed.</em>
            </h2>
          </div>
          <div className="lp-bento">
            {FEATURES.map((f) => (
              <article key={f.k} className={`lp-card lp-card-${f.k}${"wide" in f && f.wide ? " lp-wide" : ""}`}>
                <div className="lp-card-icon"><i className={`ti ${f.icon}`} /></div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                {f.k === "tracker" && (
                  <div className="lp-mini-history">
                    {["Applied", "OA", "Interview", "Offer"].map((s, i, arr) => (
                      <span key={s} className="lp-mini-step">
                        <span className={`pill s-${s}`}>{s}</span>
                        {i < arr.length - 1 && <i className="ti ti-chevron-right" />}
                      </span>
                    ))}
                  </div>
                )}
                {f.k === "shame" && (
                  <blockquote className="lp-roast">
                    “Zero applications today? Bold strategy: waiting for the jobs to apply to you.”
                  </blockquote>
                )}
              </article>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────── */}
        <section className="lp-section lp-how" id="how">
          <div className="lp-section-head">
            <p className="lp-kicker">How it works</p>
            <h2 className="lp-h2">From seed to bloom in three steps.</h2>
          </div>
          <ol className="lp-steps">
            <li>
              <span className="lp-step-num">i.</span>
              <h3>Request access</h3>
              <p>Sign up with your email. An admin approves you, then you join your friends' community with an invite code.</p>
            </li>
            <li>
              <span className="lp-step-num">ii.</span>
              <h3>Plant your applications</h3>
              <p>Add roles as you apply or import an existing spreadsheet. Update statuses as emails come in.</p>
            </li>
            <li>
              <span className="lp-step-num">iii.</span>
              <h3>Grow together</h3>
              <p>Your updates reach the community feed, and every tree in your forest shows how far one search has come.</p>
            </li>
          </ol>
        </section>

        {/* ── Closing CTA ──────────────────────────────────────── */}
        <section className="lp-final">
          <Stem className="lp-final-stem" />
          <h2 className="lp-h2">
            The search is long.
            <br />
            <em>Don't do it alone.</em>
          </h2>
          <div className="lp-cta-row lp-center">
            <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={() => onAuth("signup")}>
              Request access <i className="ti ti-arrow-right" />
            </button>
            <button className="lp-btn lp-btn-ghost lp-btn-lg" onClick={() => onAuth("login")}>
              Log in
            </button>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <span>🌿 bloom tracker</span>
        <span>Your job search garden.</span>
      </footer>
    </div>
  );
}
