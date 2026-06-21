"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { STATUSES, type Job } from "@/lib/types";
import { fmtDate, isStarred, PRIORITY_ORDER, statusKey } from "@/lib/job-utils";

const FILTERS = ["All", ...STATUSES, "⭐"] as const;

export function TrackerTab({
  jobs,
  onAdd,
  onEdit,
  onToggleStar,
  onShareToBoard,
}: {
  jobs: Job[];
  onAdd: () => void;
  onEdit: (job: Job) => void;
  onToggleStar: (id: string) => void;
  onShareToBoard: (data: { company: string; role: string; url: string; location: string; notes: string }) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("All");
  const [sf, setSf] = useState("date");
  const [sd, setSd] = useState(-1);
  const [sharingId, setSharingId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const t = jobs.length;
    return {
      total: t,
      active: jobs.filter((j) => ["Applied", "Phone Screen", "Interview"].includes(j.status)).length,
      interview: jobs.filter((j) => j.status === "Interview").length,
      offer: jobs.filter((j) => j.status === "Offer").length,
      wantToApply: jobs.filter((j) => j.status === "Want to Apply").length,
      rate: t ? Math.round((jobs.filter((j) => !["Want to Apply", "Applied", "Ghosted"].includes(j.status)).length / t) * 100) + "%" : "0%",
      star: jobs.filter((j) => isStarred(j)).length,
    };
  }, [jobs]);

  const list = useMemo(() => {
    const query = q.toLowerCase();
    const out = jobs.filter((j) => {
      const mf = filter === "All" ? true : filter === "⭐" ? isStarred(j) : j.status === filter;
      const ms = !query || (j.company + j.role + j.location + j.notes + j.recruiter).toLowerCase().includes(query);
      return mf && ms;
    });
    out.sort((a, b) => {
      if (sf === "priority") return (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) * sd;
      const va = (a as unknown as Record<string, string>)[sf] || "";
      const vb = (b as unknown as Record<string, string>)[sf] || "";
      return va < vb ? -sd : va > vb ? sd : 0;
    });
    return out;
  }, [jobs, q, filter, sf, sd]);

  async function handleShareToBoard(j: Job) {
    if (!j.url) {
      toast.error("Add an apply URL to this job before sharing");
      return;
    }
    setSharingId(j.id);
    try {
      await onShareToBoard({ company: j.company, role: j.role, url: j.url, location: j.location, notes: j.notes });
      toast.success(`${j.company} — ${j.role} shared to Job Board 💼`);
    } catch (e) {
      toast.error("Share failed — " + (e as Error).message);
    } finally {
      setSharingId(null);
    }
  }

  function sortBy(field: string) {
    if (sf === field) setSd((d) => d * -1);
    else {
      setSf(field);
      setSd(1);
    }
  }
  const arrow = (f: string) => (sf === f ? (sd === 1 ? "↑" : "↓") : "↕");

  return (
    <div>
      <div className="stats-row">
        <div className="stat-card"><div className="stat-num">{stats.total}</div><div className="stat-label">Total</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "#5B4B6B" }}>{stats.wantToApply}</div><div className="stat-label">Want to Apply</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--info)" }}>{stats.active}</div><div className="stat-label">Active</div></div>
        <div className="stat-card sage"><div className="stat-num">{stats.interview}</div><div className="stat-label">Interviews</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--success)" }}>{stats.offer}</div><div className="stat-label">Offers</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--pink-400)" }}>{stats.star}</div><div className="stat-label">Starred</div></div>
      </div>

      <div className="sec-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="sec-title">Applications</span>
          <Input className="h-9 w-[190px] rounded-full" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button className="rounded-full" onClick={onAdd}>
          <i className="ti ti-plus" /> Add application
        </Button>
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <span
            key={f}
            className={`chip${filter === f ? " active" : ""}`}
            style={f === "⭐" ? { marginLeft: "auto" } : undefined}
            onClick={() => setFilter(f)}
          >
            {f === "⭐" ? "⭐ Starred" : f}
          </span>
        ))}
      </div>

      <div className="table-wrap">
        <table className="bloom">
          <thead>
            <tr>
              <th style={{ width: 36 }}></th>
              <th onClick={() => sortBy("company")} style={{ width: "17%" }}>Company {arrow("company")}</th>
              <th onClick={() => sortBy("role")} style={{ width: "22%" }}>Role {arrow("role")}</th>
              <th onClick={() => sortBy("status")} style={{ width: "12%" }}>Status {arrow("status")}</th>
              <th onClick={() => sortBy("date")} style={{ width: "10%" }}>Applied {arrow("date")}</th>
              <th onClick={() => sortBy("location")} style={{ width: "14%" }}>Location {arrow("location")}</th>
              <th onClick={() => sortBy("priority")} style={{ width: "9%" }}>Priority {arrow("priority")}</th>
              <th style={{ width: "10%" }}>Salary</th>
              <th style={{ width: "6%", textAlign: "right", paddingRight: 12 }}></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className="empty">
                    <div className="empty-icon">🌱</div>
                    <div className="empty-title">{jobs.length ? "No matching applications" : "Your garden is empty"}</div>
                    <div style={{ fontSize: 13 }}>{jobs.length ? "Try a different filter." : "Add your first application to get started."}</div>
                  </div>
                </td>
              </tr>
            ) : (
              list.map((j) => (
                <tr key={j.id} onDoubleClick={() => onEdit(j)}>
                  <td>
                    <button className={`star-btn${isStarred(j) ? " on" : ""}`} onClick={() => onToggleStar(j.id)}>
                      {isStarred(j) ? "★" : "☆"}
                    </button>
                  </td>
                  <td style={{ fontWeight: 600, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={j.company}>{j.company}</td>
                  <td style={{ color: "var(--text-mid)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={j.role}>{j.role}</td>
                  <td><span className={`pill s-${statusKey(j.status)}`}>{j.status}</span></td>
                  <td style={{ color: "var(--text-light)", fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(j.date)}</td>
                  <td style={{ color: "var(--text-light)", fontSize: 12, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.location || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className={`pdot p-${j.priority || "Medium"}`}></span>
                    <span style={{ fontSize: 12, color: "var(--text-mid)" }}>{j.priority || "—"}</span>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-light)", whiteSpace: "nowrap" }}>{j.salary || "—"}</td>
                  <td style={{ textAlign: "right", paddingRight: 10, whiteSpace: "nowrap" }}>
                    {j.url && (
                      <a href={j.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                        <button className="abtn" title="Posting"><i className="ti ti-external-link" /></button>
                      </a>
                    )}
                    <button
                      className="abtn"
                      title={j.url ? "Share to Job Board" : "Add a URL first to share"}
                      disabled={sharingId === j.id}
                      onClick={() => handleShareToBoard(j)}
                      style={{ opacity: j.url ? 1 : 0.35 }}
                    >
                      <i className={sharingId === j.id ? "ti ti-loader-2" : "ti ti-share"} />
                    </button>
                    <button className="abtn" onClick={() => onEdit(j)} title="Edit"><i className="ti ti-edit" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
