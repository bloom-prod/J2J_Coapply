"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUSES, type Job } from "@/lib/types";
import { getToken } from "@/lib/client-auth";
import { todayISO } from "@/lib/job-utils";

type Entry = { date: string; status: string };

export function StatusHistoryDialog({
  open,
  onOpenChange,
  job,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  job: Job | null;
}) {
  const [rows, setRows] = useState<Entry[]>([{ date: todayISO(), status: "Applied" }]);
  const [busy, setBusy] = useState(false);

  if (job === null) return null;

  const setRow = (i: number, patch: Partial<Entry>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function save() {
    if (!job) return;
    const valid = rows.filter((r) => r.date && r.status);
    if (valid.length === 0) {
      toast.error("Add at least one status first 🌸");
      return;
    }
    setBusy(true);
    try {
      const token = getToken();
      const res = await fetch(`/api/applications/${job.id}/status-history`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ entries: valid.map((r) => ({ status: r.status, changedAt: r.date })) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "Save failed");
      toast.success(`Saved ${d.added ?? valid.length} past status${valid.length === 1 ? "" : "es"} 🌱`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle style={{ color: "var(--pink-600)" }}>
            Update past status — {job.company} · {job.role}
          </DialogTitle>
        </DialogHeader>

        <div style={{ fontSize: 13, color: "var(--text-light)", marginBottom: 8 }}>
          Backfill stages you reached earlier. These add to your history and funnel — they don't change the current status.
        </div>

        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Input
              type="date"
              value={r.date}
              onChange={(e) => setRow(i, { date: e.target.value })}
              style={{ width: 150, flex: "0 0 auto" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Select value={r.status} onValueChange={(v) => setRow(i, { status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <button
              type="button"
              onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
              disabled={rows.length === 1}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 15,
                lineHeight: 1,
                color: "var(--text-light)",
                padding: 4,
                opacity: rows.length === 1 ? 0.4 : 1,
              }}
            >
              ✕
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, { date: todayISO(), status: "Applied" }])}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--text-light)", textDecoration: "underline", padding: 0, textAlign: "left" }}
        >
          + add status
        </button>

        <div className="dialog-footer">
          <Button variant="outline" className="ml-auto" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "…" : "Save history"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}