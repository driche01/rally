"use client";

/**
 * Inline-edit primitives for trip dashboard fields.
 *
 * Each component renders the value as plain text with a subtle
 * hover affordance. Clicking the value swaps it for an input;
 * Enter or blur saves; Escape cancels. Save calls the provided
 * onSave function (which should PATCH the relevant endpoint),
 * shows a tiny saving indicator, then re-renders the display.
 *
 * Three flavors:
 *   <EditableText>      — single-line text + numbers + dates
 *   <EditableTextarea>  — multi-line text
 *   <EditableNumber>    — like Text but type="number"
 *
 * All take:
 *   value      current persisted value
 *   onSave     async (newValue) => void; throws to indicate failure
 *   canEdit    if false, renders display-only
 *   placeholder text shown when value is empty
 *   inputClass / displayClass — caller styling hooks
 *   renderDisplay — optional custom display formatter
 */

import { useEffect, useRef, useState } from "react";

type SaveFn<T> = (v: T) => Promise<void>;

interface BaseProps<T> {
  value: T;
  onSave: SaveFn<T>;
  canEdit: boolean;
  placeholder?: string;
  inputClass?: string;
  displayClass?: string;
  renderDisplay?: (v: T) => React.ReactNode;
}

// ─── EditableText ────────────────────────────────────────────────

export function EditableText({
  value, onSave, canEdit, placeholder = "Click to add",
  inputClass = "", displayClass = "",
  renderDisplay,
  type = "text",
  autoEdit = false,
}: BaseProps<string | null> & {
  type?: "text" | "date" | "number";
  /** When true AND canEdit, open in editing mode on first mount.
   *  Used by the trip page when arriving at /trips/[id]?new=1 to
   *  drop the cursor straight into the trip-name field. */
  autoEdit?: boolean;
}) {
  const [editing, setEditing] = useState(autoEdit && canEdit);
  const [draft, setDraft]     = useState(value ?? "");
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value ?? ""); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); ref.current?.select(); }, [editing]);

  async function save() {
    const newVal = draft.trim();
    if (newVal === (value ?? "")) { setEditing(false); return; }
    setBusy(true); setErr(null);
    try {
      await onSave(newVal === "" ? null : newVal);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setDraft(value ?? "");
    setEditing(false);
    setErr(null);
  }

  if (!canEdit) {
    return (
      <span className={displayClass}>
        {renderDisplay ? renderDisplay(value) : (value ?? <span className="opacity-50">{placeholder}</span>)}
      </span>
    );
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={ref}
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); save(); }
            else if (e.key === "Escape") cancel();
          }}
          disabled={busy}
          className={"rounded-md border border-green bg-card px-2 py-1 outline-none " + inputClass}
          placeholder={placeholder}
        />
        {err && <span className="text-xs text-orange ml-1">{err}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={
        "inline-flex items-baseline gap-1 text-left cursor-text rounded-md " +
        "hover:bg-green-soft/40 hover:px-1.5 -mx-1.5 px-1.5 transition-colors " +
        displayClass
      }
      aria-label="Edit"
    >
      <span>
        {renderDisplay ? renderDisplay(value) : (value ?? <span className="opacity-50">{placeholder}</span>)}
      </span>
      <span aria-hidden className="text-xs opacity-30 ml-0.5">✎</span>
    </button>
  );
}

// ─── EditableTextarea ────────────────────────────────────────────

export function EditableTextarea({
  value, onSave, canEdit, placeholder = "Click to add",
  inputClass = "", displayClass = "",
  renderDisplay,
  rows = 4,
  maxLength = 2000,
}: BaseProps<string | null> & {
  rows?: number;
  maxLength?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value ?? "");
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value ?? ""); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  async function save() {
    const newVal = draft.trim();
    if (newVal === (value ?? "")) { setEditing(false); return; }
    setBusy(true); setErr(null);
    try {
      await onSave(newVal === "" ? null : newVal);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setDraft(value ?? "");
    setEditing(false);
    setErr(null);
  }

  if (!canEdit) {
    return (
      <span className={displayClass}>
        {renderDisplay ? renderDisplay(value) : (value ?? <span className="opacity-50">{placeholder}</span>)}
      </span>
    );
  }

  if (editing) {
    return (
      <div className="grid gap-1">
        <textarea
          ref={ref}
          rows={rows}
          maxLength={maxLength}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
            else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
          }}
          disabled={busy}
          placeholder={placeholder}
          className={"rounded-md border border-green bg-card px-3 py-2 outline-none whitespace-pre-line " + inputClass}
        />
        <p className="text-xs opacity-60">Esc to cancel · ⌘+Enter to save</p>
        {err && <span className="text-xs text-orange">{err}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={
        "block text-left w-full cursor-text rounded-md " +
        "hover:bg-green-soft/40 hover:px-3 hover:-mx-3 hover:py-2 hover:-my-2 transition-all " +
        displayClass
      }
      aria-label="Edit description"
    >
      {renderDisplay
        ? renderDisplay(value)
        : value
          ? <span className="whitespace-pre-line">{value}</span>
          : <span className="opacity-50">{placeholder}</span>}
    </button>
  );
}
