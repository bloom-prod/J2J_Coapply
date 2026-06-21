"use client";

import { useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import type { Resume, ResumeComment } from "@/lib/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const USER_COLORS = ["#E07BA0","#7BB87B","#78AEDE","#DDB060","#A87BD4","#5FC5C5","#E8895A"];
function nameColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xfffffff;
  return USER_COLORS[h % USER_COLORS.length];
}

function Avatar({ name }: { name: string }) {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
      background: nameColor(name),
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, fontWeight: 700, color: "#fff",
    }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function fmtTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

async function authedFetch(method: string, path: string, body?: unknown) {
  const token = await auth.currentUser!.getIdToken();
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const d = await res.json();
  if (!res.ok || !d.ok) throw new Error(d.error || `Request failed (${res.status})`);
  return d;
}

export function ResumeTab({
  resumes,
  currentUid,
  onUpload,
  onDelete,
}: {
  resumes: Resume[];
  currentUid: string;
  onUpload: (title: string, file: File) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Resume | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [comments, setComments] = useState<ResumeComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Clean up blob URL when changing resumes
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  async function selectResume(r: Resume) {
    setSelected(r);
    setComments([]);
    setViewUrl(null);

    // Revoke previous blob URL
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    // Fetch PDF base64 and comments in parallel
    setLoadingPdf(true);
    setLoadingComments(true);

    const [pdfResult, commentsResult] = await Promise.allSettled([
      authedFetch("GET", `/api/resumes/${r.id}`),
      authedFetch("GET", `/api/resumes/comments?resumeId=${r.id}`),
    ]);

    if (pdfResult.status === "fulfilled") {
      try {
        const base64 = pdfResult.value.fileBase64 as string;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setViewUrl(url);
      } catch {
        toast.error("Failed to load PDF");
      }
    } else {
      toast.error("Failed to load PDF — " + (pdfResult.reason as Error).message);
    }
    setLoadingPdf(false);

    if (commentsResult.status === "fulfilled") {
      setComments(commentsResult.value.comments || []);
    }
    setLoadingComments(false);
  }

  async function handleUpload() {
    if (!uploadTitle.trim()) { toast.error("Please enter a title"); return; }
    if (!uploadFile) { toast.error("Please select a PDF file"); return; }
    if (!uploadFile.name.toLowerCase().endsWith(".pdf")) { toast.error("Only PDF files allowed"); return; }
    if (uploadFile.size > 700 * 1024) { toast.error("File must be under 700 KB"); return; }
    setUploading(true);
    try {
      await onUpload(uploadTitle.trim(), uploadFile);
      toast.success("Resume uploaded!");
      setUploadTitle("");
      setUploadFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setShowUpload(false);
    } catch (e) {
      toast.error("Upload failed — " + (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await onDelete(id);
      if (selected?.id === id) {
        setSelected(null);
        setComments([]);
        setViewUrl(null);
        if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
      }
      toast.success("Resume deleted");
    } catch (e) {
      toast.error("Delete failed — " + (e as Error).message);
    }
  }

  async function handleAddComment() {
    if (!selected || !commentText.trim()) return;
    setSubmittingComment(true);
    try {
      const d = await authedFetch("POST", "/api/resumes/comments", {
        resumeId: selected.id,
        text: commentText.trim(),
      });
      setComments((c) => [...c, d.comment]);
      setCommentText("");
    } catch (e) {
      toast.error("Failed to post comment — " + (e as Error).message);
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleResolve(comment: ResumeComment) {
    try {
      await authedFetch("PATCH", "/api/resumes/comments", { id: comment.id, resumeId: comment.resumeId });
      setComments((c) => c.map((x) => x.id === comment.id ? { ...x, resolved: !x.resolved } : x));
    } catch (e) {
      toast.error("Failed — " + (e as Error).message);
    }
  }

  // Group resumes by user
  const byUser = resumes.reduce<Record<string, Resume[]>>((acc, r) => {
    (acc[r.userName] = acc[r.userName] || []).push(r);
    return acc;
  }, {});

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 280px", height: "calc(100vh - 130px)", minHeight: 500 }}>

      {/* LEFT: resume list */}
      <div style={{ borderRight: "1px solid var(--sage-100)", overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--sage-100)" }}>
          <div className="sec-title" style={{ marginBottom: 10 }}>Resumes</div>
          {showUpload ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Input
                placeholder="Title (e.g. SWE 2025)"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                style={{ fontSize: 13 }}
              />
              <label style={{ fontSize: 12, color: "var(--text-mid)", cursor: "pointer", border: "1px dashed var(--sage-200)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                {uploadFile ? uploadFile.name : "Click to select PDF (max 700 KB)"}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf"
                  style={{ display: "none" }}
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                />
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <Button size="sm" className="rounded-full w-full" onClick={handleUpload} disabled={uploading}>
                  {uploading ? "Uploading…" : "Upload"}
                </Button>
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => { setShowUpload(false); setUploadTitle(""); setUploadFile(null); }}>
                  <i className="ti ti-x" />
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="rounded-full w-full" onClick={() => setShowUpload(true)}>
              <i className="ti ti-upload" /> Add Resume
            </Button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {resumes.length === 0 ? (
            <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--text-light)", fontSize: 13 }}>
              No resumes yet — upload yours!
            </div>
          ) : (
            Object.entries(byUser).map(([userName, group]) => (
              <div key={userName}>
                <div style={{ padding: "6px 14px 4px", fontSize: 11, fontWeight: 700, color: "var(--text-light)", textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 6 }}>
                  <Avatar name={userName} />
                  {userName}
                </div>
                {group.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => selectResume(r)}
                    style={{
                      padding: "8px 14px",
                      cursor: "pointer",
                      background: selected?.id === r.id ? "var(--sage-50)" : "transparent",
                      borderLeft: selected?.id === r.id ? "3px solid var(--pink-300)" : "3px solid transparent",
                      display: "flex", alignItems: "center", gap: 8,
                    }}
                  >
                    <i className="ti ti-file-type-pdf" style={{ color: "var(--danger)", fontSize: 16, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-dark)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                      <div style={{ fontSize: 11, color: "var(--text-light)" }}>{fmtTime(r.uploadedAt)}</div>
                    </div>
                    {r.userId === currentUid && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-light)", padding: 2, borderRadius: 4, lineHeight: 1 }}
                        title="Delete"
                      >
                        <i className="ti ti-trash" style={{ fontSize: 13 }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* CENTER: PDF viewer */}
      <div style={{ borderRight: "1px solid var(--sage-100)", display: "flex", flexDirection: "column" }}>
        {selected ? (
          <>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--sage-100)", display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar name={selected.userName} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-dark)" }}>{selected.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-light)" }}>by {selected.userName} · {selected.fileName}</div>
              </div>
            </div>
            <div style={{ flex: 1, position: "relative" }}>
              {loadingPdf ? (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div className="spinner" />
                </div>
              ) : viewUrl ? (
                <iframe src={viewUrl} style={{ width: "100%", height: "100%", border: "none" }} title={selected.title} />
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-light)", fontSize: 13 }}>
                  Failed to load PDF
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--text-light)" }}>
            <i className="ti ti-file-description" style={{ fontSize: 48, opacity: 0.3 }} />
            <div style={{ fontSize: 14 }}>Select a resume to view</div>
          </div>
        )}
      </div>

      {/* RIGHT: Comments */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--sage-100)" }}>
          <div className="it">
            Comments
            {selected && <span style={{ fontSize: 11, color: "var(--text-light)", fontWeight: 400, marginLeft: 6 }}>on {selected.title}</span>}
          </div>
        </div>

        {selected ? (
          <>
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              {loadingComments ? (
                <div style={{ textAlign: "center", padding: 20 }}><div className="spinner" /></div>
              ) : comments.length === 0 ? (
                <div style={{ color: "var(--text-light)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No comments yet — be the first!</div>
              ) : (
                comments.map((c) => {
                  const canResolve = c.userId === currentUid || selected.userId === currentUid;
                  return (
                    <div
                      key={c.id}
                      style={{
                        padding: "10px 12px", borderRadius: 10,
                        background: c.resolved ? "var(--sage-50)" : "var(--bg-card, #fff)",
                        border: "1px solid var(--sage-100)",
                        opacity: c.resolved ? 0.55 : 1,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                        <Avatar name={c.userName} />
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dark)" }}>{c.userName}</span>
                          <span style={{ fontSize: 11, color: "var(--text-light)", marginLeft: 6 }}>{fmtTime(c.createdAt)}</span>
                        </div>
                        {canResolve && (
                          <button
                            onClick={() => handleResolve(c)}
                            title={c.resolved ? "Unresolve" : "Resolve"}
                            style={{ background: "none", border: "none", cursor: "pointer", color: c.resolved ? "var(--sage-400)" : "var(--text-light)", padding: 2, lineHeight: 1, borderRadius: 4 }}
                          >
                            <i className={`ti ${c.resolved ? "ti-refresh" : "ti-x"}`} style={{ fontSize: 13 }} />
                          </button>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.5, wordBreak: "break-word" }}>
                        {c.resolved && <span style={{ fontSize: 10, color: "var(--sage-400)", marginRight: 6, fontWeight: 600 }}>RESOLVED</span>}
                        {c.text}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ padding: "10px 14px", borderTop: "1px solid var(--sage-100)", display: "flex", flexDirection: "column", gap: 8 }}>
              <Textarea
                placeholder="Add a comment…"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddComment(); }}
                rows={3}
                style={{ fontSize: 13, resize: "none" }}
              />
              <Button size="sm" className="rounded-full w-full" onClick={handleAddComment} disabled={submittingComment || !commentText.trim()}>
                {submittingComment ? "Posting…" : "Post Comment"}
              </Button>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 13, color: "var(--text-light)", textAlign: "center", padding: 20 }}>Select a resume to see and add comments</div>
          </div>
        )}
      </div>
    </div>
  );
}
