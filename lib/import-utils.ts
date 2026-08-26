import { STATUSES, type Job } from "./types";
import { classifyRole } from "./job-utils";

export const EXCEL_HEADERS = [
  "Company",
  "Job Title",
  "Job Posting Link",
  "Platform",
  "Status",
  "Date Applied",
  "Deadline",
  "Match Score (%)",
  "Callback Score (/5)",
  "Resume Folder",
  "Cover Letter",
  "Key JD Keywords",
  "Notes / Next Step",
] as const;

export interface ParsedRow {
  rowIndex: number;
  data: Record<string, string>;
  warnings: string[];
  duplicate: boolean;
  existingId?: string; // ID of existing application if this is an update
  isUpdate: boolean; // True if this row should update an existing application
}

export type RawRow = (string | number | null | undefined)[];

export function jobKey(j: { company: string; role: string; url: string }): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\/+$/, "");
  return `${norm(j.company)}|${norm(j.role)}|${norm(j.url)}`;
}

function normalizeStatus(raw: string): string {
  const s = raw.trim();
  if (!s) return "Applied";
  const match = STATUSES.find((st) => st.toLowerCase() === s.toLowerCase());
  return match || "Applied";
}

function fmtDate(v: string | number | null | undefined): string {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Excel sometimes stores dates as serial numbers; xlsx sheet_to_json with
  // raw:true returns numbers. Handle a few common serials by parsing via Date.
  const n = Number(s);
  if (!isNaN(n) && n > 20000 && n < 90000) {
    const d = new Date(Math.round((n - 25569) * 86400 * 1000));
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function foldNotes(raw: RawRow): string {
  const parts: string[] = [];
  const platform = raw[3];
  const deadline = raw[6];
  const match = raw[7];
  const callback = raw[8];
  const resume = raw[9];
  const cover = raw[10];
  const keywords = raw[11];
  if (platform) parts.push(`Platform: ${platform}`);
  if (deadline) parts.push(`Deadline: ${fmtDate(String(deadline))}`);
  if (match != null && match !== "") parts.push(`Match: ${match}%`);
  if (callback != null && callback !== "") parts.push(`Callback: ${callback}/5`);
  if (resume) parts.push(`Resume: ${resume}`);
  if (cover) parts.push(`Cover: ${cover}`);
  if (keywords) parts.push(`Keywords: ${keywords}`);
  return parts.join(" | ");
}

export function mapRow(
  raw: RawRow,
  rowIndex: number,
  existingKeys: Map<string, string> // Changed from Set to Map<key, id>
): ParsedRow {
  const warnings: string[] = [];
  const company = String(raw[0] ?? "").trim();
  const role = String(raw[1] ?? "").trim();
  const url = String(raw[2] ?? "").trim();
  const statusRaw = String(raw[4] ?? "").trim();
  const date = fmtDate(raw[5] as string | number | null | undefined);
  const notesMain = String(raw[12] ?? "").trim();

  if (!company && !role) {
    return {
      rowIndex,
      data: {},
      warnings: ["Empty row — skipped"],
      duplicate: false,
      isUpdate: false,
    };
  }

  if (!company) warnings.push("Missing company");
  if (!role) warnings.push("Missing role");
  if (statusRaw && !STATUSES.some((s) => s.toLowerCase() === statusRaw.toLowerCase())) {
    warnings.push(`Unknown status "${statusRaw}" → defaulted to Applied`);
  }

  const folded = foldNotes(raw);
  const notes = [notesMain, folded].filter(Boolean).join("\n");

  const status = normalizeStatus(statusRaw);
  const data: Record<string, string> = {
    company,
    role,
    roleCategory: classifyRole(role),
    status,
    priority: "Medium",
    location: "",
    date,
    salary: "",
    url,
    recruiter: "",
    followup: fmtDate(raw[6] as string | number | null | undefined),
    notes,
  };

  const key = jobKey({ company, role, url });
  const existingId = company ? existingKeys.get(key) : undefined;
  const isUpdate = !!existingId;
  const duplicate = isUpdate;

  if (duplicate) warnings.push("Existing application — will update status");

  return { rowIndex, data, warnings, duplicate, existingId, isUpdate };
}

export function findHeaderRow(rows: RawRow[]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i];
    if (!r) continue;
    const first = String(r[0] ?? "").toLowerCase();
    if (first.includes("company")) return i;
  }
  return -1;
}

export function parseSheet(
  rows: RawRow[],
  existingJobs: Job[]
): { headerRow: number; parsed: ParsedRow[] } {
  const headerIdx = findHeaderRow(rows);
  const dataRows = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;
  const existingKeys = new Map(
    existingJobs.map((j) => [jobKey({ company: j.company, role: j.role, url: j.url }), j.id])
  );
  const parsed: ParsedRow[] = [];
  dataRows.forEach((r, i) => {
    const pr = mapRow(r, headerIdx + 1 + i, existingKeys);
    if (pr.data.company || pr.data.role) parsed.push(pr);
  });
  return { headerRow: headerIdx, parsed };
}
