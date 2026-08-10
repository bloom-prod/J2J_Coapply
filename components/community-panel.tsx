"use client";

import { useEffect, useState } from "react";
import { authHeaders, getActiveCommunityId, setActiveCommunityId } from "@/lib/client-auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const COMMUNITY_COLLAPSED_KEY = "bloom_community_collapsed";

interface Community {
  id: string;
  name: string;
  inviteCode: string;
  role: string;
}

export function CommunityPanel() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(COMMUNITY_COLLAPSED_KEY) === "1";
  });
  const [communities, setCommunities] = useState<Community[]>([]);
  const [activeCommunityId, setActive] = useState<string | null>(getActiveCommunityId);
  const [loading, setLoading] = useState(true);

  const [copied, setCopied] = useState(false);

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COMMUNITY_COLLAPSED_KEY, next ? "1" : "0");
  }

  // Create form
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");

  // Join form
  const [joinCode, setJoinCode] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/communities", { headers: authHeaders() });
        const d = await res.json();
        if (cancelled) return;
        if (d.ok) {
          setCommunities(d.communities as Community[]);
          // If no active community stored yet, default to the first one
          const stored = getActiveCommunityId();
          if (!stored && d.communities.length > 0) {
            setActiveCommunityId(d.communities[0].id);
            setActive(d.communities[0].id);
          }
        }
      } catch {
        // ignore — panel just won't show communities
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function handleSelect(id: string) {
    setActiveCommunityId(id);
    setActive(id);
    window.location.reload();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = createName.trim();
    if (!name) return;
    setCreateLoading(true);
    setCreateError("");
    try {
      const res = await fetch("/api/communities", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "Failed to create community");
      setActiveCommunityId(d.community.id);
      window.location.reload();
    } catch (err) {
      setCreateError((err as Error).message);
      setCreateLoading(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim();
    if (!code) return;
    setJoinLoading(true);
    setJoinError("");
    try {
      const res = await fetch("/api/communities/join", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ code }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "Failed to join community");
      setActiveCommunityId(d.community.id);
      window.location.reload();
    } catch (err) {
      setJoinError((err as Error).message);
      setJoinLoading(false);
    }
  }

  const activeCommunity = communities.find((c) => c.id === activeCommunityId) ?? communities[0] ?? null;

  function handleCopy() {
    if (!activeCommunity) return;
    navigator.clipboard.writeText(activeCommunity.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const btnStyle: React.CSSProperties = {
    padding: "5px 14px",
    borderRadius: 6,
    border: "none",
    background: "var(--pink-400)",
    color: "#fff",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 600,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "7px 10px",
    borderRadius: 6,
    border: "1px solid var(--sage-100)",
    background: "var(--card-bg)",
    color: "var(--text-dark)",
    fontSize: 13,
    marginBottom: 10,
    outline: "none",
  };

  return (
    <>
      <div className="feed-card" style={{ marginBottom: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            onClick={toggleCollapsed}
            style={{
              display: "flex",
              alignItems: "center",
              flex: 1,
              cursor: "pointer",
              gap: 8,
              minWidth: 0,
            }}
          >
            <i
              className={collapsed ? "ti ti-chevron-right" : "ti ti-chevron-down"}
              style={{ fontSize: 16, color: "var(--text-mid)", flexShrink: 0 }}
            />
            <span className="it" style={{ margin: 0 }}>
              Your communities
            </span>
          </div>
          {!collapsed && (
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button style={{ ...btnStyle, background: "var(--sage-400)" }} onClick={() => { setJoinOpen(true); setJoinError(""); setJoinCode(""); }}>
                Join
              </button>
              <button style={btnStyle} onClick={() => { setCreateOpen(true); setCreateError(""); setCreateName(""); }}>
                + New
              </button>
            </div>
          )}
        </div>

        {!collapsed && (
          <div style={{ marginTop: 10 }}>
            {loading && (
              <div style={{ fontSize: 12, color: "var(--text-light)" }}>Loading...</div>
            )}

            {!loading && communities.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--text-light)" }}>
                You're not in any community yet — create one or join with an invite code.
              </div>
            )}

            {!loading && communities.length > 0 && (
              <>
                <select
                  value={activeCommunityId ?? ""}
                  onChange={(e) => handleSelect(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--sage-100)", background: "var(--card-bg)", color: "var(--text-dark)", fontSize: 13, marginBottom: 10 }}
                >
                  {communities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.role === "owner" ? " (owner)" : ""}
                    </option>
                  ))}
                </select>
                {activeCommunity && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--pink-50)", borderRadius: 6, padding: "6px 10px" }}>
                    <span style={{ fontSize: 12, color: "var(--text-mid)" }}>Invite code:</span>
                    <code style={{ fontSize: 13, fontWeight: 600, color: "var(--text-dark)", flex: 1 }}>{activeCommunity.inviteCode}</code>
                    <button onClick={handleCopy} style={{ ...btnStyle, padding: "3px 10px", fontSize: 12, background: copied ? "var(--sage-400)" : "var(--pink-400)" }}>
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Create community modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a community</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div style={{ fontSize: 12, color: "var(--text-light)", marginBottom: 6 }}>Community name</div>
            <input
              type="text"
              placeholder="e.g. Fall 2025 Grind"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              autoFocus
              style={inputStyle}
            />
            {createError && (
              <div style={{ fontSize: 12, color: "var(--danger)", marginBottom: 8 }}>{createError}</div>
            )}
            <button
              type="submit"
              disabled={createLoading || !createName.trim()}
              style={{ ...btnStyle, width: "100%", padding: "8px", opacity: createLoading || !createName.trim() ? 0.6 : 1, cursor: createLoading || !createName.trim() ? "not-allowed" : "pointer" }}
            >
              {createLoading ? "Creating..." : "Create community"}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Join community modal */}
      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join a community</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleJoin}>
            <div style={{ fontSize: 12, color: "var(--text-light)", marginBottom: 6 }}>Invite code</div>
            <input
              type="text"
              placeholder="Enter invite code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              autoFocus
              style={inputStyle}
            />
            {joinError && (
              <div style={{ fontSize: 12, color: "var(--danger)", marginBottom: 8 }}>{joinError}</div>
            )}
            <button
              type="submit"
              disabled={joinLoading || !joinCode.trim()}
              style={{ ...btnStyle, width: "100%", padding: "8px", background: "var(--sage-400)", opacity: joinLoading || !joinCode.trim() ? 0.6 : 1, cursor: joinLoading || !joinCode.trim() ? "not-allowed" : "pointer" }}
            >
              {joinLoading ? "Joining..." : "Join community"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
