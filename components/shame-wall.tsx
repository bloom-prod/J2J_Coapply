"use client";

import { useEffect, useState, useCallback } from "react";
import { auth } from "@/lib/firebase";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { ShameEntry } from "@/app/api/shame/route";

const SHAME_SEEN_KEY = "bloom_shame_seen_date";
const SHAME_COLLAPSED_KEY = "bloom_shame_collapsed";

function getIcon(appsToday: number) {
  if (appsToday === 0) return "\uD83D\uDCA9";
  if (appsToday >= 5) return "\uD83D\uDD25";
  if (appsToday >= 3) return "\uD83D\uDCAA";
  return "\uD83C\uDF31";
}

function RoastCard({ entry, isMe }: { entry: ShameEntry; isMe: boolean }) {
  const isZero = entry.appsToday === 0;
  return (
    <div style={{
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
  const myUid = auth.currentUser?.uid;

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 24 }}>
        <div className="spinner" />
        <div style={{ fontSize: 12, color: "var(--text-mid)", marginTop: 8 }}>Loading roasts...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: 20, color: "var(--text-mid)", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  return (
    <div>
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
          style={{
            background: "none", border: "1px solid var(--border)", borderRadius: 6,
            padding: "3px 8px", fontSize: 11, cursor: "pointer", color: "var(--text-mid)",
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

// Hook to fetch shame data — shared by both the embed and the popup
export function useShameData() {
  const [entries, setEntries] = useState<ShameEntry[]>([]);
  const [date, setDate] = useState("");
  const [totalAppsToday, setTotalAppsToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchRoasts = useCallback(async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const forceParam = force ? "&force=1" : "";
      const res = await fetch(`/api/shame?tz=${encodeURIComponent(tz)}${forceParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      if (d.ok) {
        setEntries(d.entries);
        setDate(d.date);
        setTotalAppsToday(d.totalAppsToday ?? 0);
      } else {
        setError(d.error || "Failed to load");
      }
    } catch {
      setError("Failed to fetch roasts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRoasts(false); }, [fetchRoasts]);

  const forceRefresh = useCallback(() => fetchRoasts(true), [fetchRoasts]);
  const softRefresh = useCallback(() => fetchRoasts(false), [fetchRoasts]);

  return { entries, date, totalAppsToday, loading, error, fetchRoasts: forceRefresh, softRefresh };
}

// Collapsible embedded card for the Community tab
export function ShameWall() {
  const data = useShameData();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SHAME_COLLAPSED_KEY) === "1";
  });

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(SHAME_COLLAPSED_KEY, next ? "1" : "0");
    if (!next) data.softRefresh(); // re-fetch latest counts when expanding
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

// Popup dialog that shows once per day on first login
export function ShamePopup() {
  const [open, setOpen] = useState(false);
  const data = useShameData();

  useEffect(() => {
    if (data.loading || !data.date) return;
    setOpen(true);
  }, [data.loading, data.date]);

  function handleClose(val: boolean) {
    if (!val && data.date) {
      localStorage.setItem(SHAME_SEEN_KEY, data.date);
    }
    setOpen(val);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent style={{ maxWidth: 700, maxHeight: "90vh", overflowY: "auto", padding: 0 }}>
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
