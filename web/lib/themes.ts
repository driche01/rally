/**
 * Per-theme visual tokens shared between the trip form's theme
 * picker preview and the public invitation page. One source of
 * truth — change a cover gradient here and both surfaces shift.
 *
 * Phase A keeps the differentiation light: cream/green canvas
 * with theme-specific cover gradient + eyebrow color + label.
 * Heavier theme work (typography variants, layout variants) is
 * deferred to Phase B polish.
 */

import type { TripTheme } from "@shared/types";

export interface ThemeStyle {
  root:      string;
  cover:     string;
  coverInk:  string;
  eyebrow:   string;
  label:     string;
  mood:      string;
}

const DEFAULT_THEME: ThemeStyle = {
  root:     "",
  cover:    "bg-gradient-to-br from-green-soft to-cream-2",
  coverInk: "text-green",
  eyebrow:  "text-green",
  label:    "Classic",
  mood:     "warm, friendly",
};

const STYLES: Record<TripTheme, ThemeStyle> = {
  classic: {
    ...DEFAULT_THEME,
    label: "Classic",
    mood:  "warm + friendly",
  },
  eclectic: {
    ...DEFAULT_THEME,
    cover:   "bg-gradient-to-br from-[#FFB68A] via-cream to-green-soft",
    eyebrow: "text-orange",
    label:   "Eclectic",
    mood:    "playful, mixed",
  },
  fancy: {
    ...DEFAULT_THEME,
    cover:    "bg-gradient-to-br from-cream to-cream-2 border border-line",
    coverInk: "text-green-2 italic",
    eyebrow:  "text-gold",
    label:    "Fancy",
    mood:     "polished",
  },
  literary: {
    ...DEFAULT_THEME,
    cover:    "bg-cream-2 border border-line",
    coverInk: "text-ink",
    label:    "Literary",
    mood:     "editorial",
  },
  digital: {
    ...DEFAULT_THEME,
    cover:    "bg-gradient-to-br from-cream to-green-soft",
    coverInk: "text-green font-mono tracking-tight",
    label:    "Digital",
    mood:     "clean + modern",
  },
  elegant: {
    ...DEFAULT_THEME,
    cover:    "bg-gradient-to-br from-cream to-[#F1E8D4] border border-[var(--color-gold)]/30",
    coverInk: "text-green",
    eyebrow:  "text-gold",
    label:    "Elegant",
    mood:     "refined",
  },
};

export function themeClass(theme: TripTheme | null | undefined): ThemeStyle {
  if (!theme) return DEFAULT_THEME;
  return STYLES[theme] ?? DEFAULT_THEME;
}

export const THEMES: { value: TripTheme; style: ThemeStyle }[] = (
  Object.keys(STYLES) as TripTheme[]
).map((value) => ({ value, style: STYLES[value] }));
