"use client";

import { useEffect, useState, useCallback } from "react";
import { getToken, getCurrentUser } from "@/lib/client-auth";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { ShameEntry } from "@/app/api/shame/route";

const SHAME_SEEN_KEY = "bloom_shame_seen_date";
const SHAME_COLLAPSED_KEY = "bloom_shame_collapsed";

// Inject flame animation styles once
const FLAME_STYLE_ID = "shame-flame-styles";
function ensureFlameStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(FLAME_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = FLAME_STYLE_ID;
  style.textContent = `
    @media (max-width: 640px) {
      .shame-popup-dialog { max-width: 95vw !important; margin: 8px !important; }
      .shame-popup-dialog .shame-roast-card { padding: 6px 8px !important; }
      .shame-popup-dialog [style*="padding: 20px 22px"] { padding: 14px 16px 6px !important; }
      .shame-popup-dialog [style*="padding: 0 22px"] { padding: 0 16px 14px !important; }
    }
    /* Mild: pulses for ~5s then fades. Total 7s animation. */
    /* 0-71% = 5s of pulsing, 71-100% = 2s fade out */
    @keyframes flame-mild-full {
      0%   { box-shadow: 0 0 4px #ff4500, 0 0 8px #ff6a00, 0 0 12px #ff4500; }
      12%  { box-shadow: 0 0 6px #ff6a00, 0 0 14px #ff4500, 0 0 20px #ff0000; }
      25%  { box-shadow: 0 0 4px #ff4500, 0 0 8px #ff6a00, 0 0 12px #ff4500; }
      37%  { box-shadow: 0 0 6px #ff6a00, 0 0 14px #ff4500, 0 0 20px #ff0000; }
      50%  { box-shadow: 0 0 4px #ff4500, 0 0 8px #ff6a00, 0 0 12px #ff4500; }
      62%  { box-shadow: 0 0 6px #ff6a00, 0 0 14px #ff4500, 0 0 20px #ff0000; }
      71%  { box-shadow: 0 0 4px #ff4500, 0 0 8px #ff6a00, 0 0 12px #ff4500; }
      100% { box-shadow: 0 0 0px transparent; }
    }
    /* Medium: pulses for ~5s then fades. Total 7s. */
    @keyframes flame-medium-full {
      0%   { box-shadow: 0 0 6px #ff4500, 0 0 12px #ff6a00, 0 0 18px #ff4500; }
      10%  { box-shadow: 0 0 8px #ff0000, 0 0 18px #ff6a00, 0 0 28px #ff4500; }
      20%  { box-shadow: 0 0 6px #ff4500, 0 0 12px #ff6a00, 0 0 18px #ff4500; }
      30%  { box-shadow: 0 0 8px #ff0000, 0 0 18px #ff6a00, 0 0 28px #ff4500; }
      40%  { box-shadow: 0 0 6px #ff4500, 0 0 12px #ff6a00, 0 0 18px #ff4500; }
      50%  { box-shadow: 0 0 8px #ff0000, 0 0 18px #ff6a00, 0 0 28px #ff4500; }
      60%  { box-shadow: 0 0 6px #ff4500, 0 0 12px #ff6a00, 0 0 18px #ff4500; }
      71%  { box-shadow: 0 0 6px #ff4500, 0 0 12px #ff6a00, 0 0 18px #ff4500; }
      100% { box-shadow: 0 0 0px transparent; }
    }
    /* Intense: pulses for ~5s then fades. Total 7s. */
    @keyframes flame-intense-full {
      0%   { box-shadow: 0 0 8px #ff0000, 0 0 16px #ff4500, 0 0 24px #ff0000, 0 0 32px #ff6a00; }
      8%   { box-shadow: 0 0 16px #ff0000, 0 0 32px #ff6a00, 0 0 48px #ff0000, 0 0 56px #ff4500; }
      16%  { box-shadow: 0 0 8px #ff0000, 0 0 16px #ff4500, 0 0 24px #ff0000, 0 0 32px #ff6a00; }
      24%  { box-shadow: 0 0 16px #ff0000, 0 0 32px #ff6a00, 0 0 48px #ff0000, 0 0 56px #ff4500; }
      32%  { box-shadow: 0 0 8px #ff0000, 0 0 16px #ff4500, 0 0 24px #ff0000, 0 0 32px #ff6a00; }
      40%  { box-shadow: 0 0 16px #ff0000, 0 0 32px #ff6a00, 0 0 48px #ff0000, 0 0 56px #ff4500; }
      48%  { box-shadow: 0 0 8px #ff0000, 0 0 16px #ff4500, 0 0 24px #ff0000, 0 0 32px #ff6a00; }
      56%  { box-shadow: 0 0 16px #ff0000, 0 0 32px #ff6a00, 0 0 48px #ff0000, 0 0 56px #ff4500; }
      64%  { box-shadow: 0 0 8px #ff0000, 0 0 16px #ff4500, 0 0 24px #ff0000, 0 0 32px #ff6a00; }
      71%  { box-shadow: 0 0 8px #ff0000, 0 0 16px #ff4500, 0 0 24px #ff0000, 0 0 32px #ff6a00; }
      100% { box-shadow: 0 0 0px transparent; }
    }
    .flame-mild    { animation: flame-mild-full 7s ease-in-out forwards; border-color: #ff6a00 !important; }
    .flame-medium  { animation: flame-medium-full 7s ease-in-out forwards; border-color: #ff4500 !important; }
    .flame-intense { animation: flame-intense-full 7s ease-in-out forwards; border-color: #ff0000 !important; }
  `;
  document.head.appendChild(style);
}

/** Returns a flame CSS class based on how few apps someone did. Fewer = more fire. */
function getFlameClass(appsToday: number): string {
  if (appsToday === 0) return "flame-intense";
  if (appsToday <= 2) return "flame-medium";
  if (appsToday <= 4) return "flame-mild";
  return "";
}

function getIcon(appsToday: number) {
  if (appsToday === 0) return "\uD83D\uDCA9";
  if (appsToday >= 5) return "\uD83D\uDD25";
  if (appsToday >= 3) return "\uD83D\uDCAA";
  return "\uD83C\uDF31";
}

function RoastCard({ entry, isMe }: { entry: ShameEntry; isMe: boolean }) {
  const isZero = entry.appsToday === 0;
  const flameClass = isMe ? getFlameClass(entry.appsToday) : "";
  return (
    <div
      className={flameClass}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: isMe ? "2px solid var(--accent)" : "1px solid var(--border)",
        background: isZero ? "rgba(220, 50, 50, 0.04)" : "transparent",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}>
      <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>
        {getIcon(entry.appsToday)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{entry.name}</span>
          {isMe && (
            <span style={{
              fontSize: 9, background: "var(--accent)", color: "#fff",
              padding: "1px 5px", borderRadius: 3, textTransform: "uppercase",
              fontWeight: 700, letterSpacing: 0.5,
            }}>you</span>
          )}
          <span style={{
            marginLeft: "auto", fontSize: 11, fontWeight: 700, flexShrink: 0,
            color: isZero ? "var(--destructive, #dc3232)" : "var(--success, #4caf50)",
          }}>
            {entry.appsToday} app{entry.appsToday !== 1 ? "s" : ""}
          </span>
        </div>
        <div style={{
          fontSize: 12, lineHeight: 1.4, fontStyle: "italic",
          color: "var(--text-mid, var(--muted-foreground))",
        }}>
          {entry.roast}
        </div>
      </div>
    </div>
  );
}

function ShameContent({ entries, totalAppsToday, date, loading, error, onRefresh }: {
  entries: ShameEntry[];
  totalAppsToday: number;
  date: string;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const myUid = getCurrentUser()?.id;
  const hasData = entries.length > 0;

  // Only show full spinner on initial load (no data yet)
  if (loading && !hasData) {
    return (
      <div style={{ textAlign: "center", padding: 24 }}>
        <div className="spinner" />
        <div style={{ fontSize: 12, color: "var(--text-mid)", marginTop: 8 }}>Loading roasts...</div>
      </div>
    );
  }

  if (error && !hasData) {
    return (
      <div style={{ textAlign: "center", padding: 20, color: "var(--text-mid)", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Loading overlay when refreshing with existing data */}
      {loading && hasData && (
        <div style={{
          position: "absolute", inset: 0, background: "rgba(255,255,255,0.7)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 10, borderRadius: 8,
        }}>
          <div style={{ textAlign: "center" }}>
            <div className="spinner" />
            <div style={{ fontSize: 12, color: "var(--text-mid)", marginTop: 8 }}>Regenerating roasts...</div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            fontSize: 20, fontWeight: 800,
            color: totalAppsToday === 0 ? "var(--destructive, #dc3232)" : "var(--success, #4caf50)",
          }}>
            {totalAppsToday}
          </span>
          <div style={{ fontSize: 12, color: "var(--text-mid)", lineHeight: 1.3 }}>
            <div>total apps today</div>
            <div style={{ opacity: 0.7 }}>{date}</div>
          </div>
        </div>
        <button
          onClick={() => {
            if (window.confirm(
              `Regenerate all roasts?\n\nThis will use 1 LLM API request to generate fresh roasts for ${entries.length} people.`
            )) {
              onRefresh();
            }
          }}
          disabled={loading}
          style={{
            background: "none", border: "1px solid var(--border)", borderRadius: 6,
            padding: "3px 8px", fontSize: 11, cursor: loading ? "not-allowed" : "pointer",
            color: "var(--text-mid)", opacity: loading ? 0.5 : 1,
          }}
        >
          <i className="ti ti-refresh" style={{ fontSize: 12 }} />
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map((e) => (
          <RoastCard key={e.uid} entry={e} isMe={e.uid === myUid} />
        ))}
      </div>
    </div>
  );
}

// Hook to fetch shame data — shared by both the embed and the popup.
// `enabled` gates the automatic on-mount/on-become-visible fetch: the embed
// shouldn't fetch while collapsed, and the popup shouldn't fetch when it's
// not going to open — otherwise both independently hit /api/shame on every
// page load, doubling network calls (the server does dedupe LLM generation
// itself via a lock, but there's no reason to fire two requests at all).
export function useShameData(enabled = true) {
  const [entries, setEntries] = useState<ShameEntry[]>([]);
  const [date, setDate] = useState("");
  const [totalAppsToday, setTotalAppsToday] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  const fetchRoasts = useCallback(async (force = false) => {
    setLoading(true);
    setError("");
    console.log("[shame-wall] fetchRoasts called | force:", force);
    try {
      const token = getToken();
      if (!token) {
        console.warn("[shame-wall] No auth token — user not logged in?");
        return;
      }
      // No tz param: the shame day boundary is fixed to US Eastern server-side
      // so the whole group sees the same day, counts, and cached roasts.
      const forceParam = force ? "force=1&" : "";
      const url = `/api/shame?${forceParam}_t=${Date.now()}`;
      console.log("[shame-wall] Fetching:", url);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      console.log("[shame-wall] Response status:", res.status);
      const d = await res.json();
      console.log("[shame-wall] Response data:", JSON.stringify(d).slice(0, 500));
      if (d.ok) {
        setEntries(d.entries);
        setDate(d.date);
        setTotalAppsToday(d.totalAppsToday ?? 0);
      } else {
        console.error("[shame-wall] API error:", d.error);
        setError(d.error || "Failed to load");
      }
    } catch (err) {
      console.error("[shame-wall] Fetch error:", err);
      setError("Failed to fetch roasts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) fetchRoasts(false);
  }, [enabled, fetchRoasts]);

  const forceRefresh = useCallback(() => fetchRoasts(true), [fetchRoasts]);
  const softRefresh = useCallback(() => fetchRoasts(false), [fetchRoasts]);

  return { entries, date, totalAppsToday, loading, error, fetchRoasts: forceRefresh, softRefresh };
}

// Collapsible embedded card for the Community tab
export function ShameWall() {
  useEffect(() => { ensureFlameStyles(); }, []);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SHAME_COLLAPSED_KEY) === "1";
  });
  const data = useShameData(!collapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(SHAME_COLLAPSED_KEY, next ? "1" : "0");
    // useShameData(!collapsed) already re-fetches when `enabled` flips to true.
  }

  return (
    <div className="feed-card" style={{ marginBottom: 14 }}>
      <button
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
          gap: 8,
        }}
      >
        <i
          className={collapsed ? "ti ti-chevron-right" : "ti ti-chevron-down"}
          style={{ fontSize: 16, color: "var(--text-mid)", flexShrink: 0 }}
        />
        <span className="it" style={{ margin: 0, flex: 1 }}>
          Daily Shame Wall
        </span>
        {!data.loading && (
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 10,
            background: data.totalAppsToday === 0
              ? "rgba(220, 50, 50, 0.1)"
              : "rgba(76, 175, 80, 0.1)",
            color: data.totalAppsToday === 0
              ? "var(--destructive, #dc3232)"
              : "var(--success, #4caf50)",
          }}>
            {data.totalAppsToday} app{data.totalAppsToday !== 1 ? "s" : ""} today
          </span>
        )}
      </button>
      {!collapsed && (
        <div style={{ marginTop: 10 }}>
          <ShameContent {...data} onRefresh={data.fetchRoasts} />
        </div>
      )}
    </div>
  );
}

// Check if popup should show (pure localStorage check, no React state involved)
function shouldShowPopup(): boolean {
  try {
    const lastSeen = localStorage.getItem(SHAME_SEEN_KEY);
    if (!lastSeen) return true;
    const elapsed = Date.now() - parseInt(lastSeen, 10);
    return elapsed >= 4 * 60 * 60 * 1000; // 4 hours
  } catch {
    return false;
  }
}

// Popup dialog that shows every 4 hours
export function ShamePopup() {
  // Decide on mount whether to show — never re-evaluate
  const [open, setOpen] = useState(() => shouldShowPopup());
  const data = useShameData(open);

  useEffect(() => { ensureFlameStyles(); }, []);

  // Stamp localStorage immediately when popup opens
  useEffect(() => {
    if (open) {
      localStorage.setItem(SHAME_SEEN_KEY, String(Date.now()));
    }
  }, [open]);

  function handleClose() {
    setOpen(false);
  }

  // Get the logged-in user's app count for flame intensity
  const myUid = getCurrentUser()?.id;
  const myEntry = data.entries.find((e) => e.uid === myUid);
  const myApps = myEntry?.appsToday ?? 0;
  const popupFlame = getFlameClass(myApps);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent
        className={`shame-popup-dialog ${popupFlame}`}
        style={{ maxWidth: 700, maxHeight: "90vh", overflowY: "auto", padding: 0, borderRadius: 12 }}
      >
        <div style={{ padding: "20px 22px 8px" }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>
            Daily Shame Wall
          </div>
          <div style={{ fontSize: 12, color: "var(--text-mid)", marginBottom: 14 }}>
            Here&apos;s how everyone did today. No hiding.
          </div>
        </div>
        <div style={{ padding: "0 22px 20px" }}>
          <ShameContent {...data} onRefresh={data.fetchRoasts} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
