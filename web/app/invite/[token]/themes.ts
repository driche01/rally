/**
 * Per-theme visual tokens for the invitation page. Phase A keeps
 * the differentiation light — one shared cream/green canvas, theme
 * shifts the cover gradient, eyebrow color, and label. Heavier
 * theme work (typography variants, layout variants) is deferred.
 */

import type { TripTheme } from "@shared/types";

interface ThemeStyle {
  root:      string;
  cover:     string;
  coverInk:  string;
  eyebrow:   string;
  label:     string;
}

const DEFAULT_THEME: ThemeStyle = {
  root:     "",
  cover:    "bg-gradient-to-br from-green-soft to-cream-2",
  coverInk: "text-green",
  eyebrow:  "text-green",
  label:    "Classic",
};

const STYLES: Record<TripTheme, ThemeStyle> = {
  classic: {
    ...DEFAULT_THEME,
    label: "Classic",
  },
  eclectic: {
    ...DEFAULT_THEME,
    cover:   "bg-gradient-to-br from-[#FFB68A] via-cream to-green-soft",
    eyebrow: "text-orange",
    label:   "Eclectic",
  },
  fancy: {
    ...DEFAULT_THEME,
    cover:    "bg-gradient-to-br from-cream to-cream-2 border border-line",
    coverInk: "text-green-2 italic",
    eyebrow:  "text-gold",
    label:    "Fancy",
  },
  literary: {
    ...DEFAULT_THEME,
    cover:    "bg-cream-2 border border-line",
    coverInk: "text-ink",
    label:    "Literary",
  },
  digital: {
    ...DEFAULT_THEME,
    cover:    "bg-gradient-to-br from-cream to-green-soft",
    coverInk: "text-green font-mono tracking-tight",
    label:    "Digital",
  },
  elegant: {
    ...DEFAULT_THEME,
    cover:    "bg-gradient-to-br from-cream to-[#F1E8D4] border border-[var(--color-gold)]/30",
    coverInk: "text-green",
    eyebrow:  "text-gold",
    label:    "Elegant",
  },
};

export function themeClass(theme: TripTheme | null | undefined): ThemeStyle {
  if (!theme) return DEFAULT_THEME;
  return STYLES[theme] ?? DEFAULT_THEME;
}
