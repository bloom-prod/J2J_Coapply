"use client";

import { useCallback, useMemo, useState } from "react";
import type { Job } from "@/lib/types";
import { fmtDate } from "@/lib/job-utils";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * One role at a company, with the posting link and application date that
 * belong to *that* role. Several people can apply to the same role, so the
 * applicants and statuses are aggregated per role rather than per company.
 */
interface DiscoverRole {
  role: string;
  /** First non-empty posting URL seen for this role ("" if nobody recorded one). */
  url: string;
  /** Earliest date anyone applied to this role, as YYYY-MM-DD ("" if unknown). */
  firstApplied: string;
  /** Most recent date anyone applied to this role, as YYYY-MM-DD ("" if unknown). */
  latestApplied: string;
  appliedBy: string[];
  statuses: string[];
}

interface DiscoverCompany {
  company: string;
  roles: DiscoverRole[];
  appliedBy: string[];
  count: number;
  /** Most recent application date across this company's jobs (ISO-ish string, "" if unknown). */
  latestDate: string;
}

/** Collapse all whitespace (including non-breaking spaces) to a single regular space, lowercase, trim. Used to key both company and role names. */
function cleanName(name: string): string {
  return name.replace(/[\s\u00A0\u200B]+/g, " ").toLowerCase().trim();
}

/** Normalize a company name for fuzzy matching: strip suffixes like "inc", "capital", "labs", etc. */
function normalizeCompany(name: string): string {
  return cleanName(name)
    .replace(/[.,\-]+$/g, "")
    .replace(/\s+(inc|llc|ltd|co|corp|corporation|group|capital|labs|technologies|tech|solutions|software|services|holdings|consulting)\.?$/gi, "")
    .trim();
}

/** Check if two company names are "close enough" to be the same company */
function isSameCompany(a: string, b: string): boolean {
  const ca = cleanName(a);
  const cb = cleanName(b);
  if (ca === cb) return true;
  // one contains the other (e.g. "burford" vs "burford capital")
  if (ca.length >= 3 && cb.length >= 3) {
    if (ca.includes(cb) || cb.includes(ca)) return true;
  }
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (na === nb) return true;
  if (na.length >= 3 && nb.length >= 3) {
    if (na.includes(nb) || nb.includes(na)) return true;
  }
  return false;
}

/** The day a job was applied on, as YYYY-MM-DD, falling back to when it was added. */
function appliedDay(j: Job): string {
  return String(j.date || j.added || "").slice(0, 10);
}

/** Who applied to a role and how far they got, for the role row's hover text. */
function roleTooltip(r: DiscoverRole): string {
  const parts = [r.role];
  if (r.appliedBy.length) parts.push("applied by " + r.appliedBy.join(", "));
  if (r.statuses.length) parts.push(r.statuses.join(", "));
  return parts.join(" — ");
}

/** How many roles a company card shows before collapsing the rest behind a toggle. */
const ROLE_PREVIEW = 4;

export function DiscoverTab({
  allJobs,
  myJobs,
  onSaveToTracker,
}: {
  allJobs: Job[];
  myJobs: Job[];
  onSaveToTracker: (data: Record<string, string>) => void;

}) {
  const dark = useDarkMode();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "popular" | "alpha">("recent");
  // When on, only roles somebody saved a posting link for are shown — the rest
  // are dead ends you can't actually apply to from here.
  const [linkedOnly, setLinkedOnly] = useState(false);
  // Company keys whose full role list is showing (session-only, unlike dismissals).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((company: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(company)) next.delete(company);
      else next.add(company);
      return next;
    });
  }, []);

  const DISMISSED_KEY = "discover-dismissed";
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(DISMISSED_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const dismissCompany = useCallback((company: string) => {
    const key = cleanName(company);
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const myCompanyNames = useMemo(
    () => myJobs.map((j) => cleanName(j.company)).filter(Boolean),
    [myJobs]
  );

  const discoveries = useMemo(() => {
    const map = new Map<string, DiscoverCompany>();

    // Group jobs by company first; the per-role breakdown happens below.
    const companyJobs = new Map<string, Job[]>();
    for (const j of allJobs) {
      if (!j.company) continue;
      const key = cleanName(j.company);
      if (myCompanyNames.some((my) => isSameCompany(my, key))) continue;
      if (dismissed.has(key)) continue;
      if (!companyJobs.has(key)) companyJobs.set(key, []);
      companyJobs.get(key)!.push(j);
    }

    for (const [key, jobs] of companyJobs) {
      // A company-wide URL filter would drop a whole role just because the one
      // person who applied to it never saved a link, so keep every job here and
      // resolve the link per role below.
      const entry: DiscoverCompany = {
        company: jobs[0].company,
        roles: [],
        appliedBy: [],
        count: jobs.length,
        latestDate: "",
      };

      // Roles are free text, so two people typing the same title with different
      // casing/spacing are the same role — merge on a normalized key but show
      // the first spelling seen.
      const byRole = new Map<string, DiscoverRole>();

      for (const j of jobs) {
        const applied = appliedDay(j);
        if (applied > entry.latestDate) entry.latestDate = applied;
        if (j.ownerName && !entry.appliedBy.includes(j.ownerName))
          entry.appliedBy.push(j.ownerName);

        if (!j.role) continue;
        const roleKey = cleanName(j.role);
        let r = byRole.get(roleKey);
        if (!r) {
          r = {
            role: j.role,
            url: "",
            firstApplied: "",
            latestApplied: "",
            appliedBy: [],
            statuses: [],
          };
          byRole.set(roleKey, r);
        }
        if (!r.url && j.url) r.url = j.url;
        if (applied) {
          if (!r.firstApplied || applied < r.firstApplied) r.firstApplied = applied;
          if (applied > r.latestApplied) r.latestApplied = applied;
        }
        if (j.ownerName && !r.appliedBy.includes(j.ownerName)) r.appliedBy.push(j.ownerName);
        if (j.status && !r.statuses.includes(j.status)) r.statuses.push(j.status);
      }

      // Most recently applied role first; undated roles sink to the bottom.
      entry.roles = [...byRole.values()]
        .filter((r) => !linkedOnly || r.url)
        .sort(
          (a, b) =>
            b.latestApplied.localeCompare(a.latestApplied) ||
            a.role.localeCompare(b.role)
        );

      // A company whose every role lost its link has nothing left to show.
      if (linkedOnly && entry.roles.length === 0) continue;

      map.set(key, entry);
    }

    let list = [...map.values()];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.company.toLowerCase().includes(q) ||
          c.roles.some((r) => r.role.toLowerCase().includes(q))
      );
    }

    if (sortBy === "recent") {
      // Newest application first; companies with no date sink to the bottom.
      list.sort(
        (a, b) =>
          b.latestDate.localeCompare(a.latestDate) ||
          b.count - a.count ||
          a.company.localeCompare(b.company)
      );
    } else if (sortBy === "popular") {
      list.sort((a, b) => b.count - a.count);
    } else {
      list.sort((a, b) => a.company.localeCompare(b.company));
    }

    return list;
  }, [allJobs, myCompanyNames, dismissed, search, sortBy, linkedOnly]);

  return (
    <div>
      <div className="sec-header" style={{ marginBottom: 6 }}>
        <span className="sec-title">Discover companies</span>
      </div>
      <div className="privacy-note">
        <i className="ti ti-compass" /> Companies others have applied to that
        you haven&apos;t explored yet.
      </div>

      <div className="sec-header" style={{ marginTop: 10, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Input
            className="h-9 w-full sm:w-[240px] rounded-full"
            placeholder="Search companies or roles..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as "recent" | "popular" | "alpha")}>
            <SelectTrigger className="h-9 w-full sm:w-[150px] rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Newest applied</SelectItem>
              <SelectItem value="popular">Most popular</SelectItem>
              <SelectItem value="alpha">A &rarr; Z</SelectItem>
            </SelectContent>
          </Select>
          <button
            type="button"
            className={"chip" + (linkedOnly ? " active" : "")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: "2.25rem",
              padding: "0 14px",
              borderRadius: 9999,
            }}
            aria-pressed={linkedOnly}
            onClick={() => setLinkedOnly((v) => !v)}
            title="Only show roles somebody saved a posting link for"
          >
            <i className={"ti " + (linkedOnly ? "ti-link" : "ti-link-off")} />
            Has link
          </button>
        </div>
        <span style={{ fontSize: 13, color: "var(--text-light)", whiteSpace: "nowrap" }}>
          {discoveries.length} {discoveries.length === 1 ? "company" : "companies"}
        </span>
      </div>

      {discoveries.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">
            {search || linkedOnly
              ? "No matches found"
              : "You've covered all the companies!"}
          </div>
          <div style={{ fontSize: 13 }}>
            {search
              ? "Try a different search term."
              : linkedOnly
                ? "Nobody saved a posting link for the roles left — turn off “Has link” to see them."
                : "Everyone's applied to the same companies as you — nice coverage!"}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 12,
          }}
        >
          {discoveries.map((d) => (
            <div
              key={d.company}
              className="chart-card"
              style={{ padding: "14px 16px" }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 8,
                }}
              >
                <div>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      color: "var(--text)",
                    }}
                  >
                    {d.company}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-light)",
                      marginTop: 2,
                    }}
                  >
                    {d.count} {d.count === 1 ? "application" : "applications"}{" "}
                    by {d.appliedBy.join(", ")}
                  </div>
                </div>
              </div>

              {d.roles.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    marginBottom: 10,
                  }}
                >
                  {(expanded.has(d.company)
                    ? d.roles
                    : d.roles.slice(0, ROLE_PREVIEW)
                  ).map((r) => (
                    <div
                      key={r.role}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "5px 8px",
                        borderRadius: 8,
                        background: dark
                          ? "rgba(120,174,222,.10)"
                          : "rgba(24,95,165,.05)",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: dark ? "#78AEDE" : "#185FA5",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                          minWidth: 0,
                        }}
                        title={roleTooltip(r)}
                      >
                        {r.role}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--text-light)",
                          whiteSpace: "nowrap",
                        }}
                        title={
                          r.firstApplied && r.firstApplied !== r.latestApplied
                            ? "Applied between " +
                              fmtDate(r.firstApplied) +
                              " and " +
                              fmtDate(r.latestApplied)
                            : undefined
                        }
                      >
                        {r.latestApplied ? fmtDate(r.latestApplied) : "\u2014"}
                      </span>
                      {r.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: 12,
                            color: "var(--sage-400)",
                            display: "flex",
                            alignItems: "center",
                          }}
                          title="Open the posting for this role"
                        >
                          <i className="ti ti-external-link" />
                        </a>
                      ) : (
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--text-light)",
                            opacity: 0.4,
                            display: "flex",
                            alignItems: "center",
                          }}
                          title="Nobody saved a link for this role"
                        >
                          <i className="ti ti-link-off" />
                        </span>
                      )}
                      <button
                        className="abtn"
                        style={{
                          fontSize: 12,
                          color: "var(--sage-400)",
                          display: "flex",
                          alignItems: "center",
                        }}
                        onClick={() =>
                          onSaveToTracker({
                            company: d.company,
                            role: r.role,
                            url: r.url,
                            status: "Want to Apply",
                          })
                        }
                        title="Add this role to your tracker"
                      >
                        <i className="ti ti-plus" />
                      </button>
                    </div>
                  ))}
                  {d.roles.length > ROLE_PREVIEW && (
                    <button
                      className="abtn"
                      style={{
                        fontSize: 11,
                        color: "var(--text-light)",
                        padding: "2px 4px",
                        alignSelf: "flex-start",
                      }}
                      onClick={() => toggleExpanded(d.company)}
                    >
                      {expanded.has(d.company)
                        ? "Show fewer roles"
                        : "+" +
                          (d.roles.length - ROLE_PREVIEW) +
                          (d.roles.length - ROLE_PREVIEW === 1
                            ? " more role"
                            : " more roles")}
                    </button>
                  )}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  className="abtn"
                  style={{
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    color: "var(--text-light)",
                  }}
                  onClick={() => dismissCompany(d.company)}
                  title="Dismiss this company"
                >
                  <i className="ti ti-x" /> Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
