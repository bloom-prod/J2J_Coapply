"use client";

import { useMemo } from "react";
import type { Job } from "@/lib/types";
import { fmtDate, statusKey } from "@/lib/job-utils";

export function TimelineTab({ jobs, onEdit }: { jobs: Job[]; onEdit: (j: Job) => void }) {
  const sorted = useMemo(
    () => [...jobs].filter((j) => j.date).sort((a, b) => (b.date > a.date ? 1 : -1)),
    [jobs]
  );

  return (
    <div>
      <div className="sec-header" style={{ marginBottom: 14 }}>
        <span className="sec-title">Application timeline</span>
      </div>
      <div className="tl-list">
        {sorted.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🗓</div>
            <div className="empty-title">No dated applications</div>
            <div style={{ fontSize: 13 }}>Add a date when applying to see your timeline.</div>
          </div>
        ) : (
          sorted.map((j, i) => (
            <div className="tl-row" key={j.id}>
              <div className="tl-dc">
                <div className="tl-dot" />
                {i < sorted.length - 1 && <div className="tl-line" />}
              </div>
              <div style={{ flex: 1 }}>
                <div className="tl-co">{j.company}</div>
                <div className="tl-role">
                  {j.role}
                  {j.location && <> · <span style={{ color: "var(--text-light)" }}>{j.location}</span></>}
                </div>
                <div className="tl-meta">
                  <span className={`pill s-${statusKey(j.status)}`} style={{ fontSize: 10, padding: "2px 9px" }}>{j.status}</span>
                  <span className="tl-date">{fmtDate(j.date)}</span>
                  {j.followup && <span className="tl-date" style={{ color: "var(--sage-400)" }}>· follow-up {fmtDate(j.followup)}</span>}
                </div>
              </div>
              <button className="abtn" onClick={() => onEdit(j)} title="Edit"><i className="ti ti-edit" /></button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
