"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
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
      const syncRes = await fetch("/api/leetcode/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const syncData = await syncRes.json();
      if (syncData.ok) {
        const userMsg = syncData.totalUsers > 1 
          ? ` (${syncData.usersSynced}/${syncData.totalUsers} users)` 
          : "";
        toast.success(`${syncData.message}${userMsg} 🎯`);
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

  const difficultyData = useMemo(() => {
    if (!stats?.difficultyCounts) return [];
    const order = ["easy", "medium", "hard", "unknown"];
    const colors: Record<string, string> = {
      easy: "#10b981",    // emerald-500
      medium: "#f59e0b",  // amber-500
      hard: "#ef4444",    // red-500
      unknown: "#6b7280", // gray-500
    };
    return order
      .filter((key) => stats.difficultyCounts[key])
      .map((key) => ({
        name: key.charAt(0).toUpperCase() + key.slice(1),
        value: stats.difficultyCounts[key],
        fill: colors[key],
      }));
  }, [stats]);

  const weeklyData = useMemo(() => {
    if (!stats) return [];
    // Format week labels for the new per-user weekly data
    return stats.weeklyData.map((w) => {
      const obj: Record<string, string | number> = {};
      Object.entries(w).forEach(([key, value]) => {
        if (key === "week") {
          obj[key] = fmtWeekLabel(value as string);
        } else {
          obj[key] = value;
        }
      });
      return obj;
    });
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button variant="outline" size="sm" className="rounded-full" onClick={handleRefresh} disabled={syncing}>
            <i className="ti ti-refresh" /> {syncing ? "Syncing community…" : "Refresh All"}
          </Button>
        </div>
      </div>
      <div className="privacy-note">
        <i className="ti ti-info-circle" /> Community sync: Refreshes all members' LeetCode repos. Press Refresh to sync everyone's progress.
      </div>

      {stats && (
        <>
          <div className="stats-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {card("u", stats.totalUsers, "Solvers", true)}
            {card("t", stats.totalSolved, "Total Solved")}
            {card("a", stats.avgPerUser, "Avg / person", true, "var(--info)")}
          </div>

          <div className="comm-grid" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
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
                <div className="it">Difficulty</div>
                <div className="chart-wrap">
                  {difficultyData.length === 0 ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-light)", fontSize: 13 }}>
                      No difficulty data<br/>Sync your LeetCode repo
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={difficultyData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={1}>
                          {difficultyData.map((d, i) => (
                            <Cell key={i} fill={d.fill} stroke="none" />
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
                  )}
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
                {weeklyData.length === 0 ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-light)", fontSize: 13 }}>
                    No data for this timeframe — try selecting a wider range or syncing
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weeklyData} margin={{ left: 0, right: 12, top: 6, bottom: 4 }}>
                      <CartesianGrid stroke={dark ? "#2E2B3C" : "#F0F5F0"} vertical={false} />
                      <XAxis dataKey="week" tick={chartAxisStyle(dark)} />
                      <YAxis allowDecimals={false} tick={chartAxisStyle(dark)} />
                      <Tooltip content={(p) => <ChartTip {...p} dark={dark} />} />
                      <Legend wrapperStyle={{ fontSize: 12, color: dark ? "#A89EC0" : "#9E9088" }} />
                      {stats?.weeklyUsers?.map((name, i) => (
                        <Line key={name} dataKey={name} type="monotone" stroke={uc(name, i, userColors)} strokeWidth={2} dot={false} />
                      ))}
                    </LineChart>
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
                  stats.recentActivity.map((e, i) => {
                    const difficultyColor = e.difficulty === 'easy' ? '#10b981' : e.difficulty === 'medium' ? '#f59e0b' : e.difficulty === 'hard' ? '#ef4444' : '#6b7280';
                    return (
                    <div className="feed-item" key={i}>
                      <span className="feed-ic">🎯</span>
                      <div className="feed-body">
                        <div className="feed-text">
                          <><strong>{e.userName}</strong> solved <strong>{e.title}</strong></>
                        </div>
                        <div className="feed-sub">
                          {e.language} · <span style={{ 
                            display: 'inline-block',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            backgroundColor: `${difficultyColor}20`,
                            color: difficultyColor,
                            marginRight: '6px'
                          }}>{e.difficulty}</span> · <span className="feed-time">{timeAgo(new Date(e.solvedAt))}</span>
                        </div>
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
