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
import { STATUSES, type CommunityStats, type FeedEvent, type Job } from "@/lib/types";
import { timeAgo, classifyRole } from "@/lib/job-utils";
import { useDarkMode } from "@/hooks/use-dark-mode";

const STATUS_COLORS = ["#185FA5", "#6B9E6B", "#D4537E", "#3B6D11", "#A32D2D", "#9E9088", "#854F0B"];
const FALLBACK_COLORS = ["#E07BA0","#7BB87B","#78AEDE","#DDB060","#A87BD4","#5FC5C5","#E8895A"];

function weekMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
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
      {payload.map((p, i) => (
        <div key={i}><strong>{p.value}</strong>{payload.length > 1 ? ` ${p.name}` : ""}</div>
      ))}
    </div>
  );
}

function Donut({ data, colors, dark }: { data: { name: string; value: number }[]; colors: string[]; dark: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={1}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} stroke="none" />
          ))}
        </Pie>
        <Tooltip content={(p) => <ChartTip {...p} dark={dark} />} />
        <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 11, color: dark ? "#A89EC0" : "#6B5E52" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function HBar({ data, fill, dark }: { data: { name: string; value: number }[]; fill: string; dark: boolean }) {
  const axis = chartAxisStyle(dark);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart layout="vertical" data={data} margin={{ left: 8, right: 12, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke={dark ? "#2E2B3C" : "#F0F5F0"} />
        <XAxis type="number" allowDecimals={false} tick={axis} />
        <YAxis type="category" dataKey="name" width={96} tick={axis} />
        <Tooltip cursor={{ fill: dark ? "rgba(224,123,160,.08)" : "rgba(212,83,126,.06)" }} content={(p) => <ChartTip {...p} dark={dark} />} />
        <Bar dataKey="value" fill={fill} radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function VBar({ data, fill, dark }: { data: { name: string; value: number }[]; fill: string; dark: boolean }) {
  const axis = chartAxisStyle(dark);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={dark ? "#2E2B3C" : "#F0F5F0"} />
        <XAxis dataKey="name" tick={axis} />
        <YAxis allowDecimals={false} tick={axis} />
        <Tooltip cursor={{ fill: dark ? "rgba(224,123,160,.08)" : "rgba(212,83,126,.06)" }} content={(p) => <ChartTip {...p} dark={dark} />} />
        <Bar dataKey="value" fill={fill} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CommunityTab({ allJobs, feed, userProfiles }: { allJobs: Job[]; feed: FeedEvent[]; userProfiles: Map<string, { name: string; color: string }> }) {
  const uc = (uid: string, i: number) => userProfiles.get(uid)?.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
  const uidToName = (uid: string) => userProfiles.get(uid)?.name ?? "Unknown";
  const [stats, setStats] = useState<CommunityStats | null>(null);

  // Headline numbers from the server-side aggregator. Refresh as the pool changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch("/api/stats", { headers: { Authorization: `Bearer ${token}` } });
        const d = await res.json();
        if (!cancelled && d.ok) setStats(d);
      } catch {
        /* charts still render from the live snapshot */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allJobs.length]);

  const charts = useMemo(() => {
    const sc: Record<string, number> = {};
    STATUSES.forEach((s) => (sc[s] = 0));
    const cc: Record<string, number> = {};
    allJobs.forEach((j) => {
      sc[j.status] = (sc[j.status] || 0) + 1;
      if (j.company) cc[j.company] = (cc[j.company] || 0) + 1;
    });

    // Funnel: how many apps reached at least each stage (excluding "Applied")
    const stageOrder: Record<string, number> = { "Phone Screen": 0, Interview: 1, Offer: 2 };
    const funnelReached = [0, 0, 0];
    allJobs.forEach((j) => {
      const o = stageOrder[j.status];
      if (o !== undefined) for (let i = 0; i <= o; i++) funnelReached[i]++;
    });

    const weeklyUids = [...new Set(allJobs.map((j) => j.ownerUid || "?"))];
    const weeklyUserMeta = weeklyUids.map((uid) => ({ uid, name: uidToName(uid) }));

    // Weekly volume per user — last 12 weeks
    const todayW = new Date(); todayW.setHours(0, 0, 0, 0);
    const thisMon = weekMonday(todayW.toISOString().slice(0, 10));
    const weekKeys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(thisMon + "T00:00:00"); d.setDate(d.getDate() - i * 7);
      weekKeys.push(d.toISOString().slice(0, 10));
    }
    const weeklyByUid: Record<string, Record<string, number>> = {};
    allJobs.forEach((j) => {
      if (!j.date) return;
      const w = weekMonday(j.date);
      if (!weekKeys.includes(w)) return;
      const uid = j.ownerUid || "?";
      if (!weeklyByUid[w]) weeklyByUid[w] = {};
      weeklyByUid[w][uid] = (weeklyByUid[w][uid] || 0) + 1;
    });
    const weeklyData = weekKeys.map((iso) => {
      const obj: Record<string, string | number> = { week: fmtWeekLabel(iso) };
      weeklyUserMeta.forEach(({ uid, name }) => { obj[name] = weeklyByUid[iso]?.[uid] || 0; });
      return obj;
    });

    // Role categories stacked by user
    const roleCatByUid: Record<string, Record<string, number>> = {};
    allJobs.forEach((j) => {
      const cat = j.roleCategory || classifyRole(j.role);
      if (!cat) return;
      const uid = j.ownerUid || "?";
      if (!roleCatByUid[cat]) roleCatByUid[cat] = {};
      roleCatByUid[cat][uid] = (roleCatByUid[cat][uid] || 0) + 1;
    });
    const roleCatUids = [...new Set(
      allJobs.filter((j) => j.roleCategory || classifyRole(j.role)).map((j) => j.ownerUid || "?")
    )];
    const roleCatUserMeta = roleCatUids.map((uid) => ({ uid, name: uidToName(uid) }));
    const roleCatData = Object.entries(roleCatByUid)
      .sort((a, b) => Object.values(b[1]).reduce((s, n) => s + n, 0) - Object.values(a[1]).reduce((s, n) => s + n, 0))
      .slice(0, 8)
      .map(([cat, byUid]) => {
        const obj: Record<string, string | number> = { cat };
        roleCatUserMeta.forEach(({ uid, name }) => { obj[name] = byUid[uid] || 0; });
        return obj;
      });

    return {
      status: STATUSES.map((s) => ({ name: s, value: sc[s] })),
      funnel: ["Phone Screen", "Interview", "Offer"].map((s, i) => ({ name: s, value: funnelReached[i] })),
      companies: Object.entries(cc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value })),
      weeklyData, weeklyUserMeta, roleCatData, roleCatUserMeta,
    };
  }, [allJobs, userProfiles]);

  const leaderboard = useMemo(() => {
    const by: Record<string, { uid: string; name: string; total: number; interviews: number; offers: number; responded: number }> = {};
    allJobs.forEach((j) => {
      if (j.status === "Want to Apply") return; // saved jobs don't count
      const uid = j.ownerUid || "?";
      if (!by[uid]) by[uid] = { uid, name: uidToName(uid), total: 0, interviews: 0, offers: 0, responded: 0 };
      const u = by[uid];
      u.total++;
      if (j.status === "Interview" || j.status === "Offer") u.interviews++;
      if (j.status === "Offer") u.offers++;
      if (j.status !== "Applied" && j.status !== "Ghosted") u.responded++;
    });
    return Object.values(by).sort((a, b) => b.total - a.total);
  }, [allJobs, userProfiles]);

  const dark = useDarkMode();
  const myUid = auth.currentUser?.uid;
  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1);

  const card = (id: string, val: string | number, label: string, sage?: boolean, color?: string) => (
    <div className={`stat-card${sage ? " sage" : ""}`} key={id}>
      <div className="stat-num" style={color ? { color } : undefined}>{val}</div>
      <div className="stat-label">{label}</div>
    </div>
  );

  return (
    <div>
      <div className="sec-header" style={{ marginBottom: 6 }}>
        <span className="sec-title">Community garden</span>
      </div>
      <div className="privacy-note">
        <i className="ti ti-info-circle" /> Stats below are pooled across everyone using bloom right now.
      </div>

      <div className="stats-row">
        {card("u", stats?.totalUsers ?? "—", "Gardeners", true)}
        {card("a", stats?.totalApps ?? "—", "Applications")}
        {card("v", stats?.avgPerUser ?? "—", "Avg / person", true)}
        {card("i", stats ? stats.interviewRate + "%" : "—", "Interview rate", false, "var(--info)")}
        {card("o", stats ? stats.offerRate + "%" : "—", "Offer rate", false, "var(--success)")}
        {card("r", stats ? stats.responseRate + "%" : "—", "Response rate", true)}
      </div>

      <div className="comm-grid" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Row 1: three equal charts */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <div className="chart-card"><div className="it">Status mix (everyone)</div><div className="chart-wrap"><Donut data={charts.status} colors={STATUS_COLORS} dark={dark} /></div></div>
          <div className="chart-card"><div className="it">Interview funnel</div><div className="chart-wrap"><VBar data={charts.funnel} fill={dark ? "#78AEDE" : "#185FA5"} dark={dark} /></div></div>
          <div className="chart-card"><div className="it">Most-applied companies</div><div className="chart-wrap"><HBar data={charts.companies} fill={dark ? "#E07BA0" : "#F2AECF"} dark={dark} /></div></div>
        </div>

        {/* Row 2: two equal charts */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="chart-card">
            <div className="it">Applications by role category</div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.roleCatData} margin={{ left: 0, right: 8, top: 4, bottom: 40 }}>
                  <CartesianGrid vertical={false} stroke={dark ? "#2E2B3C" : "#F0F5F0"} />
                  <XAxis dataKey="cat" tick={{ fontSize: 10, fill: dark ? "#A89EC0" : "#9E9088" }} interval={0} angle={-30} textAnchor="end" tickFormatter={(v: string) => v.length > 12 ? v.slice(0, 11) + "…" : v} />
                  <YAxis allowDecimals={false} tick={chartAxisStyle(dark)} />
                  <Tooltip content={(p) => <ChartTip {...p} dark={dark} />} />
                  <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 11, color: dark ? "#A89EC0" : "#6B5E52", paddingBottom: 4 }} />
                  {charts.roleCatUserMeta.map(({ uid, name }, i) => (
                    <Bar key={uid} dataKey={name} stackId="s" fill={uc(uid, i)} radius={i === charts.roleCatUserMeta.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-card">
            <div className="it">Weekly application volume</div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.weeklyData} margin={{ left: 0, right: 12, top: 6, bottom: 4 }}>
                  <CartesianGrid stroke={dark ? "#2E2B3C" : "#F0F5F0"} vertical={false} />
                  <XAxis dataKey="week" tick={chartAxisStyle(dark)} />
                  <YAxis allowDecimals={false} tick={chartAxisStyle(dark)} />
                  <Tooltip content={(p) => <ChartTip {...p} dark={dark} />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: dark ? "#A89EC0" : "#9E9088" }} />
                  {charts.weeklyUserMeta.map(({ uid, name }, i) => (
                    <Line key={uid} dataKey={name} type="monotone" stroke={uc(uid, i)} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="feed-card">
          <div className="it">🏆 Leaderboard — top gardeners</div>
          {leaderboard.length === 0 ? (
            <div className="lb-empty">No gardeners yet — applications will rank here 🌱</div>
          ) : (
            <table className="lb-table">
              <thead>
                <tr>
                  <th className="lb-rank">#</th>
                  <th>Gardener</th>
                  <th className="num">Apps</th>
                  <th className="num">Interviews</th>
                  <th className="num">Offers</th>
                  <th className="num">Resp. rate</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((u, i) => {
                  const rate = u.total ? Math.round((u.responded / u.total) * 100) : 0;
                  const me = u.uid === myUid;
                  return (
                    <tr key={u.uid} className={me ? "lb-row-me" : ""}>
                      <td className="lb-rank">{medal(i)}</td>
                      <td className="lb-name">{u.name}{me && <span className="lb-me-tag">YOU</span>}</td>
                      <td className="num">{u.total}</td>
                      <td className="num">{u.interviews}</td>
                      <td className="num lb-offers">{u.offers}</td>
                      <td className="num">{rate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="feed-card">
          <div className="it">Live activity feed 🌱</div>
          <div className="feed-list">
            {feed.length === 0 ? (
              <div className="feed-empty">No activity yet — be the first to plant something 🌱</div>
            ) : (
              feed.map((e, i) => {
                const icon = e.type === "offer" ? "🎉" : e.type === "status" ? "🔄" : e.type === "job_share" ? "💼" : "🌱";
                return (
                  <div className="feed-item" key={i}>
                    <span className="feed-ic">{icon}</span>
                    <div className="feed-body">
                      <div className="feed-text">
                        {e.type === "offer" ? (
                          <><strong>{e.ownerName}</strong> got an offer from <strong>{e.company}</strong>!</>
                        ) : e.type === "status" ? (
                          <><strong>{e.ownerName}</strong> moved <strong>{e.company}</strong> → {e.status}</>
                        ) : e.type === "job_share" ? (
                          <><strong>{e.ownerName}</strong> shared a job at <strong>{e.company}</strong> — check the Jobs tab!</>
                        ) : (
                          <><strong>{e.ownerName}</strong> applied to <strong>{e.company}</strong></>
                        )}
                      </div>
                      <div className="feed-sub">
                        {e.role && `${e.role} · `}
                        <span className="feed-time">{timeAgo(e.ts)}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
