"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getToken, getCurrentUser } from "@/lib/client-auth";
import { Button } from "@/components/ui/button";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  approved: boolean;
  isAdmin: boolean;
  createdAt: string;
}

export default function AdminPage() {
  const me = getCurrentUser();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const token = getToken();
    if (!token) return;
    const res = await fetch("/api/admin/users", { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.ok) setUsers(d.users || []);
    else setError(d.error || "Failed to load users.");
  }

  async function act(id: string, approve: boolean) {
    setBusy(true);
    setError("");
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ approve }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "Action failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p>You need to be signed in.</p>
        <Link href="/"><Button className="mt-3">Go to log in</Button></Link>
      </div>
    );
  }
  if (!me.isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p>Admins only.</p>
        <Link href="/"><Button className="mt-3">Back</Button></Link>
      </div>
    );
  }

  const pending = users.filter((u) => !u.approved && !u.isAdmin);
  const others = users.filter((u) => u.approved || u.isAdmin);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Admin — user approvals</h1>
        <Link href="/" style={{ fontSize: 14, color: "var(--text-light)", textDecoration: "underline" }}>← app</Link>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}

      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Pending approval ({pending.length})</h2>
      {pending.length === 0 && <p style={{ color: "var(--text-light)", fontSize: 14 }}>No pending signups.</p>}
      {pending.map((u) => (
        <div key={u.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 12, background: "var(--pink-50)", marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{u.name || "—"}</div>
            <div style={{ fontSize: 13, color: "var(--text-light)" }}>{u.email} · signed up {new Date(u.createdAt).toLocaleString()}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="sm" disabled={busy} onClick={() => act(u.id, true)}>Approve</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(u.id, false)}>Deny</Button>
          </div>
        </div>
      ))}

      <h2 style={{ fontSize: 15, fontWeight: 600, marginTop: 24, marginBottom: 10 }}>Active users ({others.length})</h2>
      {others.map((u) => (
        <div key={u.id} style={{ padding: "6px 4px", fontSize: 14 }}>
          <span style={{ fontWeight: 600 }}>{u.name || "—"}</span>{" "}
          <span style={{ color: "var(--text-light)" }}>{u.email}</span>
          {u.isAdmin && <span style={{ marginLeft: 8, fontSize: 12, color: "var(--pink-600)" }}>admin</span>}
        </div>
      ))}
    </div>
  );
}