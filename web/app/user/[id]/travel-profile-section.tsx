"use client";

/**
 * TravelProfileSection — the "Travel vibes" block on /user/[id].
 *
 * Server-rendered profile data is handed in via `initial`. If the
 * viewer is looking at their own page (`isSelf=true`), an Edit
 * button surfaces, and when the user has no profile yet we show an
 * empty-state "Add your travel vibes" CTA in place of the section.
 *
 * Editing opens a modal with a flat form (vibes / airport / dietary
 * / budget). On save, we PUT /api/users/me/profile and update local
 * state — no router.refresh() needed, the section re-renders from
 * the new state.
 *
 * The five vibe rows, the dietary chips, and the budget tier buttons
 * mirror the option lists in <ProfileCapture> so the data model
 * stays one source of truth. We import the option arrays from a
 * shared module in /lib/travel-options.ts.
 */

import { useState } from "react";
import type {
  TravelerProfile, ProfileCaptureInput, BudgetComfort,
  VibeBeachOrMountain, VibeSpaOrHike, VibeFoodieOrCasual,
  VibeSocialOrChill, VibeCultureOrRelax,
} from "@shared/types";
import {
  VIBE_BM, VIBE_SH, VIBE_FC, VIBE_SC, VIBE_CR,
  BUDGET_TIERS, DIETARY_OPTIONS, DIETARY_LABELS,
} from "@/lib/travel-options";

type Profile = Partial<TravelerProfile> | null;

export default function TravelProfileSection({
  initial,
  isSelf,
}: {
  initial: Profile;
  isSelf: boolean;
}) {
  const [profile, setProfile] = useState<Profile>(initial);
  const [editing, setEditing] = useState(false);

  const hasProfile = !!profile && (
    profile.home_airport ||
    profile.budget_comfort ||
    profile.vibe_beach_or_mountain ||
    profile.vibe_spa_or_hike ||
    profile.vibe_foodie_or_casual ||
    profile.vibe_social_or_chill ||
    profile.vibe_culture_or_relaxation ||
    (profile.dietary_restrictions && profile.dietary_restrictions.length > 0)
  );

  // Other people's pages: show the read-only card only when there's
  // actually something to show. Otherwise this section is omitted
  // (matches the prior behavior).
  if (!isSelf && !hasProfile) return null;

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold tracking-widest uppercase text-muted">
          Travel vibes
        </h2>
        {isSelf && hasProfile && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-semibold text-green hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {hasProfile ? (
        <ReadOnlyCard p={profile!} />
      ) : (
        // isSelf && !hasProfile
        <button
          onClick={() => setEditing(true)}
          className="w-full bg-card border border-line border-dashed rounded-2xl p-6 text-center hover:border-green active:scale-[0.99] transition"
        >
          <p className="font-semibold text-ink mb-1">Add your travel vibes</p>
          <p className="text-xs text-muted">
            Tell your hosts how you travel — saves them guessing.
          </p>
        </button>
      )}

      {editing && (
        <EditorModal
          initial={profile ?? {}}
          onCancel={() => setEditing(false)}
          onSaved={(next) => { setProfile(next); setEditing(false); }}
        />
      )}
    </section>
  );
}

// ─── Read-only card ────────────────────────────────────────────

function ReadOnlyCard({ p }: { p: Partial<TravelerProfile> }) {
  const vibes: string[] = [];
  if (p.vibe_beach_or_mountain      && p.vibe_beach_or_mountain      !== "both") vibes.push(p.vibe_beach_or_mountain);
  if (p.vibe_spa_or_hike            && p.vibe_spa_or_hike            !== "both") vibes.push(p.vibe_spa_or_hike);
  if (p.vibe_foodie_or_casual       && p.vibe_foodie_or_casual       !== "both") vibes.push(p.vibe_foodie_or_casual);
  if (p.vibe_social_or_chill        && p.vibe_social_or_chill        !== "both") vibes.push(p.vibe_social_or_chill);
  if (p.vibe_culture_or_relaxation  && p.vibe_culture_or_relaxation  !== "both") vibes.push(p.vibe_culture_or_relaxation);

  return (
    <div className="bg-card border border-line rounded-2xl p-5 grid gap-3 text-sm">
      {p.home_airport && (
        <Row label="Home airport" value={p.home_airport} />
      )}
      {p.budget_comfort && (
        <Row label="Budget" value={capitalize(p.budget_comfort)} />
      )}
      {vibes.length > 0 && (
        <Row label="Vibes" value={vibes.map(capitalize).join(" · ")} />
      )}
      {p.dietary_restrictions && p.dietary_restrictions.length > 0 && (
        <Row label="Dietary" value={p.dietary_restrictions.map(prettyDiet).join(", ")} />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-widest font-semibold text-muted">{label}</span>
      <span className="text-ink text-right">{value}</span>
    </div>
  );
}

// ─── Editor modal ───────────────────────────────────────────────

interface EditorState {
  vibe_beach_or_mountain:     VibeBeachOrMountain | null;
  vibe_spa_or_hike:           VibeSpaOrHike | null;
  vibe_foodie_or_casual:      VibeFoodieOrCasual | null;
  vibe_social_or_chill:       VibeSocialOrChill | null;
  vibe_culture_or_relaxation: VibeCultureOrRelax | null;
  home_airport:               string;
  dietary_restrictions:       string[];
  budget_comfort:             BudgetComfort | null;
}

function EditorModal({
  initial, onCancel, onSaved,
}: {
  initial: Partial<TravelerProfile>;
  onCancel: () => void;
  onSaved: (next: Partial<TravelerProfile>) => void;
}) {
  const [state, setState] = useState<EditorState>({
    vibe_beach_or_mountain:     initial.vibe_beach_or_mountain     ?? null,
    vibe_spa_or_hike:           initial.vibe_spa_or_hike           ?? null,
    vibe_foodie_or_casual:      initial.vibe_foodie_or_casual      ?? null,
    vibe_social_or_chill:       initial.vibe_social_or_chill       ?? null,
    vibe_culture_or_relaxation: initial.vibe_culture_or_relaxation ?? null,
    home_airport:               initial.home_airport ?? "",
    dietary_restrictions:       initial.dietary_restrictions ?? [],
    budget_comfort:             initial.budget_comfort ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  function setVibe<K extends keyof EditorState>(key: K, value: EditorState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function toggleDiet(opt: string) {
    setState((s) => ({
      ...s,
      dietary_restrictions: s.dietary_restrictions.includes(opt)
        ? s.dietary_restrictions.filter((x) => x !== opt)
        : [...s.dietary_restrictions, opt],
    }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const payload: ProfileCaptureInput = {
        vibe_beach_or_mountain:     state.vibe_beach_or_mountain,
        vibe_spa_or_hike:           state.vibe_spa_or_hike,
        vibe_foodie_or_casual:      state.vibe_foodie_or_casual,
        vibe_social_or_chill:       state.vibe_social_or_chill,
        vibe_culture_or_relaxation: state.vibe_culture_or_relaxation,
        home_airport:               state.home_airport.trim() || null,
        dietary_restrictions:       state.dietary_restrictions,
        budget_comfort:             state.budget_comfort,
      };
      const r = await fetch("/api/users/me/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await r.json();
      if (!r.ok || !body.ok) {
        setErr(body?.error?.code || "Save failed.");
        return;
      }
      onSaved(body.data as Partial<TravelerProfile>);
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog" aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="bg-cream w-full sm:max-w-2xl sm:rounded-[28px] rounded-t-[28px] max-h-[92dvh] overflow-hidden shadow-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <button onClick={onCancel} aria-label="Close" className="h-9 w-9 rounded-full hover:bg-line/40 text-ink text-xl leading-none -ml-2">×</button>
          <h2 className="font-display text-xl text-ink">Travel vibes</h2>
          <span className="w-9" />
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 grid gap-6">
          <VibeRow
            label="Beach or mountain"
            options={VIBE_BM}
            value={state.vibe_beach_or_mountain}
            onChange={(v) => setVibe("vibe_beach_or_mountain", v)}
          />
          <VibeRow
            label="Off-day mode"
            options={VIBE_SH}
            value={state.vibe_spa_or_hike}
            onChange={(v) => setVibe("vibe_spa_or_hike", v)}
          />
          <VibeRow
            label="Dinner"
            options={VIBE_FC}
            value={state.vibe_foodie_or_casual}
            onChange={(v) => setVibe("vibe_foodie_or_casual", v)}
          />
          <VibeRow
            label="Nights"
            options={VIBE_SC}
            value={state.vibe_social_or_chill}
            onChange={(v) => setVibe("vibe_social_or_chill", v)}
          />
          <VibeRow
            label="Energy"
            options={VIBE_CR}
            value={state.vibe_culture_or_relaxation}
            onChange={(v) => setVibe("vibe_culture_or_relaxation", v)}
          />

          {/* Airport */}
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-widest text-muted font-semibold">Home airport</span>
            <input
              type="text"
              value={state.home_airport}
              onChange={(e) => setState((s) => ({ ...s, home_airport: e.target.value.toUpperCase().slice(0, 8) }))}
              placeholder="SFO"
              className="h-12 rounded-xl border border-line bg-card px-4 text-ink placeholder:text-muted focus:border-green focus:outline-none uppercase"
            />
          </label>

          {/* Dietary */}
          <div className="grid gap-2">
            <span className="text-xs uppercase tracking-widest text-muted font-semibold">Dietary restrictions</span>
            <div className="flex flex-wrap gap-2">
              {DIETARY_OPTIONS.map((opt) => {
                const on = state.dietary_restrictions.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleDiet(opt)}
                    className={
                      "h-9 px-3 rounded-full text-sm font-semibold border transition-colors " +
                      (on
                        ? "bg-green text-cream border-green"
                        : "bg-card text-ink border-line hover:border-green")
                    }
                  >
                    {DIETARY_LABELS[opt] ?? opt}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Budget */}
          <div className="grid gap-2">
            <span className="text-xs uppercase tracking-widest text-muted font-semibold">Budget comfort</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {BUDGET_TIERS.map((tier) => {
                const on = state.budget_comfort === tier.value;
                return (
                  <button
                    key={tier.value}
                    type="button"
                    onClick={() => setVibe("budget_comfort", tier.value)}
                    className={
                      "rounded-xl border p-3 text-left transition-colors " +
                      (on
                        ? "bg-green text-cream border-green"
                        : "bg-card text-ink border-line hover:border-green")
                    }
                  >
                    <p className="font-bold">{tier.mark}</p>
                    <p className="text-sm font-semibold">{tier.label}</p>
                    <p className={"text-xs " + (on ? "text-cream/80" : "text-muted")}>{tier.range}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {err && <p className="text-orange text-sm">{err}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-line flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="h-11 px-5 rounded-full bg-card text-ink border border-line hover:border-green font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="h-11 px-5 rounded-full bg-green text-cream font-bold hover:bg-green-2 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function VibeRow<T extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: { value: T; label: string; cap: string }[];
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-2">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {options.map((opt) => {
          const on = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(on ? null : opt.value)}
              className={
                "rounded-xl border p-3 text-left transition-colors " +
                (on
                  ? "bg-green text-cream border-green"
                  : "bg-card text-ink border-line hover:border-green")
              }
            >
              <p className="font-semibold text-sm">{opt.label}</p>
              <p className={"text-xs " + (on ? "text-cream/80" : "text-muted")}>{opt.cap}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}
function prettyDiet(s: string): string {
  return DIETARY_LABELS[s] ?? capitalize(s);
}
