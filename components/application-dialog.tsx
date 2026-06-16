"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUSES, PRIORITIES, type Job } from "@/lib/types";
import { todayISO, ROLE_CATEGORIES, classifyRole } from "@/lib/job-utils";

type Form = Record<string, string>;

const EMPTY: Form = {
  company: "",
  role: "",
  roleCategory: "",
  status: "Want to Apply",
  priority: "High",
  location: "",
  date: "",
  salary: "",
  url: "",
  recruiter: "",
  followup: "",
  notes: "",
};

export function ApplicationDialog({
  open,
  onOpenChange,
  job,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  job: Job | null;
  onSave: (id: string | null, data: Form) => void;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState<Form>(EMPTY);

  useEffect(() => {
    if (!open) return;
    if (job) {
      setForm({
        company: job.company,
        role: job.role,
        roleCategory: job.roleCategory || classifyRole(job.role),
        status: job.status || "Applied",
        priority: job.priority || "High",
        location: job.location,
        date: job.date,
        salary: job.salary,
        url: job.url,
        recruiter: job.recruiter,
        followup: job.followup,
        notes: job.notes,
      });
    } else {
      setForm({ ...EMPTY, date: todayISO() });
    }
  }, [open, job]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const setRole = (v: string) =>
    setForm((f) => ({ ...f, role: v, roleCategory: f.roleCategory || classifyRole(v) }));

  function save() {
    if (!form.company.trim()) {
      toast.error("Company name is required 🌸");
      return;
    }
    if (!form.role.trim()) {
      toast.error("Role is required 🌸");
      return;
    }
    const data: Form = {};
    Object.keys(EMPTY).forEach((k) => (data[k] = (form[k] || "").trim()));
    onSave(job ? job.id : null, data);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle style={{ color: "var(--pink-600)" }}>
            {job ? `${job.company} — ${job.role}` : "New application"}
          </DialogTitle>
        </DialogHeader>

        <div className="frow">
          <div className="fg">
            <label className="flabel">Company *</label>
            <Input value={form.company} onChange={(e) => set("company", e.target.value)} placeholder="e.g. Google" autoFocus />
          </div>
          <div className="fg">
            <label className="flabel">Role *</label>
            <Input value={form.role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Software Engineer" />
          </div>
        </div>

        <div className="frow one">
          <div className="fg">
            <label className="flabel">
              Role category
              {form.role && !form.roleCategory && (
                <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-light)" }}>
                  auto-detected
                </span>
              )}
            </label>
            <Select
              value={form.roleCategory || classifyRole(form.role)}
              onValueChange={(v) => set("roleCategory", v)}
            >
              <SelectTrigger><SelectValue placeholder="Detected from role title" /></SelectTrigger>
              <SelectContent>
                {ROLE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="frow">
          <div className="fg">
            <label className="flabel">Status</label>
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="fg">
            <label className="flabel">Priority</label>
            <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="frow">
          <div className="fg">
            <label className="flabel">Location</label>
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. San Francisco / Remote" />
          </div>
          <div className="fg">
            <label className="flabel">Date applied</label>
            <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
          </div>
        </div>

        <div className="frow">
          <div className="fg">
            <label className="flabel">Salary range</label>
            <Input value={form.salary} onChange={(e) => set("salary", e.target.value)} placeholder="e.g. $120k–$150k" />
          </div>
          <div className="fg">
            <label className="flabel">Job posting URL</label>
            <Input type="url" value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://..." />
          </div>
        </div>

        <div className="frow">
          <div className="fg">
            <label className="flabel">Recruiter / contact</label>
            <Input value={form.recruiter} onChange={(e) => set("recruiter", e.target.value)} placeholder="Name, email, or LinkedIn" />
          </div>
          <div className="fg">
            <label className="flabel">Next follow-up date</label>
            <Input type="date" value={form.followup} onChange={(e) => set("followup", e.target.value)} />
          </div>
        </div>

        <div className="frow one">
          <div className="fg">
            <label className="flabel">Notes</label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Interview notes, referral info, next steps..." />
          </div>
        </div>

        <div className="flex items-center gap-2.5 pt-4 mt-1 border-t" style={{ borderColor: "var(--pink-100)" }}>
          {job && (
            <Button
              variant="outline"
              className="mr-auto border-[#F09595] text-[var(--danger)] hover:bg-[var(--danger-bg)]"
              onClick={() => {
                if (confirm("Remove this application?")) {
                  onDelete(job.id);
                  onOpenChange(false);
                }
              }}
            >
              <i className="ti ti-trash" /> Delete
            </Button>
          )}
          <Button variant="outline" className="ml-auto" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save application</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
