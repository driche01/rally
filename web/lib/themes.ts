/**
 * Per-theme visual tokens shared between the trip form's theme
 * picker preview and the public invitation page.
 *
 * v2 (2026-05-12): aggressive differentiation. Each theme moves
 * background tone, headline font/weight, accent color, cover
 * treatment, and eyebrow style — not just the cover gradient.
 * Classic stays as the cream/green baseline. The other five push
 * far enough away that a planner can tell them apart at picker-
 * thumbnail size.
 *
 * Every theme keeps the cream-leaning canvas family — no pure
 * white, no blue — so the brand identity rules from the design
 * brief still hold.
 */

import type { TripTheme } from "@shared/types";

export interface ThemeStyle {
  /** className applied to the outer <main> — page background tone */
  root: string;
  /** className for the trip-name display headline */
  display: string;
  /** className for body / paragraph text */
  body: string;
  /** className for muted lines (dates, sub-copy) */
  meta: string;
  /** className for the cover container (gradient, border, etc.) */
  cover: string;
  /** className applied INSIDE the cover for the trip-name overlay */
  coverInk: string;
  /** className for the eyebrow row above the headline */
  eyebrow: string;
  /** className for small accent chips (avatar fallback, guest pills) */
  accent: string;
  /** className for surface cards (e.g., budget tile, summary card) */
  surface: string;
  /** className for the hairline border between surfaces */
  surfaceBorder: string;
  label: string;
  mood: string;
}

// Classic doubles as the fallback when a trip has no theme set.
const CLASSIC: ThemeStyle = {
  root:          "bg-cream",
  display:       "font-display text-ink",
  body:          "text-ink",
  meta:          "text-muted",
  cover:         "bg-gradient-to-br from-green-soft to-cream-2",
  coverInk:      "font-display text-green",
  eyebrow:       "text-green tracking-[0.18em] uppercase font-bold",
  accent:        "bg-green-soft text-green",
  surface:       "bg-card",
  surfaceBorder: "border-line",
  label:         "Classic",
  mood:          "warm + friendly",
};

const STYLES: Record<TripTheme, ThemeStyle> = {
  classic: CLASSIC,

  eclectic: {
    root:          "bg-[#FFF6E8]",
    display:       "font-display text-ink",
    body:          "text-ink",
    meta:          "text-[#7A5A3A]",
    cover:         "bg-gradient-to-br from-[#FF6A45] via-[#F3C96A] to-[#DFE8D2]",
    coverInk:      "font-display text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.15)]",
    eyebrow:       "text-[#D85A30] tracking-[0.3em] uppercase font-bold",
    accent:        "bg-[#FFDDB0] text-[#D85A30]",
    surface:       "bg-[#FFFBF1]",
    surfaceBorder: "border-[#F3D9B8]",
    label:         "Eclectic",
    mood:          "sunset, bold",
  },

  fancy: {
    root:          "bg-[#F8F1E0]",
    display:       "font-display italic text-green tracking-tight",
    body:          "text-ink",
    meta:          "text-muted italic",
    cover:         "bg-[#F8F1E0] border-2 border-[var(--color-gold)]/50",
    coverInk:      "font-display italic text-green-2",
    eyebrow:       "text-gold tracking-[0.4em] uppercase text-[10px] font-bold",
    accent:        "bg-[var(--color-gold)]/20 text-[color:color-mix(in_oklab,var(--color-gold)_70%,black)]",
    surface:       "bg-[#FCF6E5]",
    surfaceBorder: "border-[var(--color-gold)]/30",
    label:         "Fancy",
    mood:          "gold + italic",
  },

  literary: {
    root:          "bg-[#F4ECDF]",
    display:       "font-display text-ink",
    body:          "text-ink",
    meta:          "text-[#5F4F40]",
    cover:         "bg-[#F4ECDF] border-[3px] border-double border-ink/40",
    coverInk:      "font-display text-ink",
    eyebrow:       "font-display italic text-ink/70 text-[13px] normal-case tracking-normal",
    accent:        "bg-cream-2 text-ink border border-ink/20",
    surface:       "bg-cream",
    surfaceBorder: "border-ink/15",
    label:         "Literary",
    mood:          "magazine, serif",
  },

  digital: {
    root:          "bg-[#F5F5F1]",
    display:       "font-body font-bold text-ink tracking-tight",
    body:          "text-ink",
    meta:          "font-mono text-muted text-xs",
    cover:         "bg-[#1A2520]",
    coverInk:      "font-mono uppercase text-[#7DDDB1] tracking-tight",
    eyebrow:       "font-mono text-green tracking-tight lowercase font-semibold",
    accent:        "bg-[#7DDDB1]/20 text-green",
    surface:       "bg-white",
    surfaceBorder: "border-[#E0E0DA]",
    label:         "Digital",
    mood:          "mono, sharp",
  },

  elegant: {
    root:          "bg-[#FAF6EE]",
    display:       "font-display font-normal text-green tracking-[-0.02em]",
    body:          "text-ink/90",
    meta:          "text-muted tracking-wide",
    cover:         "bg-gradient-to-br from-cream to-[#E8D9B5]",
    coverInk:      "font-display text-green",
    eyebrow:       "font-display italic text-gold tracking-[0.3em] uppercase text-[11px]",
    accent:        "bg-[var(--color-gold)]/15 text-[color:color-mix(in_oklab,var(--color-gold)_70%,black)]",
    surface:       "bg-[#FCF8EE]",
    surfaceBorder: "border-[var(--color-gold)]/25",
    label:         "Elegant",
    mood:          "minimal, refined",
  },
};

export function themeClass(theme: TripTheme | null | undefined): ThemeStyle {
  if (!theme) return CLASSIC;
  return STYLES[theme] ?? CLASSIC;
}

export const THEMES: { value: TripTheme; style: ThemeStyle }[] = (
  Object.keys(STYLES) as TripTheme[]
).map((value) => ({ value, style: STYLES[value] }));
