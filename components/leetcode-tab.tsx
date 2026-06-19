"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { auth } from "@/lib/firebase";
import type { LeetCodeStats } from "@/lib/types";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { timeAgo } from "@/lib/job-utils";

const FALLBACK_COLORS = ["#E07BA0","#7BB87B","#78AEDE","#DDB060","#A87BD4","#5FC5C5","#E8895A"];

function uc(name: string, i: number, userColors: Map<string, string>) {
  return userColors.get(name) ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
}

function fmtWeekLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function chartAxisStyle(dark: boolean) {
  return { fontSize: 11, fill: dark ? "#A89EC0" : "#9E9088" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface TipProps { active?: boolean; payload?: any[]; label?: string; dark: boolean }
function ChartTip({ active, payload, label, dark }: TipProps) {
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

type Timeframe = "last7" | "last30" | "last90" | "all";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function filterByTimeframe(data: { week: string; count: number }[], tf: Timeframe): { week: string; count: number }[] {
  if (tf === "all") return data;
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
  const weeksMap: Record<Timeframe, number> = {
    last7: 1, last30: 4, last90: 12, all: 999,
  };
  const cutoff = new Date(today.getTime() - weeksMap[tf] * WEEK_MS);
  return data.filter((d) => new Date(d.week + "T00:00:00") >= cutoff);
}

export function LeetCodeTab({ userColors }: { userColors: Map<string, string> }) {
  const [stats, setStats] = useState<LeetCodeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>("last90");

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

  const userData = useMemo(() => {
    if (!stats) return [];
    return stats.userLeaderboard
      .filter((u) => u.count > 0)
      .map((u) => ({ name: u.name, value: u.count }));
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
    const all = stats.weeklyVolume.map((w) => ({
      week: fmtWeekLabel(w.week),
      rawWeek: w.week,
      count: w.count,
    }));
    const filtered = filterByTimeframe(
      all.map((a) => ({ week: a.rawWeek, count: a.count })),
      timeframe
    );
    return filtered.map((f) => ({ week: fmtWeekLabel(f.week), count: f.count }));
  }, [stats, timeframe]);

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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="Timeframe" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="last7">Last Week</SelectItem>
              <SelectItem value="last30">1 Month</SelectItem>
              <SelectItem value="last90">3 Months</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="rounded-full" onClick={handleRefresh} disabled={syncing}>
            <i className="ti ti-refresh" /> {syncing ? "Syncing…" : "Refresh / Sync"}
          </Button>
        </div>
      </div>
      <div className="privacy-note">
        <i className="ti ti-info-circle" /> Syncs directly from your GitHub repo's commit history. Press Refresh to sync now.
      </div>

      {stats && (
        <>
          <div className="stats-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {card("u", stats.totalUsers, "Solvers", true)}
            {card("t", stats.totalSolved, "Total Solved")}
            {card("a", stats.avgPerUser, "Avg / person", true, "var(--info)")}
          </div>

          <div className="comm-grid" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="chart-card">
                <div className="it">Solved by user</div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={userData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={1}>
                        {userData.map((d, i) => (
                          <Cell key={i} fill={uc(d.name, i, userColors)} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip content={(p) => <ChartTip {...p} dark={dark} />} />
                      <Legend
                        layout="vertical"
                        align="right"
                        verticalAlign="middle"
                        wrapperStyle={{
                          fontSize: 11,
                          color: dark ? "#A89EC0" : "#6B5E52",
                          paddingLeft: 8,
                        }}
                      />
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
                      <Legend
                        verticalAlign="top"
                        align="right"
                        wrapperStyle={{
                          fontSize: 11,
                          color: dark ? "#A89EC0" : "#6B5E52",
                          paddingBottom: 4,
                        }}
                      />
                      <Bar dataKey="value" fill={dark ? "#E07BA0" : "#F2AECF"} radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="chart-card">
              <div className="it">Weekly submission volume</div>
              <div className="chart-wrap">
                {weeklyData.length === 0 ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-light)", fontSize: 13 }}>
                    No data for this timeframe — try selecting a wider range or syncing
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                      <CartesianGrid vertical={false} stroke={dark ? "#2E2B3C" : "#F0F5F0"} />
                      <XAxis dataKey="week" tick={chartAxisStyle(dark)} />
                      <YAxis allowDecimals={false} tick={chartAxisStyle(dark)} />
                      <Tooltip cursor={{ fill: dark ? "rgba(224,123,160,.08)" : "rgba(212,83,126,.06)" }} content={(p) => <ChartTip {...p} dark={dark} />} />
                      <Legend
                        verticalAlign="top"
                        align="right"
                        wrapperStyle={{
                          fontSize: 11,
                          color: dark ? "#A89EC0" : "#6B5E52",
                          paddingBottom: 4,
                        }}
                      />
                      <Bar dataKey="count" fill={dark ? "#78AEDE" : "#185FA5"} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div className="feed-card">
              <div className="it">Recent solves 🎯</div>
              <div className="feed-list">
                {stats.recentActivity.length === 0 ? (
                  <div className="feed-empty">No activity yet — start solving problems! 🎯</div>
                ) : (
                  stats.recentActivity.map((e, i) => (
                    <div className="feed-item" key={i}>
                      <span className="feed-ic">🎯</span>
                      <div className="feed-body">
                        <div className="feed-text">
                          <><strong>{e.userName}</strong> solved <strong>{e.title}</strong></>
                        </div>
                        <div className="feed-sub">
                          {e.language} · <span className="feed-time">{timeAgo(e.solvedAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
