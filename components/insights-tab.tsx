"use client";

import { useMemo, useState } from "react";
import { STATUSES, type Job } from "@/lib/types";
import { classifyRole } from "@/lib/job-utils";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { TimelineTab } from "@/components/timeline-tab";

function weekMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function fmtWeekLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const FUNNEL_STAGES = ["Applied", "Phone Screen", "Interview", "Offer"] as const;
const STAGE_ORDER: Record<string, number> = { Applied: 0, "Phone Screen": 1, Interview: 2, Offer: 3 };

const HEAT_LIGHT = ["#EDF2ED", "#F9D0E3", "#F2AECF", "#D4537E", "#A32059"];
const HEAT_DARK  = ["#1E1D26", "#3D2135", "#6B3A56", "#E07BA0", "#F0A8C0"];

const FUNNEL_LIGHT = ["#185FA5", "#6B9E6B", "#D4537E", "#3B6D11"];
const FUNNEL_DARK  = ["#78AEDE", "#7BB87B", "#E07BA0", "#7BC47B"];

function heatColor(count: number, dark: boolean): string {
  const scale = dark ? HEAT_DARK : HEAT_LIGHT;
  if (count === 0) return scale[0];
  if (count <= 2)  return scale[1];
  if (count <= 4)  return scale[2];
  if (count <= 7)  return scale[3];
  return scale[4];
}

export function InsightsTab({ jobs, onEdit }: { jobs: Job[]; onEdit: (j: Job) => void }) {
  const data = useMemo(() => {
    const sc: Record<string, number> = {};
    STATUSES.forEach((s) => (sc[s] = 0));
    const cc: Record<string, number> = {};
    const mc: Record<string, number> = {};
    const lc: Record<string, number> = {};
    const rc: Record<string, number> = {};
    jobs.forEach((j) => {
      sc[j.status] = (sc[j.status] || 0) + 1;
      if (j.company) cc[j.company] = (cc[j.company] || 0) + 1;
      if (j.date) {
        const m = j.date.slice(0, 7);
        mc[m] = (mc[m] || 0) + 1;
      }
      if (j.location) {
        const l = j.location.split(",")[0].trim();
        lc[l] = (lc[l] || 0) + 1;
      }
      const cat = j.roleCategory || classifyRole(j.role);
      rc[cat] = (rc[cat] || 0) + 1;
    });
    const maxS = Math.max(1, ...Object.values(sc));
    const topCo = Object.entries(cc).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxC = Math.max(1, ...topCo.map((x) => x[1]));
    const topLoc = Object.entries(lc).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxL = Math.max(1, ...topLoc.map((x) => x[1]));
    const topRoles = Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxR = Math.max(1, ...topRoles.map((x) => x[1]));
    const months = Object.entries(mc).sort((a, b) => (a[0] > b[0] ? 1 : -1)).slice(-8);
    const t = jobs.length;

    // Weekly volume — last 16 weeks
    const wc: Record<string, number> = {};
    jobs.forEach((j) => { if (j.date) { const m = weekMonday(j.date); wc[m] = (wc[m] || 0) + 1; } });
    const todayW = new Date(); todayW.setHours(0, 0, 0, 0);
    const thisMonday = weekMonday(todayW.toISOString().slice(0, 10));
    const weeks: { date: string; count: number }[] = [];
    for (let i = 15; i >= 0; i--) {
      const d = new Date(thisMonday + "T00:00:00"); d.setDate(d.getDate() - i * 7);
      const iso = d.toISOString().slice(0, 10);
      weeks.push({ date: iso, count: wc[iso] || 0 });
    }
    const maxW = Math.max(1, ...weeks.map((x) => x.count));

    // Personal funnel: how many reached at least each stage
    const funnelReached = FUNNEL_STAGES.map((s) =>
      jobs.filter((j) => (STAGE_ORDER[j.status] ?? -1) >= STAGE_ORDER[s]).length
    );

    // Heatmap: last 91 days (13 weeks)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayMap: Record<string, number> = {};
    jobs.forEach((j) => {
      if (j.date) dayMap[j.date] = (dayMap[j.date] || 0) + 1;
    });
    // Build grid starting from Monday 13 weeks ago
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 90);
    // Align to Monday
    const dow = startDate.getDay(); // 0=Sun
    startDate.setDate(startDate.getDate() - ((dow + 6) % 7));
    const heatGrid: { date: string; count: number }[][] = [];
    const cur = new Date(startDate);
    while (cur <= today) {
      const week: { date: string; count: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const iso = cur.toISOString().slice(0, 10);
        week.push({ date: iso, count: cur > today ? -1 : (dayMap[iso] || 0) });
        cur.setDate(cur.getDate() + 1);
      }
      heatGrid.push(week);
    }
    return {
      sc, maxS, topCo, maxC, topLoc, maxL, topRoles, maxR,
      weeks, maxW,
      funnelReached,
      heatGrid,
      conv: t ? Math.round((jobs.filter((j) => ["Interview", "Offer"].includes(j.status)).length / t) * 100) : 0,
      ofr: t ? Math.round((jobs.filter((j) => j.status === "Offer").length / t) * 100) : 0,
      rej: t ? Math.round((jobs.filter((j) => j.status === "Rejected").length / t) * 100) : 0,
      avg: months.length ? Math.round(months.reduce((a, x) => a + x[1], 0) / months.length) : 0,
    };
  }, [jobs]);

  const [heatTip, setHeatTip] = useState<{ date: string; count: number; x: number; y: number } | null>(null);
  const dark = useDarkMode();

  const noData = <div style={{ color: "var(--text-light)", fontSize: 13 }}>No data yet</div>;

  return (
    <div className="ig">
      <div className="ic">
        <div className="it">By status</div>
        {STATUSES.filter((s) => data.sc[s] > 0).length
          ? STATUSES.filter((s) => data.sc[s] > 0).map((s) => (
              <div className="br" key={s}>
                <div className="bl">{s}</div>
                <div className="bt"><div className="bf" style={{ width: `${Math.round((data.sc[s] / data.maxS) * 100)}%` }} /></div>
                <div className="bc">{data.sc[s]}</div>
              </div>
            ))
          : noData}
      </div>

      <div className="ic">
        <div className="it">Key metrics</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div><div className="bm">{data.conv}%</div><div className="ml">interview rate</div></div>
          <div><div className="bm sage">{data.ofr}%</div><div className="ml">offer rate</div></div>
          <div><div className="bm" style={{ color: "var(--danger)" }}>{data.rej}%</div><div className="ml">rejection rate</div></div>
          <div><div className="bm" style={{ color: "var(--text-mid)" }}>{data.avg}</div><div className="ml">apps / month</div></div>
        </div>
      </div>

      <div className="ic">
        <div className="it">Top locations</div>
        {data.topLoc.length
          ? data.topLoc.map(([l, n]) => (
              <div className="br" key={l}>
                <div className="bl">{l}</div>
                <div className="bt"><div className="bf pink" style={{ width: `${Math.round((n / data.maxL) * 100)}%` }} /></div>
                <div className="bc">{n}</div>
              </div>
            ))
          : noData}
      </div>

      <div className="ic">
        <div className="it">Top companies</div>
        {data.topCo.length
          ? data.topCo.map(([c, n]) => (
              <div className="br" key={c}>
                <div className="bl" style={{ minWidth: 120 }}>{c}</div>
                <div className="bt"><div className="bf pink" style={{ width: `${Math.round((n / data.maxC) * 100)}%` }} /></div>
                <div className="bc">{n}</div>
              </div>
            ))
          : noData}
      </div>

      <div className="ic" style={{ position: "relative" }}>
        <div className="it">Application pace</div>
        {heatTip && (
          <div style={{
            position: "fixed", left: heatTip.x + 10, top: heatTip.y - 36,
            background: dark ? "#2D2A3C" : "#1a1a1a",
            color: dark ? "#F0EBF8" : "#fff",
            fontSize: 12, borderRadius: 6,
            padding: "5px 9px", pointerEvents: "none", zIndex: 9999, whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,.35)",
          }}>
            <strong>{heatTip.count} app{heatTip.count !== 1 ? "s" : ""}</strong>
            <span style={{ opacity: 0.7, marginLeft: 6 }}>{heatTip.date}</span>
          </div>
        )}
        {jobs.some((j) => j.date) ? (
          <div style={{ overflowX: "auto", paddingTop: 4 }} onMouseLeave={() => setHeatTip(null)}>
            <div style={{ display: "flex", gap: 3, alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingTop: 2, marginRight: 4 }}>
                {["Mon", "", "Wed", "", "Fri", "", "Sun"].map((label, i) => (
                  <div key={i} style={{ height: 11, fontSize: 9, color: "var(--text-light)", lineHeight: "11px", width: 24, textAlign: "right" }}>
                    {label}
                  </div>
                ))}
              </div>
              {data.heatGrid.map((week, wi) => (
                <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {week.map((day, di) => (
                    <div
                      key={di}
                      onMouseEnter={day.count >= 0 ? (e) => setHeatTip({ date: day.date, count: day.count, x: e.clientX, y: e.clientY }) : undefined}
                      onMouseMove={day.count >= 0 ? (e) => setHeatTip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null) : undefined}
                      style={{
                        width: 11, height: 11, borderRadius: 2, cursor: day.count > 0 ? "default" : undefined,
                        background: day.count < 0 ? "transparent" : heatColor(day.count, dark),
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8, justifyContent: "flex-end" }}>
              <span style={{ fontSize: 10, color: "var(--text-light)" }}>Less</span>
              {(dark ? HEAT_DARK : HEAT_LIGHT).map((c) => (
                <div key={c} style={{ width: 11, height: 11, borderRadius: 2, background: c }} />
              ))}
              <span style={{ fontSize: 10, color: "var(--text-light)" }}>More</span>
            </div>
          </div>
        ) : (
          <div style={{ color: "var(--text-light)", fontSize: 13 }}>Add applications with dates to see your pace.</div>
        )}
      </div>

      <div className="ic">
        <div className="it">Role categories</div>
        {data.topRoles.length
          ? data.topRoles.map(([r, n]) => (
              <div className="br" key={r}>
                <div className="bl">{r}</div>
                <div className="bt"><div className="bf" style={{ width: `${Math.round((n / data.maxR) * 100)}%` }} /></div>
                <div className="bc">{n}</div>
              </div>
            ))
          : noData}
      </div>

      <div style={{ gridColumn: "1/-1", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="ic">
          <div className="it">Weekly application volume</div>
          {data.weeks.some((w) => w.count > 0) ? (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90, paddingTop: 8 }}>
              {data.weeks.map(({ date, count }) => {
                const day = parseInt(date.slice(8, 10));
                const showLabel = day <= 7;
                return (
                  <div key={date} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1 }}>
                    {count > 0 && <div style={{ fontSize: 10, color: "var(--text-light)", fontWeight: 500 }}>{count}</div>}
                    {count === 0 && <div style={{ fontSize: 10 }}>&nbsp;</div>}
                    <div style={{ background: "var(--pink-200)", borderRadius: "3px 3px 0 0", width: "100%", height: Math.round((count / data.maxW) * 60), minHeight: count > 0 ? 3 : 0 }} />
                    <div style={{ fontSize: 9, color: "var(--text-light)", whiteSpace: "nowrap" }}>{showLabel ? fmtWeekLabel(date) : ""}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: "var(--text-light)", fontSize: 13 }}>Add applications with dates to see weekly volume.</div>
          )}
        </div>

        <div className="ic">
          <div className="it">Your conversion funnel</div>
          {jobs.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
            {FUNNEL_STAGES.map((s, i) => {
              const n = data.funnelReached[i];
              const pct = jobs.length ? Math.round((n / jobs.length) * 100) : 0;
              const colors = dark ? FUNNEL_DARK : FUNNEL_LIGHT;
              return (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 96, fontSize: 12, color: "var(--text-mid)", flexShrink: 0 }}>{s}</div>
                  <div style={{ flex: 1, background: "var(--sage-100)", borderRadius: 4, height: 14, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: colors[i], borderRadius: 4, minWidth: n > 0 ? 4 : 0, transition: "width .3s" }} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-mid)", width: 52, flexShrink: 0, textAlign: "right" }}>{n} ({pct}%)</div>
                </div>
              );
            })}
          </div>
          ) : noData}
        </div>
      </div>

      <div style={{ gridColumn: "1/-1", marginTop: 14 }}>
        <TimelineTab jobs={jobs} onEdit={onEdit} />
      </div>
    </div>
  );
}
