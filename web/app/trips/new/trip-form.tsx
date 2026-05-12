"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { THEMES, themeClass } from "@/lib/themes";
import type { TripTheme } from "@shared/types";

const GROUP_BUCKETS = [
  { value: "0-4",  label: "1–4" },
  { value: "5-8",  label: "5–8" },
  { value: "9-12", label: "9–12" },
  { value: "13-20", label: "13–20" },
  { value: "20+",  label: "20+" },
] as const;

interface FormState {
  name: string;
  destination: string;
  description: string;
  cover_image_url: string;
  start_date: string;
  end_date: string;
  budget_min: string;
  budget_max: string;
  theme: TripTheme | "";
  group_size_bucket: string;
  is_public: boolean;
  status: "draft" | "active";
}

const EMPTY: FormState = {
  name: "",
  destination: "",
  description: "",
  cover_image_url: "",
  start_date: "",
  end_date: "",
  budget_min: "",
  budget_max: "",
  theme: "",
  group_size_bucket: "5-8",
  is_public: false,
  status: "active",
};

type CoverMode = "upload" | "generate" | "url";

export default function TripForm() {
  const router = useRouter();
  const [s, setS] = useState<FormState>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cover image state
  const [coverMode, setCoverMode] = useState<CoverMode>("upload");
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverErr, setCoverErr] = useState<string | null>(null);
  const [genPrompt, setGenPrompt] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!s.name.trim()) {
      setErr("Give it a name first.");
      return;
    }
    if (s.start_date && s.end_date && s.start_date > s.end_date) {
      setErr("End date must come after the start date.");
      return;
    }
    const min = s.budget_min === "" ? null : Number(s.budget_min);
    const max = s.budget_max === "" ? null : Number(s.budget_max);
    if (min != null && max != null && min > max) {
      setErr("Budget min can't be higher than max.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...s,
          theme: s.theme || null,
          budget_min: min,
          budget_max: max,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.code || `Server error (${res.status})`);
        return;
      }
      router.push(`/trips/${body.data.id}`);
      router.refresh();
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onUploadFile(file: File) {
    setCoverErr(null);
    if (!file.type.startsWith("image/")) {
      setCoverErr("That doesn't look like an image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setCoverErr("Image is too big — keep it under 5 MB.");
      return;
    }
    setCoverBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads/cover", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setCoverErr(body?.error?.message || body?.error?.code || `Upload failed (${res.status})`);
        return;
      }
      set("cover_image_url", body.data.url);
    } catch {
      setCoverErr("Couldn't reach Rally. Try again.");
    } finally {
      setCoverBusy(false);
    }
  }

  async function onGenerate() {
    setCoverErr(null);
    const prompt = genPrompt.trim();
    if (prompt.length < 5) {
      setCoverErr("Tell the AI a bit more — at least a few words.");
      return;
    }
    setCoverBusy(true);
    try {
      const res = await fetch("/api/uploads/generate-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setCoverErr(body?.error?.message || body?.error?.code || `Generation failed (${res.status})`);
        return;
      }
      set("cover_image_url", body.data.url);
    } catch {
      setCoverErr("Couldn't reach Rally. Try again.");
    } finally {
      setCoverBusy(false);
    }
  }

  const themeStyle = themeClass(s.theme || null);

  return (
    <form onSubmit={submit} className="grid gap-7">
      <Field label="Trip name" required>
        <input
          type="text"
          required
          maxLength={60}
          placeholder="e.g. Tulum bachelorette"
          value={s.name}
          onChange={(e) => set("name", e.target.value)}
          className={inputCls}
        />
      </Field>

      <Field label="Destination">
        <input
          type="text"
          placeholder="City, region, vibe — your call"
          value={s.destination}
          onChange={(e) => set("destination", e.target.value)}
          className={inputCls}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Start">
          <input
            type="date"
            value={s.start_date}
            onChange={(e) => set("start_date", e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="End">
          <input
            type="date"
            value={s.end_date}
            onChange={(e) => set("end_date", e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Budget min ($/person)">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Under is fine"
            value={s.budget_min}
            onChange={(e) => set("budget_min", e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Budget max ($/person)">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Ballpark"
            value={s.budget_max}
            onChange={(e) => set("budget_max", e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="Group size">
        <div className="flex flex-wrap gap-2">
          {GROUP_BUCKETS.map((b) => (
            <button
              key={b.value}
              type="button"
              onClick={() => set("group_size_bucket", b.value)}
              className={
                s.group_size_bucket === b.value
                  ? "px-4 h-11 rounded-full bg-green-soft text-green border border-green font-semibold"
                  : "px-4 h-11 rounded-full bg-card text-ink border border-line"
              }
            >
              {b.label}
            </button>
          ))}
        </div>
      </Field>

      {/* ─── Theme picker (visual mini-flyers) ────────────── */}
      <Field label="Theme">
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
          {THEMES.map((t) => {
            const picked = s.theme === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => set("theme", picked ? "" : t.value)}
                aria-pressed={picked}
                className={
                  "group relative text-left rounded-2xl border overflow-hidden transition-all " +
                  (picked
                    ? "border-green ring-2 ring-green ring-offset-2 ring-offset-cream shadow-md"
                    : "border-line hover:border-green-soft")
                }
              >
                {/* Mini cover preview */}
                <div className={`aspect-[3/2] flex items-center justify-center px-3 ${t.style.cover}`}>
                  <span
                    className={`font-display text-base sm:text-lg leading-tight text-center ${t.style.coverInk}`}
                  >
                    {s.name.trim() || "Your trip"}
                  </span>
                </div>
                {/* Mini meta line */}
                <div className="px-3 py-2 bg-card flex items-center justify-between gap-2">
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${t.style.eyebrow}`}>
                      {t.style.label}
                    </p>
                    <p className="text-[11px] text-muted">{t.style.mood}</p>
                  </div>
                  {picked && (
                    <span className="inline-flex h-5 w-5 rounded-full bg-green text-cream items-center justify-center text-xs font-bold flex-shrink-0">
                      ✓
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Description">
        <textarea
          rows={3}
          placeholder="Set the vibe in a sentence or three."
          value={s.description}
          onChange={(e) => set("description", e.target.value)}
          className={inputCls + " min-h-24 py-3"}
        />
      </Field>

      {/* ─── Cover image ───────────────────────────────────── */}
      <Field label="Cover image">
        {s.cover_image_url ? (
          <div className="grid gap-3">
            <div className="relative rounded-2xl overflow-hidden border border-line bg-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.cover_image_url}
                alt="Trip cover preview"
                className="w-full aspect-[16/10] object-cover"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  set("cover_image_url", "");
                  setCoverMode("upload");
                  setGenPrompt("");
                }}
                className="h-10 px-4 rounded-full bg-card text-muted border border-line hover:border-green hover:text-ink text-sm"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => {
                  set("cover_image_url", "");
                  setCoverMode("upload");
                  setTimeout(() => fileInputRef.current?.click(), 0);
                }}
                className="h-10 px-4 rounded-full bg-card text-ink border border-line hover:border-green text-sm"
              >
                Replace
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <div role="tablist" className="flex gap-1 p-1 bg-card border border-line rounded-full self-start">
              <CoverModeTab active={coverMode === "upload"}   onClick={() => { setCoverMode("upload");   setCoverErr(null); }}>Upload</CoverModeTab>
              <CoverModeTab active={coverMode === "generate"} onClick={() => { setCoverMode("generate"); setCoverErr(null); }}>Generate with AI</CoverModeTab>
              <CoverModeTab active={coverMode === "url"}      onClick={() => { setCoverMode("url");      setCoverErr(null); }}>Paste URL</CoverModeTab>
            </div>

            {coverMode === "upload" && (
              <UploadDropzone
                busy={coverBusy}
                onFile={onUploadFile}
                inputRef={fileInputRef}
              />
            )}

            {coverMode === "generate" && (
              <div className="grid gap-3">
                <textarea
                  rows={3}
                  maxLength={300}
                  value={genPrompt}
                  onChange={(e) => setGenPrompt(e.target.value)}
                  placeholder="Describe the cover — “a film-grain shot of a hammock on a beach at sunset, warm tones”"
                  className={inputCls + " min-h-24 py-3"}
                />
                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={coverBusy || genPrompt.trim().length < 5}
                  className="h-11 px-5 rounded-full bg-green text-cream font-bold hover:bg-green-2 self-start disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {coverBusy ? "Generating…" : "Generate cover →"}
                </button>
                <p className="text-xs text-muted">
                  Uses Gemini. Takes 5–15 seconds. You can regenerate any time.
                </p>
              </div>
            )}

            {coverMode === "url" && (
              <input
                type="url"
                placeholder="https://…"
                value={s.cover_image_url}
                onChange={(e) => set("cover_image_url", e.target.value)}
                className={inputCls}
              />
            )}

            {coverErr && <p className="text-sm text-orange">{coverErr}</p>}
          </div>
        )}
      </Field>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={s.is_public}
          onChange={(e) => set("is_public", e.target.checked)}
          className="h-5 w-5 accent-green"
        />
        <span className="text-ink">
          <span className="font-semibold">Public</span>
          <span className="text-muted text-sm ml-2">
            Anyone with the link can see the trip
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => {
            set("status", "draft");
            requestAnimationFrame(() => {
              const form = document.querySelector("form");
              form?.requestSubmit();
            });
          }}
          disabled={busy}
          className="h-12 px-5 rounded-full bg-card text-ink border border-line hover:border-green disabled:opacity-50"
        >
          Save as draft
        </button>
        <button
          type="submit"
          disabled={busy}
          className="h-12 px-6 rounded-full bg-green text-cream font-bold hover:bg-green-2 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Publish trip →"}
        </button>
      </div>

      {err && <p className="text-sm text-orange">{err}</p>}
    </form>
  );
}

// ─── Tiny sub-components ────────────────────────────────────────

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs uppercase tracking-widest text-muted font-semibold">
        {label}
        {required ? <span className="text-orange ml-1">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function CoverModeTab({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "h-8 px-3 rounded-full text-xs font-semibold transition-colors " +
        (active
          ? "bg-green text-cream"
          : "text-muted hover:text-ink")
      }
    >
      {children}
    </button>
  );
}

function UploadDropzone({
  busy, onFile, inputRef,
}: {
  busy: boolean;
  onFile: (f: File) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={
        "block cursor-pointer rounded-2xl border-2 border-dashed text-center px-6 py-10 transition-colors " +
        (dragOver
          ? "border-green bg-green-soft/40"
          : "border-line bg-card hover:border-green hover:bg-green-soft/20")
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      {busy ? (
        <p className="text-ink font-semibold">Uploading…</p>
      ) : (
        <>
          <p className="text-ink font-semibold mb-1">Drop an image here</p>
          <p className="text-muted text-sm">or click to pick. PNG, JPEG, WEBP. Under 5&nbsp;MB.</p>
        </>
      )}
    </label>
  );
}

const inputCls =
  "h-12 rounded-xl border border-line bg-card px-4 text-ink placeholder:text-muted focus:border-green focus:outline-none";
