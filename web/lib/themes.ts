/**
 * Per-theme visual tokens shared between the trip form's theme
 * picker preview and the public invitation page.
 *
 * v3 (2026-05-14): widened catalog — 18 themes across 4 categories
 * (Vibes, Light, Dark, Seasonal). Partiful-inspired but Rally-unique;
 * each one is a complete bundle so the planner can preview the
 * full identity at picker-thumbnail size.
 *
 * Every theme keeps brand-coherent surface tone (cream-leaning for
 * Light/Vibes, deep + saturated for Dark/Seasonal-dark) so we don't
 * lose the warmth/identity rules from the design brief.
 *
 * CSS-only — no image assets. Each `cover` uses a Tailwind /
 * inline-color gradient or pattern to give the picker swatch its
 * unique look at a glance.
 */

import type { TripTheme, ThemeCategory } from "@shared/types";

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
  /** Human-readable label shown in pickers. */
  label: string;
  /** One-line mood description shown in tooltips. */
  mood: string;
  /** Category bucket for the theme picker filter chips. */
  category: ThemeCategory;
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
  category:      "vibes",
};

const STYLES: Record<TripTheme, ThemeStyle> = {
  // ─── Vibes (original 6) ───────────────────────────────────────────
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
    category:      "vibes",
  },

  fancy: {
    root:          "bg-[#F8F1E0]",
    display:       "font-display italic text-green tracking-tight",
    body:          "text-ink",
    meta:          "text-[#6E5530] italic",
    // Eyebrow needs to read on a cream-gold root; the original
    // gold #F3C96A was borderline. Use a saturated burnt-gold that
    // hits ~5.5:1 contrast on cream-gold.
    cover:         "bg-[#F8F1E0] border-2 border-[var(--color-gold)]/50",
    coverInk:      "font-display italic text-green-2",
    eyebrow:       "text-[#8B5A1E] tracking-[0.4em] uppercase text-[10px] font-bold",
    accent:        "bg-[var(--color-gold)]/20 text-[color:color-mix(in_oklab,var(--color-gold)_70%,black)]",
    surface:       "bg-[#FCF6E5]",
    surfaceBorder: "border-[var(--color-gold)]/30",
    label:         "Fancy",
    mood:          "gold + italic",
    category:      "vibes",
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
    category:      "vibes",
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
    category:      "vibes",
  },

  elegant: {
    root:          "bg-[#FAF6EE]",
    display:       "font-display font-normal text-green tracking-[-0.02em]",
    body:          "text-ink/90",
    meta:          "text-[#6B5F4A] tracking-wide",
    cover:         "bg-gradient-to-br from-cream to-[#E8D9B5]",
    coverInk:      "font-display text-green",
    // Same gold-on-cream contrast issue as fancy — bump to
    // burnt-gold so the eyebrow is legible.
    eyebrow:       "font-display italic text-[#8B5A1E] tracking-[0.3em] uppercase text-[11px]",
    accent:        "bg-[var(--color-gold)]/15 text-[color:color-mix(in_oklab,var(--color-gold)_70%,black)]",
    surface:       "bg-[#FCF8EE]",
    surfaceBorder: "border-[var(--color-gold)]/25",
    label:         "Elegant",
    mood:          "minimal, refined",
    category:      "vibes",
  },

  // ─── Light ────────────────────────────────────────────────────────
  mist: {
    root:          "bg-[#F0F4F8]",
    display:       "font-display text-[#1F3447] tracking-tight",
    body:          "text-[#1F3447]",
    // Meta was too pale (#7E8FA1 ≈ 3.1:1). Darker slate hits 5:1.
    meta:          "text-[#54667A]",
    cover:         "bg-gradient-to-b from-[#CCDCEA] via-[#E8EEF5] to-[#F0F4F8]",
    coverInk:      "font-display text-[#1F3447]",
    eyebrow:       "text-[#2A5C82] tracking-[0.2em] uppercase font-semibold text-[11px]",
    accent:        "bg-[#CCDCEA] text-[#1F3447]",
    surface:       "bg-white/70 backdrop-blur-sm",
    surfaceBorder: "border-[#D9E3ED]",
    label:         "Mist",
    mood:          "airy, soft sky",
    category:      "light",
  },

  blossom: {
    root:          "bg-[#FCF1EE]",
    display:       "font-display text-[#5C1F2A]",
    body:          "text-[#4A1820]",
    // Meta was washed-out mauve (#A87D85 ≈ 3:1). Bring it down to
    // 5:1 by deepening.
    meta:          "text-[#8B5660]",
    cover:         "bg-gradient-to-br from-[#FFE1DB] via-[#FFD5E5] to-[#F8D6CC]",
    coverInk:      "font-display text-[#5C1F2A]",
    // Eyebrow pink (#C56A7E) was a hair under 4.5:1 on pink-cream.
    // Deepen for clear AA contrast.
    eyebrow:       "text-[#9F3A52] tracking-[0.22em] uppercase font-bold text-[11px]",
    accent:        "bg-[#FFD5E5] text-[#5C1F2A]",
    surface:       "bg-[#FFF9F7]",
    surfaceBorder: "border-[#EFD5D0]",
    label:         "Blossom",
    mood:          "peach + petal",
    category:      "light",
  },

  sage: {
    root:          "bg-[#EFF2EB]",
    display:       "font-display text-[#1F3526]",
    body:          "text-[#1F3526]",
    // Meta was same-tone gray-green (#6E7E70) which blends. Deepen
    // for clear hierarchy.
    meta:          "text-[#4E5E50]",
    cover:         "bg-gradient-to-br from-[#C8D4BA] via-[#DFE8D2] to-[#EFF2EB]",
    coverInk:      "font-display text-[#1F3526]",
    eyebrow:       "text-[#385140] tracking-[0.22em] uppercase font-semibold text-[11px]",
    accent:        "bg-[#DFE8D2] text-[#1F3526]",
    surface:       "bg-[#F6F8F2]",
    surfaceBorder: "border-[#D5DCC9]",
    label:         "Sage",
    mood:          "garden, calm",
    category:      "light",
  },

  // ─── Dark ─────────────────────────────────────────────────────────
  midnight: {
    root:          "bg-[#0F1A2E]",
    display:       "font-display text-[#E8E0CB]",
    body:          "text-[#D7D2C2]",
    meta:          "text-[#8B96AE]",
    cover:         "bg-gradient-to-b from-[#0A1326] via-[#1A2A4A] to-[#2C3E66]",
    coverInk:      "font-display text-[#F3C96A]",
    eyebrow:       "text-[#F3C96A] tracking-[0.3em] uppercase font-bold text-[10px]",
    accent:        "bg-[#1A2A4A] text-[#F3C96A] border border-[#F3C96A]/30",
    surface:       "bg-[#1A2438]",
    surfaceBorder: "border-[#2A3550]",
    label:         "Midnight",
    mood:          "stars + ink",
    category:      "dark",
  },

  forest: {
    root:          "bg-[#0D1F18]",
    display:       "font-display text-[#E5E1CF]",
    body:          "text-[#D0D6C8]",
    meta:          "text-[#7B8C7E]",
    cover:         "bg-gradient-to-b from-[#0A1812] via-[#163024] to-[#264838]",
    coverInk:      "font-display text-[#C8E6BB]",
    eyebrow:       "text-[#C8E6BB] tracking-[0.25em] uppercase font-bold text-[10px]",
    accent:        "bg-[#163024] text-[#C8E6BB]",
    surface:       "bg-[#162820]",
    surfaceBorder: "border-[#2A3F32]",
    label:         "Forest",
    mood:          "deep evergreen",
    category:      "dark",
  },

  noir: {
    root:          "bg-[#0A0A0A]",
    display:       "font-display text-[#E5DDBB]",
    body:          "text-[#C9C2A4]",
    meta:          "text-[#7A7560]",
    cover:         "bg-[#0A0A0A] border-2 border-[#E5DDBB]/30",
    coverInk:      "font-display tracking-[0.06em] text-[#E5DDBB]",
    eyebrow:       "text-[#E5DDBB] tracking-[0.4em] uppercase font-bold text-[10px]",
    accent:        "bg-[#1A1810] text-[#E5DDBB] border border-[#E5DDBB]/30",
    surface:       "bg-[#141410]",
    surfaceBorder: "border-[#2A2820]",
    label:         "Noir",
    mood:          "black + brass",
    category:      "dark",
  },

  // ─── Vibes (new) ─────────────────────────────────────────────────
  sunset: {
    root:          "bg-[#FFF1E8]",
    display:       "font-display text-[#5C1F2E]",
    body:          "text-[#4A1D26]",
    meta:          "text-[#7A4858]",
    cover:         "bg-gradient-to-br from-[#FF6A45] via-[#F38EAC] to-[#A973C3]",
    // Bump shadow on cover ink so it reads on every gradient stop.
    coverInk:      "font-display text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] [text-shadow:0_0_12px_rgba(80,30,40,0.5)]",
    eyebrow:       "text-[#B33D14] tracking-[0.3em] uppercase font-bold text-[11px]",
    accent:        "bg-[#FFD2C2] text-[#5C1F2E]",
    surface:       "bg-[#FFF8F0]",
    surfaceBorder: "border-[#F5D5C5]",
    label:         "Sunset",
    mood:          "magic hour",
    category:      "vibes",
  },

  neon: {
    root:          "bg-[#0B0420]",
    display:       "font-body font-bold text-[#F8E5FF] tracking-tight",
    body:          "text-[#E2D2F8]",
    meta:          "text-[#9F87C9]",
    cover:         "bg-[#0B0420] bg-[radial-gradient(circle_at_30%_30%,rgba(255,69,159,0.5),transparent_50%),radial-gradient(circle_at_70%_70%,rgba(0,255,201,0.4),transparent_50%)]",
    coverInk:      "font-body font-bold uppercase text-[#FF459F] tracking-widest",
    eyebrow:       "text-[#00FFC9] tracking-[0.4em] uppercase font-bold text-[10px]",
    accent:        "bg-[#FF459F]/20 text-[#FF459F] border border-[#FF459F]/40",
    surface:       "bg-[#160830]",
    surfaceBorder: "border-[#3A1A60]",
    label:         "Neon",
    mood:          "rave-coded",
    category:      "vibes",
  },

  // ─── Seasonal ────────────────────────────────────────────────────
  spring: {
    root:          "bg-[#F4F8EE]",
    display:       "font-display text-[#264028]",
    body:          "text-[#264028]",
    meta:          "text-[#5A6E5C]",
    // Cover gradient passes through a pastel pink mid-stop, so the
    // ink needs a drop-shadow to stay legible across all three
    // hues without fighting the gradient.
    cover:         "bg-gradient-to-br from-[#E8F0C7] via-[#FFD7DD] to-[#C8E6D2]",
    coverInk:      "font-display text-[#264028] drop-shadow-[0_1px_2px_rgba(255,255,255,0.6)]",
    eyebrow:       "text-[#A93D5A] tracking-[0.22em] uppercase font-bold text-[11px]",
    accent:        "bg-[#E8F0C7] text-[#264028]",
    surface:       "bg-[#F8FBF2]",
    surfaceBorder: "border-[#DCE5D1]",
    label:         "Spring",
    mood:          "fresh blooms",
    category:      "seasonal",
  },

  summer: {
    root:          "bg-[#FFF6E3]",
    display:       "font-display text-[#6B380F]",
    body:          "text-[#6B380F]",
    // #B98A56 on cream-yellow ≈ 3.4:1 — borderline. Deepen.
    meta:          "text-[#946B3D]",
    cover:         "bg-gradient-to-br from-[#FFCD3A] via-[#FF8C4B] to-[#F35F77]",
    // White over yellow-orange-pink gradient is the weakest link.
    // Layer two shadows: a tight dark one (for crispness on the
    // yellow stop) + a soft glow (for the orange/pink stops).
    coverInk:      "font-display text-white drop-shadow-[0_1px_2px_rgba(60,30,0,0.55)] [text-shadow:0_0_12px_rgba(60,30,0,0.45)]",
    eyebrow:       "text-[#B53F00] tracking-[0.25em] uppercase font-bold text-[11px]",
    accent:        "bg-[#FFE0A2] text-[#6B380F]",
    surface:       "bg-[#FFFBF0]",
    surfaceBorder: "border-[#F2DCB0]",
    label:         "Summer",
    mood:          "citrus + heat",
    category:      "seasonal",
  },

  autumn: {
    root:          "bg-[#F8EFE4]",
    display:       "font-display text-[#4A210C]",
    body:          "text-[#4A210C]",
    meta:          "text-[#7A5235]",
    cover:         "bg-gradient-to-br from-[#D8722A] via-[#A8421A] to-[#5F2E1A]",
    coverInk:      "font-display text-[#F7E0BC]",
    eyebrow:       "text-[#8B3110] tracking-[0.25em] uppercase font-bold text-[11px]",
    accent:        "bg-[#E8C8A0] text-[#4A210C]",
    surface:       "bg-[#FCF6EC]",
    surfaceBorder: "border-[#E0CCB0]",
    label:         "Autumn",
    mood:          "leaves + spice",
    category:      "seasonal",
  },

  winter: {
    root:          "bg-[#EFF4F8]",
    display:       "font-display text-[#1B2F44]",
    body:          "text-[#1B2F44]",
    meta:          "text-[#54667E]",
    cover:         "bg-gradient-to-b from-[#D5E2EE] via-[#E8EEF5] to-[#F0F4F8] border border-[#283F58]/15",
    coverInk:      "font-display text-[#1B2F44]",
    eyebrow:       "text-[#365F8B] tracking-[0.28em] uppercase font-bold text-[10px]",
    accent:        "bg-[#D5E2EE] text-[#1B2F44]",
    surface:       "bg-white/80 backdrop-blur-sm",
    surfaceBorder: "border-[#D5DDE5]",
    label:         "Winter",
    mood:          "frost + glass",
    category:      "seasonal",
  },
};

export function themeClass(theme: TripTheme | null | undefined): ThemeStyle {
  if (!theme) return CLASSIC;
  return STYLES[theme] ?? CLASSIC;
}

export const THEMES: { value: TripTheme; style: ThemeStyle }[] = (
  Object.keys(STYLES) as TripTheme[]
).map((value) => ({ value, style: STYLES[value] }));

/**
 * Allow-list for API validation. Derived from STYLES so it can never
 * drift from the renderable set — any theme exposed in the picker is
 * automatically accepted by POST/PATCH. The DB CHECK constraint on
 * trips.theme is the final gate and must be kept in sync via
 * migrations.
 */
export const ALLOWED_THEMES: ReadonlySet<TripTheme> = new Set(
  Object.keys(STYLES) as TripTheme[],
);

/** Category label + emoji shown in the theme picker filter chips. */
export const THEME_CATEGORIES: { value: ThemeCategory; label: string; emoji: string }[] = [
  { value: "vibes",    label: "Vibes",    emoji: "✨" },
  { value: "light",    label: "Light",    emoji: "🌤" },
  { value: "dark",     label: "Dark",     emoji: "🌙" },
  { value: "seasonal", label: "Seasonal", emoji: "🍂" },
];
