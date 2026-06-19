"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { auth } from "@/lib/firebase";
import type { LeetCodeStats } from "@/lib/types";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { Button } from "@/components/ui/button";

const DIFFICULTY_COLORS = { easy: "#6B9E6B", medium: "#DDB060", hard: "#A32D2D" };
const FALLBACK_COLORS = ["#E07BA0","#7BB87B","#78AEDE","#DDB060","#A87BD4","#5FC5C5","#E8895A"];

function chartAxisStyle(dark: boolean) {
  return { fontSize: 11, fill: dark ? "#A89EC0" : "#9E9088" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTip({ active, payload, label, dark }: { active?: boolean; payload?: any[]; label?: string; dark: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: dark ? "#2D2A3C" : "#1a1a1a",
      color: dark ? "#F0EBF8" : "#fff",
      fontSize: 12, borderRadius: 6,
      padding: "5px 9px",
      boxShadow: "0 2px 8px rgba(0,0,0,.35)",
      whiteSpace: "nowrap",
    }}>
      {label && <div style={{ opacity: 0.7, marginBottom: 2 }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i}><strong>{p.value}</strong>{payload.length > 1 ? ` ${p.name}` : ""}</div>
      ))}
    </div>
  );
}

export function LeetCodeTab({ userColors }: { userColors: Map<string, string> }) {
  const [stats, setStats] = useState<LeetCodeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  async function fetchStats() {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch("/api/leetcode", { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json();
      if (d.ok) setStats(d);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    if (!auth.currentUser) return;
    setSyncing(true);
    try {
      const token = await auth.currentUser.getIdToken();
      // First: trigger a manual sync against GitHub
      const syncRes = await fetch("/api/leetcode/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const syncData = await syncRes.json();
      if (syncData.ok) {
        toast.success(syncData.message || `Synced ${syncData.synced} problem(s) 🎯`);
      } else {
        toast.error(syncData.error || "Sync failed");
      }
      // Then: reload stats
      await fetchStats();
    } catch (e) {
      toast.error("Refresh failed — " + (e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    fetchStats();
  }, []);

  const dark = useDarkMode();

  const diffData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: "Easy", value: stats.difficultyCounts.easy },
      { name: "Medium", value: stats.difficultyCounts.medium },
      { name: "Hard", value: stats.difficultyCounts.hard },
    ].filter((d) => d.value > 0);
  }, [stats]);

  const langData = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.languageCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));
  }, [stats]);

  const weeklyData = useMemo(() => {
    if (!stats) return [];
    return stats.weeklyVolume.map((w) => ({ week: w.week, count: w.count }));
  }, [stats]);

  const card = (id: string, val: string | number, label: string, sage?: boolean, color?: string) => (
    <div className={`stat-card${sage ? " sage" : ""}`} key={id}>
      <div className="stat-num" style={color ? { color } : undefined}>{val}</div>
      <div className="stat-label">{label}</div>
    </div>
  );

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <div className="spinner" />
        <div style={{ fontSize: 14, color: "var(--text-mid)" }}>Loading LeetCode stats…</div>
      </div>
    );
  }

  return (
    <div>
      <div className="sec-header" style={{ marginBottom: 6 }}>
        <span className="sec-title">💻 LeetCode Progress</span>
        <Button variant="outline" size="sm" className="rounded-full" onClick={handleRefresh} disabled={syncing}>
          <i className="ti ti-refresh" /> {syncing ? "Syncing…" : "Refresh"}
        </Button>
      </div>
      <div className="privacy-note">
        <i className="ti ti-info-circle" /> Synced nightly from GitHub repos via LeetHub / LeetSync.
      </div>

      {stats && (
        <>
          <div className="stats-row">
            {card("u", stats.totalUsers, "Solvers", true)}
            {card("t", stats.totalSolved, "Total Solved")}
            {card("a", stats.avgPerUser, "Avg / person", true)}
            {card("e", stats.difficultyCounts.easy, "Easy", false, DIFFICULTY_COLORS.easy)}
            {card("m", stats.difficultyCounts.medium, "Medium", false, DIFFICULTY_COLORS.medium)}
            {card("h", stats.difficultyCounts.hard, "Hard", false, DIFFICULTY_COLORS.hard)}
          </div>

          <div className="comm-grid" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="chart-card">
                <div className="it">Difficulty breakdown</div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={diffData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={1}>
                        {diffData.map((_, i) => (
                          <Cell key={i} fill={Object.values(DIFFICULTY_COLORS)[i]} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip content={(p) => <ChartTip {...p} dark={dark} />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="chart-card">
                <div className="it">Languages</div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={langData} margin={{ left: 8, right: 12, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke={dark ? "#2E2B3C" : "#F0F5F0"} />
                      <XAxis type="number" allowDecimals={false} tick={chartAxisStyle(dark)} />
                      <YAxis type="category" dataKey="name" width={80} tick={chartAxisStyle(dark)} />
                      <Tooltip cursor={{ fill: dark ? "rgba(224,123,160,.08)" : "rgba(212,83,126,.06)" }} content={(p) => <ChartTip {...p} dark={dark} />} />
                      <Bar dataKey="value" fill={dark ? "#E07BA0" : "#F2AECF"} radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="chart-card">
              <div className="it">Weekly submission volume</div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                    <CartesianGrid vertical={false} stroke={dark ? "#2E2B3C" : "#F0F5F0"} />
                    <XAxis dataKey="week" tick={chartAxisStyle(dark)} />
                    <YAxis allowDecimals={false} tick={chartAxisStyle(dark)} />
                    <Tooltip cursor={{ fill: dark ? "rgba(224,123,160,.08)" : "rgba(212,83,126,.06)" }} content={(p) => <ChartTip {...p} dark={dark} />} />
                    <Bar dataKey="count" fill={dark ? "#78AEDE" : "#185FA5"} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
