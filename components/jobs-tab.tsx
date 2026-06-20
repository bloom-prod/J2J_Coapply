"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";
import { timeAgo } from "@/lib/job-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { JobPost } from "@/lib/types";

interface Props {
  posts: JobPost[];
  onShare: (data: { company: string; role: string; url: string; location: string; notes: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

const EMPTY = { company: "", role: "", url: "", location: "", notes: "" };

export function JobsTab({ posts, onShare, onDelete, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }

  const myUid = auth.currentUser?.uid;

  function set(field: string, val: string) {
    setForm((f) => ({ ...f, [field]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company.trim() || !form.role.trim() || !form.url.trim()) {
      toast.error("Company, role, and apply URL are required");
      return;
    }
    setSaving(true);
    try {
      await onShare(form);
      setForm(EMPTY);
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  }

  const uniquePosters = new Set(posts.map((p) => p.ownerUid)).size;

  return (
    <div>
      <div className="sec-header" style={{ marginBottom: 6 }}>
        <span className="sec-title">💼 Job Board</span>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="outline" size="sm" className="rounded-full" onClick={handleRefresh} disabled={refreshing}>
            <i className="ti ti-refresh" /> {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setShowForm((v) => !v)}>
            <i className="ti ti-plus" /> Share a Job
          </Button>
        </div>
      </div>
      <div className="privacy-note">
        <i className="ti ti-info-circle" /> Found a cool opening? Share it with the group so everyone can apply.
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="job-share-form">
          <div className="job-share-form-grid">
            <div className="fg">
              <Label htmlFor="jb-company">Company *</Label>
              <Input id="jb-company" placeholder="Google" value={form.company} onChange={(e) => set("company", e.target.value)} />
            </div>
            <div className="fg">
              <Label htmlFor="jb-role">Role *</Label>
              <Input id="jb-role" placeholder="Software Engineer" value={form.role} onChange={(e) => set("role", e.target.value)} />
            </div>
            <div className="fg">
              <Label htmlFor="jb-url">Apply URL *</Label>
              <Input id="jb-url" placeholder="https://careers.google.com/..." value={form.url} onChange={(e) => set("url", e.target.value)} />
            </div>
            <div className="fg">
              <Label htmlFor="jb-location">Location</Label>
              <Input id="jb-location" placeholder="Remote / New York, NY" value={form.location} onChange={(e) => set("location", e.target.value)} />
            </div>
          </div>
          <div className="fg" style={{ marginTop: 8 }}>
            <Label htmlFor="jb-notes">Notes</Label>
            <Input id="jb-notes" placeholder="e.g. new grad friendly, referral available..." value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button type="submit" size="sm" className="rounded-full" disabled={saving}>
              {saving ? "Sharing…" : "Share Job"}
            </Button>
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => { setShowForm(false); setForm(EMPTY); }}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="stats-row" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginTop: 14 }}>
        <div className="stat-card">
          <div className="stat-num">{posts.length}</div>
          <div className="stat-label">Open Listings</div>
        </div>
        <div className="stat-card sage">
          <div className="stat-num">{uniquePosters}</div>
          <div className="stat-label">Contributors</div>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="feed-card" style={{ marginTop: 14 }}>
          <div className="feed-empty">No jobs posted yet — be the first to share one! 💼</div>
        </div>
      ) : (
        <div className="job-board-grid">
          {posts.map((post) => (
            <div key={post.id} className="job-card">
              <div className="job-card-header">
                <div>
                  <div className="job-card-company">{post.company}</div>
                  <div className="job-card-role">{post.role}</div>
                </div>
                {post.ownerUid === myUid && (
                  <button
                    className="abtn"
                    title="Remove"
                    disabled={deletingId === post.id}
                    onClick={() => handleDelete(post.id)}
                    style={{ flexShrink: 0 }}
                  >
                    <i className="ti ti-trash" />
                  </button>
                )}
              </div>

              {post.location && (
                <div className="job-card-meta">
                  <i className="ti ti-map-pin" style={{ marginRight: 4 }} />{post.location}
                </div>
              )}
              {post.notes && (
                <div className="job-card-notes">{post.notes}</div>
              )}

              <div className="job-card-footer">
                <span className="job-card-by">
                  Shared by <strong>{post.ownerUid === myUid ? "you" : post.ownerName}</strong>
                  {post.postedAt && <> · {timeAgo(new Date(post.postedAt))}</>}
                </span>
                <a
                  href={post.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="job-apply-btn"
                >
                  Apply <i className="ti ti-arrow-up-right" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
