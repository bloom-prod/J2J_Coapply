"use client";

import { useEffect, useState } from "react";
import { useBloom } from "@/hooks/use-bloom";
import { AuthScreen } from "@/components/auth-screen";
import { TrackerTab } from "@/components/tracker-tab";
import { InsightsTab } from "@/components/insights-tab";
import { TimelineTab } from "@/components/timeline-tab";
import { ForestTab } from "@/components/forest-tab";
import { CommunityTab } from "@/components/community-tab";
import { ApplicationDialog } from "@/components/application-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { Job } from "@/lib/types";

const CSV_HEADERS = [
  "id", "company", "role", "status", "priority", "location", "date",
  "salary", "url", "recruiter", "followup", "notes", "starred", "added", "updated",
];

function FullSpinner() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "hsl(var(--background))" }}>
      <div style={{ textAlign: "center" }}>
        <div className="spinner" />
        <div style={{ fontSize: 14, color: "var(--text-mid)" }}>Loading…</div>
      </div>
    </div>
  );
}

export default function Page() {
  const bloom = useBloom();
  const [tab, setTab] = useState("tracker");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (bloom.user) {
          setEditing(null);
          setDialogOpen(true);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bloom.user]);

  if (!bloom.authReady) return <FullSpinner />;
  if (!bloom.user) return <AuthScreen />;

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(job: Job) {
    setEditing(job);
    setDialogOpen(true);
  }
  function save(id: string | null, data: Record<string, string>) {
    if (id) bloom.updateJob(id, data);
    else bloom.createJob(data);
  }
  function exportCSV() {
    const rows = [CSV_HEADERS, ...bloom.myJobs.map((j) => CSV_HEADERS.map((h) => `"${String((j as unknown as Record<string, unknown>)[h] ?? "").replace(/"/g, '""')}"`))]
      .map((r) => r.join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(rows);
    a.download = "bloom-tracker-export.csv";
    a.click();
  }

  const NAV = [
    ["tracker", "📋 Applications"],
    ["insights", "📊 Insights"],
    ["timeline", "🗓 Timeline"],
    ["forest", "🌳 My Forest"],
    ["community", "🌍 Community"],
  ] as const;

  return (
    <div>
      <div className="topbar">
        <div className="logo">
          <div className="logo-icon">🌿</div>
          <div>
            <div className="logo-text">bloom tracker</div>
            <div className="logo-sub">{bloom.myJobs.length} applications</div>
          </div>
        </div>
        <div className="topbar-right">
          <ThemeToggle />
          <Button variant="outline" size="sm" className="rounded-full" onClick={exportCSV}>
            <i className="ti ti-download" /> Export CSV
          </Button>
          <span className="user-chip">
            <i className="ti ti-user" /> {bloom.user.displayName || bloom.user.email}
          </span>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => bloom.signOut()}>
            <i className="ti ti-logout" /> Sign out
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="nav">
          {NAV.map(([value, label]) => (
            <TabsTrigger key={value} value={value} className="nav-tab">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="main">
          {bloom.loading ? (
            <div style={{ textAlign: "center", padding: 80 }}>
              <div className="spinner" />
              <div style={{ fontSize: 14, color: "var(--text-mid)" }}>Loading your garden...</div>
            </div>
          ) : (
            <>
              <TabsContent value="tracker">
                <TrackerTab jobs={bloom.myJobs} onAdd={openAdd} onEdit={openEdit} onToggleStar={bloom.toggleStar} />
              </TabsContent>
              <TabsContent value="insights">
                <InsightsTab jobs={bloom.myJobs} />
              </TabsContent>
              <TabsContent value="timeline">
                <TimelineTab jobs={bloom.myJobs} onEdit={openEdit} />
              </TabsContent>
              <TabsContent value="forest">
                <ForestTab jobs={bloom.myJobs} />
              </TabsContent>
              <TabsContent value="community">
                <CommunityTab allJobs={bloom.allJobs} feed={bloom.feed} />
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>

      <ApplicationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        job={editing}
        onSave={save}
        onDelete={bloom.deleteJob}
      />
    </div>
  );
}
