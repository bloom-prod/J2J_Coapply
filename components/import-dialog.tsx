"use client";

import { useCallback, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Job } from "@/lib/types";
import { parseSheet, type ParsedRow } from "@/lib/import-utils";

export function ImportDialog({
  open,
  onOpenChange,
  existingJobs,
  onImport,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existingJobs: Job[];
  onImport: (rows: Record<string, string>[]) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const reset = useCallback(() => {
    setParsed(null);
    setFileName("");
    setSelected(new Set());
    setParsing(false);
    setImporting(false);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setParsing(true);
      setFileName(file.name);
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(
          sheet,
          { header: 1, defval: "", blankrows: true }
        );
        const { parsed: pr } = parseSheet(rows, existingJobs);
        if (pr.length === 0) {
          toast.error("No valid rows found in the spreadsheet");
          setParsed(null);
          return;
        }
        // Default-select all non-duplicate, non-empty rows.
        const initSel = new Set<number>();
        pr.forEach((r, i) => {
          if (r.data.company && r.data.role && !r.duplicate) initSel.add(i);
        });
        setParsed(pr);
        setSelected(initSel);
      } catch (e) {
        toast.error("Failed to parse file — " + (e as Error).message);
        setParsed(null);
      } finally {
        setParsing(false);
      }
    },
    [existingJobs]
  );

  const stats = parsed
    ? {
        total: parsed.length,
        duplicates: parsed.filter((r) => r.duplicate).length,
        warnings: parsed.filter((r) => r.warnings.length > 0 && !r.duplicate).length,
        selected: selected.size,
      }
    : null;

  const toggleSelect = useCallback((i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  async function doImport() {
    if (!parsed || selected.size === 0) return;
    const rows = parsed
      .filter((_, i) => selected.has(i))
      .map((p) => p.data);
    setImporting(true);
    try {
      await onImport(rows);
      toast.success(`Imported ${rows.length} applications 🌸`);
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error("Import failed — " + (e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent style={{ maxWidth: 920, maxHeight: "92vh" }}>
        <DialogHeader>
          <DialogTitle style={{ color: "var(--pink-600)" }}>
            Bulk import applications
          </DialogTitle>
        </DialogHeader>

        {!parsed && (
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            style={{
              border: "2px dashed var(--pink-200, #F09595)",
              borderRadius: 16,
              padding: "48px 24px",
              textAlign: "center",
              background: "var(--pink-50, rgba(240,149,149,0.06))",
            }}
          >
            {parsing ? (
              <>
                <div className="spinner" style={{ margin: "0 auto 12px" }} />
                <div style={{ fontSize: 14, color: "var(--text-mid)" }}>
                  Parsing {fileName}…
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 40, marginBottom: 10 }}>📥</div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  Drop an Excel file here, or
                </div>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => inputRef.current?.click()}
                  style={{ marginTop: 4 }}
                >
                  <i className="ti ti-upload" /> Choose .xlsx file
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = "";
                  }}
                />
                <div style={{ fontSize: 12, color: "var(--text-light)", marginTop: 12 }}>
                  Expected columns: Company, Job Title, Job Posting Link, Platform,
                  Status, Date Applied, Deadline, Match Score, Callback Score, Resume
                  Folder, Cover Letter, Key JD Keywords, Notes / Next Step
                </div>
              </>
            )}
          </div>
        )}

        {parsed && stats && (
          <>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
              <span>
                <strong>{stats.total}</strong> rows parsed
              </span>
              <span style={{ color: "var(--text-mid)" }}>
                <strong>{stats.selected}</strong> selected to import
              </span>
              {stats.duplicates > 0 && (
                <span style={{ color: "var(--warning, #C77E2A)" }}>
                  {stats.duplicates} duplicate{stats.duplicates > 1 ? "s" : ""}
                </span>
              )}
              {stats.warnings > 0 && (
                <span style={{ color: "var(--text-light)" }}>
                  {stats.warnings} with warnings
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={reset}
                style={{ padding: "2px 8px", fontSize: 12 }}
              >
                <i className="ti ti-refresh" /> Choose different file
              </Button>
            </div>

            <div
              style={{
                border: "1px solid var(--border, rgba(0,0,0,0.08))",
                borderRadius: 12,
                overflow: "auto",
                maxHeight: 420,
              }}
            >
              <table className="bloom" style={{ fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        className="mass-select-checkbox"
                        checked={selected.size === parsed.length}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(parsed.map((_, i) => i)) : new Set())
                        }
                        title="Toggle all"
                      />
                    </th>
                    <th style={{ width: 50 }}>#</th>
                    <th style={{ width: "16%" }}>Company</th>
                    <th style={{ width: "22%" }}>Role</th>
                    <th style={{ width: "10%" }}>Status</th>
                    <th style={{ width: "10%" }}>Date</th>
                    <th style={{ width: "20%" }}>URL</th>
                    <th>Notes / Warnings</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((r, i) => {
                    const sel = selected.has(i);
                    return (
                      <tr
                        key={i}
                        style={{
                          opacity: r.duplicate ? 0.55 : 1,
                          background: r.duplicate ? "rgba(0,0,0,0.03)" : undefined,
                        }}
                      >
                        <td>
                          <input
                            type="checkbox"
                            className="mass-select-checkbox"
                            checked={sel}
                            onChange={() => toggleSelect(i)}
                          />
                        </td>
                        <td style={{ color: "var(--text-light)" }}>{i + 1}</td>
                        <td style={{ fontWeight: 600, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.data.company}>
                          {r.data.company || <span style={{ color: "var(--danger)" }}>—</span>}
                        </td>
                        <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.data.role}>
                          {r.data.role || <span style={{ color: "var(--danger)" }}>—</span>}
                        </td>
                        <td><span className={`pill s-${(r.data.status || "Applied").replace(/\s+/g, "-")}`}>{r.data.status || "Applied"}</span></td>
                        <td style={{ color: "var(--text-light)", whiteSpace: "nowrap" }}>{r.data.date || "—"}</td>
                        <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.data.url ? (
                            <a href={r.data.url} target="_blank" rel="noreferrer" style={{ color: "var(--info)", textDecoration: "none", fontSize: 11 }}>
                              link
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={{ fontSize: 11, color: "var(--text-mid)" }}>
                          {r.duplicate && (
                            <span style={{ color: "var(--warning, #C77E2A)", fontWeight: 600 }}>
                              ⚠ Duplicate
                            </span>
                          )}
                          {!r.duplicate && r.warnings.length > 0 && (
                            <span style={{ color: "var(--text-light)" }}>{r.warnings.join("; ")}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div
              className="flex items-center gap-2.5 pt-4 mt-1 border-t"
              style={{ borderColor: "var(--pink-100)" }}
            >
              <Button
                variant="outline"
                className="ml-auto"
                onClick={() => onOpenChange(false)}
                disabled={importing}
              >
                Cancel
              </Button>
              <Button onClick={doImport} disabled={importing || selected.size === 0}>
                <i className={importing ? "ti ti-loader-2" : "ti ti-check"} />
                {importing ? "Importing…" : `Import ${selected.size} application${selected.size === 1 ? "" : "s"}`}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
