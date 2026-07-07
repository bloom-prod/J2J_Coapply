"use client";

import { useCallback, useMemo, useState } from "react";
import type { Job } from "@/lib/types";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DiscoverCompany {
  company: string;
  roles: string[];
  urls: string[];
  appliedBy: string[];
  statuses: string[];
  count: number;
}

/** Collapse all whitespace (including non-breaking spaces) to a single regular space, lowercase, trim. */
function cleanCompany(name: string): string {
  return name.replace(/[\s\u00A0\u200B]+/g, " ").toLowerCase().trim();
}

/** Normalize a company name for fuzzy matching: strip suffixes like "inc", "capital", "labs", etc. */
function normalizeCompany(name: string): string {
  return cleanCompany(name)
    .replace(/[.,\-]+$/g, "")
    .replace(/\s+(inc|llc|ltd|co|corp|corporation|group|capital|labs|technologies|tech|solutions|software|services|holdings|consulting)\.?$/gi, "")
    .trim();
}

/** Check if two company names are "close enough" to be the same company */
function isSameCompany(a: string, b: string): boolean {
  const ca = cleanCompany(a);
  const cb = cleanCompany(b);
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
  const [sortBy, setSortBy] = useState<"popular" | "alpha">("popular");

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
    const key = cleanCompany(company);
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const myCompanyNames = useMemo(
    () => myJobs.map((j) => cleanCompany(j.company)).filter(Boolean),
    [myJobs]
  );

  const discoveries = useMemo(() => {
    const map = new Map<string, DiscoverCompany>();

    // Group jobs by company first, then deduplicate:
    // if any job for a company has a URL, discard the ones without a URL.
    const companyJobs = new Map<string, Job[]>();
    for (const j of allJobs) {
      if (!j.company) continue;
      const key = cleanCompany(j.company);
      if (myCompanyNames.some((my) => isSameCompany(my, key))) continue;
      if (dismissed.has(key)) continue;
      if (!companyJobs.has(key)) companyJobs.set(key, []);
      companyJobs.get(key)!.push(j);
    }

    for (const [key, jobs] of companyJobs) {
      const hasAnyUrl = jobs.some((j) => !!j.url);
      const filtered = hasAnyUrl ? jobs.filter((j) => !!j.url) : jobs;

      const entry: DiscoverCompany = {
        company: filtered[0].company,
        roles: [],
        urls: [],
        appliedBy: [],
        statuses: [],
        count: filtered.length,
      };

      for (const j of filtered) {
        if (j.role && !entry.roles.includes(j.role)) entry.roles.push(j.role);
        if (j.url && !entry.urls.includes(j.url)) entry.urls.push(j.url);
        if (j.ownerName && !entry.appliedBy.includes(j.ownerName))
          entry.appliedBy.push(j.ownerName);
        if (j.status && !entry.statuses.includes(j.status))
          entry.statuses.push(j.status);
      }

      map.set(key, entry);
    }

    let list = [...map.values()];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.company.toLowerCase().includes(q) ||
          c.roles.some((r) => r.toLowerCase().includes(q))
      );
    }

    if (sortBy === "popular") {
      list.sort((a, b) => b.count - a.count);
    } else {
      list.sort((a, b) => a.company.localeCompare(b.company));
    }

    return list;
  }, [allJobs, myCompanyNames, dismissed, search, sortBy]);

  const hasOfferOrInterview = (statuses: string[]) =>
    statuses.includes("Offer") || statuses.includes("Interview");

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
            className="h-9 w-[240px] rounded-full"
            placeholder="Search companies or roles..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as "popular" | "alpha")}>
            <SelectTrigger className="h-9 w-[150px] rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="popular">Most popular</SelectItem>
              <SelectItem value="alpha">A &rarr; Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <span style={{ fontSize: 13, color: "var(--text-light)", whiteSpace: "nowrap" }}>
          {discoveries.length} {discoveries.length === 1 ? "company" : "companies"}
        </span>
      </div>

      {discoveries.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">
            {search
              ? "No matches found"
              : "You've covered all the companies!"}
          </div>
          <div style={{ fontSize: 13 }}>
            {search
              ? "Try a different search term."
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
                {hasOfferOrInterview(d.statuses) && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      borderRadius: 99,
                      background: d.statuses.includes("Offer")
                        ? "var(--success)"
                        : "var(--info)",
                      color: "#fff",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {d.statuses.includes("Offer") ? "Has offers" : "Interviewing"}
                  </span>
                )}
              </div>

              {d.roles.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    marginBottom: 10,
                  }}
                >
                  {d.roles.slice(0, 5).map((r) => (
                    <span
                      key={r}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 99,
                        background: dark
                          ? "rgba(120,174,222,.15)"
                          : "rgba(24,95,165,.08)",
                        color: dark ? "#78AEDE" : "#185FA5",
                      }}
                    >
                      {r}
                    </span>
                  ))}
                  {d.roles.length > 5 && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--text-light)",
                        padding: "2px 4px",
                      }}
                    >
                      +{d.roles.length - 5} more
                    </span>
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
                    color: "var(--sage-400)",
                  }}
                  onClick={() =>
                    onSaveToTracker({
                      company: d.company,
                      role: d.roles[0] || "",
                      url: d.urls[0] || "",
                      status: "Want to Apply",
                    })
                  }
                  title="Add to your tracker"
                >
                  <i className="ti ti-plus" /> Add to tracker
                </button>
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
