"use client";

import { useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UserProfile, Job } from "@/lib/types";
import { toast } from "sonner";
import { ForestTab } from "@/components/forest-tab";

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  if (!href) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--info)] underline break-all">
      {children}
    </a>
  );
}

export function ProfileTab({
  profile,
  updateProfile,
  jobs,
}: {
  profile: UserProfile | null;
  updateProfile: (data: Record<string, string>) => Promise<void>;
  jobs: Job[];
}) {
  const [editing, setEditing] = useState(false);
  const [githubUrl, setGithubUrl] = useState(profile?.githubUrl || "");
  const [linkedinUrl, setLinkedinUrl] = useState(profile?.linkedinUrl || "");
  const [websiteUrl, setWebsiteUrl] = useState(profile?.websiteUrl || "");
  const [leetcodeRepoUrl, setLeetcodeRepoUrl] = useState(profile?.leetcodeRepoUrl || "");
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const currentUser = auth.currentUser;

  async function handleSave() {
    setBusy(true);
    try {
      await updateProfile({
        githubUrl: githubUrl.trim(),
        linkedinUrl: linkedinUrl.trim(),
        websiteUrl: websiteUrl.trim(),
        leetcodeRepoUrl: leetcodeRepoUrl.trim(),
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword() {
    if (!currentUser?.email) {
      toast.error("No email found — cannot reset password.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, currentUser.email);
      setResetSent(true);
      toast.success("Password reset email sent — check your inbox.");
    } catch (e) {
      toast.error("Failed to send reset email — " + (e as Error).message);
    }
  }

  const fields = [
    { label: "GitHub", value: profile?.githubUrl, icon: "ti ti-brand-github" },
    { label: "LinkedIn", value: profile?.linkedinUrl, icon: "ti ti-brand-linkedin" },
    { label: "Website", value: profile?.websiteUrl, icon: "ti ti-world" },
    { label: "LeetCode Repo", value: profile?.leetcodeRepoUrl, icon: "ti ti-code" },
  ];

  return (
    <div>
      <div className="sec-header">
        <span className="sec-title">👤 Your Profile</span>
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditing(!editing)}>
          {editing ? <><i className="ti ti-x" /> Cancel</> : <><i className="ti ti-pencil" /> Edit</>}
        </Button>
      </div>

      <div className="stats-row" style={{ gridTemplateColumns: "1fr" }}>
        <div className="stat-card" style={{ textAlign: "left", padding: "20px" }}>
          <div className="it" style={{ marginBottom: 16 }}>Account</div>
          <div className="flex flex-col gap-3" style={{ fontSize: 13, color: "var(--text-mid)" }}>
            <div><strong style={{ color: "var(--text-dark)", minWidth: 100, display: "inline-block" }}>Name</strong> {profile?.name || currentUser?.displayName || "—"}</div>
            <div><strong style={{ color: "var(--text-dark)", minWidth: 100, display: "inline-block" }}>Email</strong> {profile?.email || currentUser?.email || "—"}</div>
          </div>
        </div>
      </div>

      {editing ? (
        <div className="feed-card">
          <div className="it" style={{ marginBottom: 14 }}>Edit Social Links</div>
          <div className="flex flex-col gap-4">
            <div className="fg">
              <Label htmlFor="pf-github">GitHub URL</Label>
              <Input id="pf-github" placeholder="https://github.com/username" value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} />
            </div>
            <div className="fg">
              <Label htmlFor="pf-linkedin">LinkedIn URL</Label>
              <Input id="pf-linkedin" placeholder="https://linkedin.com/in/username" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
            </div>
            <div className="fg">
              <Label htmlFor="pf-website">Personal Website</Label>
              <Input id="pf-website" placeholder="https://example.com" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
            </div>
            <div className="fg">
              <Label htmlFor="pf-leetcode">LeetCode Repo (GitHub)</Label>
              <Input id="pf-leetcode" placeholder="https://github.com/username/leetcode" value={leetcodeRepoUrl} onChange={(e) => setLeetcodeRepoUrl(e.target.value)} />
              <p className="text-xs text-muted-foreground">Add your LeetHub/LeetSync repo to track progress with the community.</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={busy} className="w-full">{busy ? "Saving…" : "Save Profile"}</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="feed-card">
          <div className="it" style={{ marginBottom: 14 }}>Social Links</div>
          {fields.map((f) => (
            <div key={f.label} className="flex items-center gap-3 py-2 border-b border-[var(--sage-50)] last:border-0">
              <i className={f.icon} style={{ fontSize: 18, color: "var(--text-light)", width: 20, textAlign: "center" }} />
              <div className="flex-1">
                <div className="text-xs font-semibold text-[var(--text-mid)] uppercase tracking-wider">{f.label}</div>
                <ExternalLink href={f.value || ""}>{f.value || "Not set"}</ExternalLink>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="feed-card" style={{ marginTop: 14 }}>
        <div className="it" style={{ marginBottom: 14 }}>Security</div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-[var(--text-dark)]">Password</div>
              <div className="text-xs text-[var(--text-light)]">Reset your password via email</div>
            </div>
            <Button variant="outline" size="sm" className="rounded-full" onClick={handleResetPassword} disabled={resetSent}>
              <i className="ti ti-mail" /> {resetSent ? "Sent" : "Reset Password"}
            </Button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <ForestTab jobs={jobs} />
      </div>
    </div>
  );
}
