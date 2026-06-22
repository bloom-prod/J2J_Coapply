"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";
import { timeAgo } from "@/lib/job-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { InterviewPrepPost, InterviewPrepComment } from "@/lib/types";

interface Props {
  posts: InterviewPrepPost[];
  comments: Record<string, InterviewPrepComment[]>;
  companies: string[];
  onCreate: (data: { title: string; content: string; company: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAddComment: (postId: string, text: string) => Promise<void>;
  onFetchComments: (postId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

export function InterviewPrepTab({
  posts,
  comments,
  companies,
  onCreate,
  onDelete,
  onAddComment,
  onFetchComments,
  onRefresh,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [company, setCompany] = useState("general");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [companySearch, setCompanySearch] = useState("");

  const myUid = auth.currentUser?.uid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      toast.error("Title and content are required");
      return;
    }
    setSaving(true);
    try {
      await onCreate({ title, content, company });
      setTitle("");
      setContent("");
      setCompany("general");
      setShowForm(false);
      toast.success("Post created!");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await onDelete(id);
      if (expandedPostId === id) setExpandedPostId(null);
      toast.success("Post deleted");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAddComment(postId: string) {
    if (!commentText.trim()) return;
    setPostingComment(postId);
    try {
      await onAddComment(postId, commentText);
      setCommentText("");
      toast.success("Comment added!");
    } finally {
      setPostingComment(null);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  const allCompanies = ["general", ...companies];
  const filteredPosts = selectedCompany
    ? posts.filter((p) => p.company === selectedCompany)
    : posts;

  const companyGroups = allCompanies
    .filter((c) => c.toLowerCase().includes(companySearch.toLowerCase()))
    .map((c) => ({
      company: c,
      count: posts.filter((p) => p.company === c).length,
    }));

  return (
    <div>
      <div className="sec-header" style={{ marginBottom: 6 }}>
        <span className="sec-title">🎤 Interview Prep</span>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <i className="ti ti-refresh" /> {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => setShowForm((v) => !v)}
          >
            <i className="ti ti-plus" /> New Post
          </Button>
        </div>
      </div>

      <div className="privacy-note">
        <i className="ti ti-info-circle" /> Share interview prep materials, tips, and resources with the group.
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="interview-prep-form">
          <div className="interview-prep-form-group">
            <Label htmlFor="ip-title" className="interview-prep-label">Title *</Label>
            <Input
              id="ip-title"
              placeholder="e.g., System Design Interview Tips"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="interview-prep-input"
            />
          </div>
          <div className="interview-prep-form-row">
            <div className="interview-prep-form-group">
              <Label htmlFor="ip-company" className="interview-prep-label">Company *</Label>
              <select
                id="ip-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="interview-prep-select"
              >
                <option value="general">General</option>
                {companies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="interview-prep-form-group">
            <Label htmlFor="ip-content" className="interview-prep-label">Content *</Label>
            <textarea
              id="ip-content"
              placeholder="Share your interview prep materials..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              className="interview-prep-textarea"
            />
          </div>
          <div className="interview-prep-form-actions">
            <Button type="submit" size="sm" className="rounded-full" disabled={saving}>
              {saving ? "Creating…" : "Create Post"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => {
                setShowForm(false);
                setTitle("");
                setContent("");
                setCompany("general");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        {/* Company Filter */}
        <div className="interview-prep-sidebar">
          <div className="interview-prep-sidebar-title">Companies</div>
          <Input
            placeholder="Search..."
            value={companySearch}
            onChange={(e) => setCompanySearch(e.target.value)}
            className="interview-prep-search"
          />
          <button
            className={`interview-prep-company-btn ${selectedCompany === null ? "active" : ""}`}
            onClick={() => setSelectedCompany(null)}
          >
            All ({posts.length})
          </button>
          {companyGroups.map((g) => (
            <button
              key={g.company}
              className={`interview-prep-company-btn ${selectedCompany === g.company ? "active" : ""}`}
              onClick={() => setSelectedCompany(g.company)}
            >
              {g.company} ({g.count})
            </button>
          ))}
        </div>

        {/* Posts List */}
        <div style={{ flex: 1 }}>
          {filteredPosts.length === 0 ? (
            <div className="feed-card" style={{ marginTop: 0 }}>
              <div className="feed-empty">
                {selectedCompany
                  ? `No posts for ${selectedCompany} yet`
                  : "No interview prep posts yet — be the first to share! 🎤"}
              </div>
            </div>
          ) : (
            <div className="interview-prep-posts">
              {filteredPosts.map((post) => (
                <div key={post.id} className="interview-prep-post-card">
                  <div
                    className="interview-prep-post-header"
                    onClick={() => {
                      const newId = expandedPostId === post.id ? null : post.id;
                      setExpandedPostId(newId);
                      if (newId) onFetchComments(newId);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="interview-prep-post-title">{post.title}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {post.ownerUid === myUid && (
                        <button
                          className="abtn"
                          title="Delete"
                          disabled={deletingId === post.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(post.id);
                          }}
                        >
                          <i className="ti ti-trash" />
                        </button>
                      )}
                      <i
                        className={`ti ti-chevron-${
                          expandedPostId === post.id ? "up" : "down"
                        }`}
                      />
                    </div>
                  </div>

                  <div className="interview-prep-post-meta">
                    <span className="interview-prep-company-tag">{post.company}</span>
                    <span className="interview-prep-by">
                      by <strong>{post.ownerUid === myUid ? "you" : post.ownerName}</strong>
                    </span>
                    {post.createdAt && (
                      <span className="interview-prep-time">
                        {timeAgo(new Date(post.createdAt))}
                      </span>
                    )}
                  </div>

                  {expandedPostId === post.id && (
                    <div className="interview-prep-post-expanded">
                      <div className="interview-prep-post-content">
                        {post.content}
                      </div>

                      {/* Comments Section */}
                      <div className="interview-prep-comments">
                        <div className="interview-prep-comments-title">
                          Comments ({comments[post.id]?.length || 0})
                        </div>

                        {comments[post.id] && comments[post.id].length > 0 && (
                          <div className="interview-prep-comments-list">
                            {comments[post.id].map((comment) => (
                              <div
                                key={comment.id}
                                className="interview-prep-comment"
                              >
                                <div className="interview-prep-comment-header">
                                  <strong>{comment.userName}</strong>
                                  <span className="interview-prep-comment-time">
                                    {timeAgo(new Date(comment.createdAt))}
                                  </span>
                                </div>
                                <div className="interview-prep-comment-text">
                                  {comment.text}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="interview-prep-comment-form">
                          <textarea
                            placeholder="Add a comment..."
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            rows={2}
                            style={{
                              width: "100%",
                              padding: "8px 10px",
                              borderRadius: "6px",
                              border: "1px solid var(--border)",
                              backgroundColor: "var(--card-bg)",
                              color: "var(--text-dark)",
                              fontSize: "12px",
                              fontFamily: "inherit",
                            }}
                          />
                          <Button
                            size="sm"
                            className="rounded-full"
                            onClick={() => handleAddComment(post.id)}
                            disabled={postingComment === post.id || !commentText.trim()}
                            style={{ marginTop: 8 }}
                          >
                            {postingComment === post.id ? "Posting…" : "Comment"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
