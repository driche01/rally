"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TripTheme } from "@shared/types";

const THEMES: { value: TripTheme; label: string; mood: string }[] = [
  { value: "classic",  label: "Classic",  mood: "warm, friendly" },
  { value: "eclectic", label: "Eclectic", mood: "playful, mixed" },
  { value: "fancy",    label: "Fancy",    mood: "polished" },
  { value: "literary", label: "Literary", mood: "editorial" },
  { value: "digital",  label: "Digital",  mood: "clean, modern" },
  { value: "elegant",  label: "Elegant",  mood: "refined" },
];

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

export default function TripForm() {
  const router = useRouter();
  const [s, setS] = useState<FormState>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <form onSubmit={submit} className="grid gap-6">
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

      <Field label="Theme">
        <div className="grid gap-2 sm:grid-cols-2">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => set("theme", s.theme === t.value ? "" : t.value)}
              className={
                s.theme === t.value
                  ? "p-4 rounded-xl bg-green text-cream border border-green text-left"
                  : "p-4 rounded-xl bg-card text-ink border border-line text-left hover:border-green-soft"
              }
            >
              <div className="font-bold">{t.label}</div>
              <div
                className={
                  "text-xs " +
                  (s.theme === t.value ? "text-cream/70" : "text-muted")
                }
              >
                {t.mood}
              </div>
            </button>
          ))}
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

      <Field label="Cover image URL">
        <input
          type="url"
          placeholder="https://…"
          value={s.cover_image_url}
          onChange={(e) => set("cover_image_url", e.target.value)}
          className={inputCls}
        />
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
            // Submit programmatically with status=draft via the form ref
            // would be cleaner. For now: a single click that updates state
            // and then immediately submits via requestAnimationFrame.
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

const inputCls =
  "h-12 rounded-xl border border-line bg-card px-4 text-ink placeholder:text-muted focus:border-green focus:outline-none";
