"use client";

import { useEffect, useState } from "react";
import { useBloom } from "@/hooks/use-bloom";
import { AuthScreen } from "@/components/auth-screen";
import { TrackerTab } from "@/components/tracker-tab";
import { InsightsTab } from "@/components/insights-tab";
import { CommunityTab } from "@/components/community-tab";
import { LeetCodeTab } from "@/components/leetcode-tab";
import { JobsTab } from "@/components/jobs-tab";
import { InterviewPrepTab } from "@/components/interview-prep-tab";
import { ProfileTab } from "@/components/profile-tab";
import { ResumeTab } from "@/components/resume-tab";
import { NotesTab, NotesDrawer } from "@/components/notes-tab";
import { ApplicationDialog } from "@/components/application-dialog";
import { ImportDialog } from "@/components/import-dialog";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommunitySelector } from "@/components/community-selector";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShamePopup } from "@/components/shame-wall";
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
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);
  const [prefill, setPrefill] = useState<Record<string, string> | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

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
    setPrefill(null);
    setDialogOpen(true);
  }
  function openImport() {
    setImportOpen(true);
  }
  function openEdit(job: Job) {
    setEditing(job);
    setPrefill(null);
    setDialogOpen(true);
  }
  function openPrefilled(data: Record<string, string>) {
    setEditing(null);
    setPrefill(data);
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
    ["leetcode", "💻 LeetCode"],
    ["jobs", "💼 Jobs"],
    ["interview-prep", "🎤 Interview Prep"],
    ["resume", "📄 Resumes"],
    ["notes", "🗒️ Notes"],
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
          <CommunitySelector />
          <Button variant="outline" size="sm" className="rounded-full" onClick={exportCSV}>
            <i className="ti ti-download" /><span className="hidden sm:inline">Export CSV</span>
          </Button>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setFeedbackOpen(true)}>
            <i className="ti ti-message-report" /><span className="hidden sm:inline">Feedback</span>
          </Button>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setProfileOpen(true)}>
            <i className="ti ti-user" /><span className="hidden sm:inline max-w-[120px] truncate">{bloom.user.name || bloom.user.email}</span>
          </Button>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => bloom.signOut()}>
            <i className="ti ti-logout" /><span className="hidden sm:inline">Sign out</span>
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
                <TrackerTab jobs={bloom.myJobs} onAdd={openAdd} onEdit={openEdit} onToggleStar={bloom.toggleStar} onShareToBoard={bloom.shareJob} sharedJobKeys={bloom.sharedJobKeys} onImport={openImport} />
              </TabsContent>
              <TabsContent value="insights">
                <InsightsTab jobs={bloom.myJobs} onEdit={openEdit} />
              </TabsContent>
              <TabsContent value="leetcode">
                <LeetCodeTab userColors={bloom.userColors} />
              </TabsContent>
              <TabsContent value="jobs">
                <JobsTab posts={bloom.jobPosts} myJobs={bloom.myJobs} allJobs={bloom.allJobs} onShare={bloom.shareJob} onDelete={bloom.deleteJobPost} onRefresh={bloom.fetchJobPosts} onSaveToTracker={openPrefilled} />
              </TabsContent>
              <TabsContent value="interview-prep">
                <InterviewPrepTab
                  posts={bloom.interviewPrepPosts}
                  comments={bloom.interviewPrepComments}
                  companies={[...new Set(bloom.interviewPrepPosts.map((p) => p.company).filter(Boolean))]}
                  onCreate={bloom.createInterviewPrepPost}
                  onDelete={bloom.deleteInterviewPrepPost}
                  onAddComment={bloom.addInterviewPrepComment}
                  onFetchComments={bloom.fetchInterviewPrepComments}
                  onRefresh={bloom.fetchInterviewPrepPosts}
                />
              </TabsContent>
              <TabsContent value="resume" style={{ padding: 0 }}>
                <ResumeTab
                  resumes={bloom.resumes}
                  currentUid={bloom.user.id}
                  onUpload={bloom.uploadResume}
                  onDelete={bloom.deleteResume}
                />
              </TabsContent>
              <TabsContent value="notes">
                <NotesTab
                  value={bloom.notes}
                  onChange={bloom.setNotes}
                  saveState={bloom.notesSaveState}
                  loaded={bloom.notesLoaded}
                />
              </TabsContent>
              <TabsContent value="community">
                <CommunityTab allJobs={bloom.allJobs} feed={bloom.feed} userColors={bloom.userColors} />
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>

      <ApplicationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        job={editing}
        prefill={prefill}
        onSave={save}
        onDelete={bloom.deleteJob}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        existingJobs={bloom.myJobs}
        onImport={bloom.bulkCreateJobs}
      />

      <ShamePopup />

      {/* Pull-out notes panel — Applications tab only, per the tab's own
          workflow. It renders the same scratchpad as the Notes tab. */}
      {tab === "tracker" && (
        <NotesDrawer
          value={bloom.notes}
          onChange={bloom.setNotes}
          saveState={bloom.notesSaveState}
          loaded={bloom.notesLoaded}
        />
      )}

      {/* Profile dialog */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent style={{ maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }}>
          <DialogHeader>
            <DialogTitle>Your Profile</DialogTitle>
          </DialogHeader>
          <ProfileTab profile={bloom.profile} updateProfile={bloom.updateProfile} jobs={bloom.myJobs} />
        </DialogContent>
      </Dialog>

      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
}
