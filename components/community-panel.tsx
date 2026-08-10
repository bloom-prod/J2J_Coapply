"use client";

import { useEffect, useState } from "react";
import { authHeaders, getActiveCommunityId, setActiveCommunityId } from "@/lib/client-auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Community {
  id: string;
  name: string;
  inviteCode: string;
  role: string;
}

export function CommunityPanel() {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [activeCommunityId, setActive] = useState<string | null>(getActiveCommunityId);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="feed-card" style={{ marginBottom: 14 }}>
      <div className="it" style={{ marginBottom: 10 }}>Your communities</div>

      {/* Community switcher */}
      {!loading && communities.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted, #9E9088)", display: "block", marginBottom: 4 }}>
            Active community
          </label>
          <select
            value={activeCommunityId ?? ""}
            onChange={(e) => handleSelect(e.target.value)}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border, #e0d8d0)",
              background: "var(--card-bg, #fff)",
              color: "var(--text, #1a1a1a)",
              fontSize: 13,
            }}
          >
            {communities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.role === "owner" ? "(owner)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading && (
        <div style={{ fontSize: 12, color: "var(--text-muted, #9E9088)", marginBottom: 12 }}>
          Loading communities...
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {/* Create community */}
        <form onSubmit={handleCreate} style={{ flex: "1 1 200px" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted, #9E9088)", marginBottom: 4 }}>
            Create a new community
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              placeholder="Community name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              style={{
                flex: 1,
                padding: "5px 8px",
                borderRadius: 6,
                border: "1px solid var(--border, #e0d8d0)",
                background: "var(--card-bg, #fff)",
                color: "var(--text, #1a1a1a)",
                fontSize: 13,
              }}
            />
            <button
              type="submit"
              disabled={createLoading || !createName.trim()}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "none",
                background: "var(--accent, #D4537E)",
                color: "#fff",
                fontSize: 13,
                cursor: createLoading || !createName.trim() ? "not-allowed" : "pointer",
                opacity: createLoading || !createName.trim() ? 0.6 : 1,
              }}
            >
              {createLoading ? "..." : "Create"}
            </button>
          </div>
          {createError && (
            <div style={{ fontSize: 11, color: "var(--danger, #A32D2D)", marginTop: 4 }}>{createError}</div>
          )}
        </form>

        {/* Join community */}
        <form onSubmit={handleJoin} style={{ flex: "1 1 200px" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted, #9E9088)", marginBottom: 4 }}>
            Join with invite code
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              placeholder="Invite code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              style={{
                flex: 1,
                padding: "5px 8px",
                borderRadius: 6,
                border: "1px solid var(--border, #e0d8d0)",
                background: "var(--card-bg, #fff)",
                color: "var(--text, #1a1a1a)",
                fontSize: 13,
              }}
            />
            <button
              type="submit"
              disabled={joinLoading || !joinCode.trim()}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "none",
                background: "var(--accent, #D4537E)",
                color: "#fff",
                fontSize: 13,
                cursor: joinLoading || !joinCode.trim() ? "not-allowed" : "pointer",
                opacity: joinLoading || !joinCode.trim() ? 0.6 : 1,
              }}
            >
              {joinLoading ? "..." : "Join"}
            </button>
          </div>
          {joinError && (
            <div style={{ fontSize: 11, color: "var(--danger, #A32D2D)", marginTop: 4 }}>{joinError}</div>
          )}
        </form>
      </div>
    </div>
  );
}
