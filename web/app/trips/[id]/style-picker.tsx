"use client";

/**
 * Style picker — floating side-rail (right edge, vertically
 * centered) with two access points: Theme + Effect. Each opens a
 * slide-in panel from the right with category filter chips and a
 * grid of circular preview swatches.
 *
 * Planner / cohost only. Hidden when canEdit=false.
 *
 * Patches `trips.theme` / `trips.effect` via the existing
 * /api/trips/[id] PATCH route. Closes after each pick so the next
 * tap re-opens to the latest selection.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { THEMES, THEME_CATEGORIES } from "@/lib/themes";
import { EFFECT_CATALOG } from "@/lib/effects/effect-overlay";
import type { TripTheme, TripEffect, ThemeCategory } from "@shared/types";

type PanelKind = "theme" | "effect" | null;
type EffectCategoryFilter = "all" | "fun" | "classic" | "seasonal";
type ThemeCategoryFilter  = "all" | ThemeCategory;

export default function StylePicker({
  tripId,
  canEdit,
  currentTheme,
  currentEffect,
}: {
  tripId: string;
  canEdit: boolean;
  currentTheme: TripTheme | null;
  currentEffect: TripEffect | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<PanelKind>(null);

  if (!canEdit) return null;

  async function patch(fields: { theme?: TripTheme | null; effect?: TripEffect | null }) {
    await fetch(`/api/trips/${tripId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    router.refresh();
    setOpen(null);
  }

  return (
    <>
      {/* ─── Side rail ──────────────────────────────── */}
      <div className="fixed right-3 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2 bg-cream/95 backdrop-blur-sm rounded-2xl shadow-lg border border-line p-2">
        <RailButton
          label="Theme"
          emoji="🎨"
          active={open === "theme"}
          onClick={() => setOpen(open === "theme" ? null : "theme")}
        />
        <RailButton
          label="Effect"
          emoji="✨"
          active={open === "effect"}
          onClick={() => setOpen(open === "effect" ? null : "effect")}
        />
      </div>

      {/* ─── Theme panel ────────────────────────────── */}
      {open === "theme" && (
        <ThemePanel
          currentTheme={currentTheme}
          onPick={(t) => patch({ theme: t })}
          onClose={() => setOpen(null)}
        />
      )}

      {/* ─── Effect panel ───────────────────────────── */}
      {open === "effect" && (
        <EffectPanel
          currentEffect={currentEffect}
          onPick={(e) => patch({ effect: e })}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function RailButton({
  label, emoji, active, onClick,
}: { label: string; emoji: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-colors " +
        (active
          ? "bg-green text-cream"
          : "bg-card text-ink hover:bg-green-soft")
      }
    >
      <span className="text-2xl leading-none" aria-hidden>{emoji}</span>
      <span className="text-[10px] mt-1 font-semibold">{label}</span>
    </button>
  );
}

// ─── Theme panel ───────────────────────────────────────────────────

function ThemePanel({
  currentTheme, onPick, onClose,
}: {
  currentTheme: TripTheme | null;
  onPick: (t: TripTheme | null) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<ThemeCategoryFilter>("all");
  const visible = THEMES.filter((t) => filter === "all" || t.style.category === filter);

  return (
    <PanelShell title="Theme" onClose={onClose}>
      <div className="flex flex-wrap gap-2 mb-4">
        <FilterChip
          label="All"
          emoji="✦"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        {THEME_CATEGORIES.map((c) => (
          <FilterChip
            key={c.value}
            label={c.label}
            emoji={c.emoji}
            active={filter === c.value}
            onClick={() => setFilter(c.value)}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {/* No-theme option = classic. Keep this implicit by mapping
            theme=null to selecting classic in the swatch grid. */}
        {visible.map(({ value, style }) => {
          const picked = currentTheme === value || (currentTheme == null && value === "classic");
          return (
            <button
              key={value}
              type="button"
              onClick={() => onPick(value === "classic" ? null : value)}
              className="flex flex-col items-center gap-1 group"
              title={style.mood}
            >
              <span
                className={
                  "w-16 h-16 rounded-full overflow-hidden border-2 transition-transform group-hover:scale-105 " +
                  (picked ? "border-ink" : "border-transparent")
                }
              >
                {/* The cover className IS the visual identity — use
                    it as the swatch directly. */}
                <span className={`block w-full h-full ${style.cover}`} />
              </span>
              <span className="text-xs text-ink font-semibold">{style.label}</span>
            </button>
          );
        })}
      </div>
    </PanelShell>
  );
}

// ─── Effect panel ──────────────────────────────────────────────────

function EffectPanel({
  currentEffect, onPick, onClose,
}: {
  currentEffect: TripEffect | null;
  onPick: (e: TripEffect | null) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<EffectCategoryFilter>("all");
  const visible = EFFECT_CATALOG.filter((e) => filter === "all" || e.category === filter);

  return (
    <PanelShell title="Effect" onClose={onClose}>
      <div className="flex flex-wrap gap-2 mb-4">
        <FilterChip label="All"      emoji="✦"  active={filter === "all"}      onClick={() => setFilter("all")} />
        <FilterChip label="Fun"      emoji="🎉" active={filter === "fun"}      onClick={() => setFilter("fun")} />
        <FilterChip label="Classic"  emoji="⭐" active={filter === "classic"}  onClick={() => setFilter("classic")} />
        <FilterChip label="Seasonal" emoji="🍂" active={filter === "seasonal"} onClick={() => setFilter("seasonal")} />
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {/* None option. */}
        <button
          type="button"
          onClick={() => onPick(null)}
          className="flex flex-col items-center gap-1 group"
          title="No effect"
        >
          <span
            className={
              "w-16 h-16 rounded-full overflow-hidden border-2 bg-cream-2 flex items-center justify-center transition-transform group-hover:scale-105 " +
              (currentEffect == null ? "border-ink" : "border-transparent")
            }
          >
            <span className="text-2xl opacity-60" aria-hidden>🚫</span>
          </span>
          <span className="text-xs text-ink font-semibold">None</span>
        </button>

        {visible.map((e) => {
          const picked = currentEffect === e.value;
          return (
            <button
              key={e.value}
              type="button"
              onClick={() => onPick(e.value)}
              className="flex flex-col items-center gap-1 group"
            >
              <span
                className={
                  "w-16 h-16 rounded-full overflow-hidden border-2 flex items-center justify-center text-3xl transition-transform group-hover:scale-105 " +
                  "bg-gradient-to-br from-[#1A1838] via-[#2A1A4A] to-[#4A2A6A] " +
                  (picked ? "border-ink" : "border-transparent")
                }
                aria-hidden
              >
                {e.emoji}
              </span>
              <span className="text-xs text-ink font-semibold">{e.label}</span>
            </button>
          );
        })}
      </div>
    </PanelShell>
  );
}

// ─── Shared panel shell ────────────────────────────────────────────

function PanelShell({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      {/* Click-outside backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close picker"
        className="absolute inset-0 bg-ink/30 backdrop-blur-sm pointer-events-auto animate-fade-in"
      />
      {/* Slide-in panel from the right */}
      <div
        role="dialog"
        aria-label={`${title} picker`}
        className="absolute right-0 top-0 bottom-0 w-full sm:w-[420px] bg-cream pointer-events-auto shadow-xl overflow-y-auto animate-slide-in-right-panel"
      >
        <div className="sticky top-0 bg-cream/95 backdrop-blur-sm border-b border-line px-5 py-4 flex items-center justify-between z-10">
          <h2 className="font-display text-2xl text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-10 w-10 rounded-full hover:bg-line/40 text-ink text-2xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>

      <style>{`
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slide-in-right-panel { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-fade-in              { animation: fade-in 200ms ease-out; }
        .animate-slide-in-right-panel { animation: slide-in-right-panel 260ms cubic-bezier(0.2, 0.9, 0.3, 1.05); }
      `}</style>
    </div>
  );
}

function FilterChip({
  label, emoji, active, onClick,
}: { label: string; emoji: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "h-9 px-3 rounded-full text-sm font-semibold transition-colors flex items-center gap-1.5 " +
        (active
          ? "bg-ink text-cream"
          : "bg-card text-ink border border-line hover:border-green-soft")
      }
    >
      <span aria-hidden>{emoji}</span>
      {label}
    </button>
  );
}
