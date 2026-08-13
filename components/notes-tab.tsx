"use client";

import { useEffect, useRef, useState } from "react";
import type { NotesSaveState } from "@/lib/types";

const PLACEHOLDER =
  "Temp notes…\n\nRecruiter names, phone screen times, questions to ask, whatever you need to dump while applying.";

function SaveStatus({ state, loaded }: { state: NotesSaveState; loaded: boolean }) {
  if (!loaded) return <span className="notes-status">Loading…</span>;
  switch (state) {
    case "unsaved":
      return <span className="notes-status">Unsaved changes…</span>;
    case "saving":
      return <span className="notes-status">Saving…</span>;
    case "saved":
      return <span className="notes-status is-saved">Saved ✓</span>;
    case "error":
      return <span className="notes-status is-error">Save failed — retry by typing</span>;
    default:
      return <span className="notes-status">Autosaves as you type</span>;
  }
}

/**
 * The scratchpad editor itself. Rendered by BOTH the Notes tab and the
 * Applications drawer — they share one `value`/`onChange` pair from useBloom,
 * so text typed in one appears in the other with no syncing logic here.
 */
export function NotesEditor({
  value,
  onChange,
  saveState,
  loaded,
  autoFocus = false,
  minHeight = 420,
}: {
  value: string;
  onChange: (v: string) => void;
  saveState: NotesSaveState;
  loaded: boolean;
  autoFocus?: boolean;
  minHeight?: number | string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (autoFocus && loaded) ref.current?.focus();
  }, [autoFocus, loaded]);

  const chars = value.length;

  return (
    <div className="notes-editor">
      <textarea
        ref={ref}
        className="notes-textarea"
        style={{ minHeight }}
        value={value}
        placeholder={PLACEHOLDER}
        onChange={(e) => onChange(e.target.value)}
        disabled={!loaded}
        spellCheck
      />
      <div className="notes-meta">
        <SaveStatus state={saveState} loaded={loaded} />
        <span className="notes-count">{chars.toLocaleString()} chars</span>
      </div>
    </div>
  );
}

export function NotesTab({
  value,
  onChange,
  saveState,
  loaded,
}: {
  value: string;
  onChange: (v: string) => void;
  saveState: NotesSaveState;
  loaded: boolean;
}) {
  return (
    <div>
      <div className="sec-header" style={{ marginBottom: 6 }}>
        <span className="sec-title">🗒️ Notes</span>
        <span className="notes-status">
          Private to you — also available as a pull-out panel on the Applications tab
        </span>
      </div>
      <NotesEditor
        value={value}
        onChange={onChange}
        saveState={saveState}
        loaded={loaded}
        minHeight="min(65vh, 620px)"
      />
    </div>
  );
}

/**
 * Right-edge pull-out panel. Mounted only on the Applications tab so notes are
 * reachable without navigating away from the table mid-entry.
 */
export function NotesDrawer({
  value,
  onChange,
  saveState,
  loaded,
}: {
  value: string;
  onChange: (v: string) => void;
  saveState: NotesSaveState;
  loaded: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Esc closes the drawer — but only when the drawer owns the interaction, so
  // it can't swallow Esc from a dialog layered above it.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {!open && (
        <button
          type="button"
          className="notes-handle"
          onClick={() => setOpen(true)}
          aria-label="Open notes"
          title="Open notes"
        >
          <span className="notes-handle-icon">🗒️</span>
          <span className="notes-handle-text">Notes</span>
        </button>
      )}

      <aside className={`notes-drawer${open ? " is-open" : ""}`} aria-hidden={!open}>
        <div className="notes-drawer-head">
          <div className="notes-drawer-title">🗒️ Notes</div>
          <button type="button" className="abtn" onClick={() => setOpen(false)} aria-label="Close notes">
            <i className="ti ti-x" />
          </button>
        </div>
        <div className="notes-drawer-body">
          <NotesEditor
            value={value}
            onChange={onChange}
            saveState={saveState}
            loaded={loaded}
            autoFocus={open}
            minHeight="100%"
          />
        </div>
      </aside>
    </>
  );
}
