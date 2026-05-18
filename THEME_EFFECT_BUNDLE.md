# Rally theme + effect system — share bundle

This document concatenates every file relevant to Rally's per-trip
theme + effect system. Paste it into a Claude session to give the
agent full context for designing new themes or effects.

Files included, in order:

1. **`shared/types.ts`** (excerpt) — `TripTheme` + `TripEffect` + category unions
2. **`web/lib/themes.ts`** — `THEMES` registry, every theme's full styling, helpers
3. **`web/lib/effects/effect-overlay.tsx`** — runtime overlay component, CSS animations, `EFFECT_CATALOG`
4. **`web/app/trips/[id]/style-picker.tsx`** — floating picker UI
5. **`web/app/api/trips/route.ts`** — POST validates `theme` against `ALLOWED_THEMES`
6. **`web/app/api/trips/[id]/route.ts`** — PATCH validates both, defines `ALLOWED_EFFECTS`
7. **`web/app/globals.css`** — CSS-first design tokens (colors, shadows, fonts) every theme references

## How to add a new theme (mental model)

1. Add the string literal to `TripTheme` in `shared/types.ts`.
2. Add a `ThemeStyle` entry to the `STYLES` map in `web/lib/themes.ts`. Every
   slot is a Tailwind className string — `root`, `display`, `body`, `meta`,
   `cover`, `coverInk`, `eyebrow`, `accent`, `surface`, `surfaceBorder`, `label`,
   `mood`, `category`. Use design tokens (`bg-cream`, `text-green`, etc.) or
   arbitrary values like `bg-[#1A2520]` for unique colors.
3. The picker UI iterates the `THEMES` array automatically — no UI changes
   needed.
4. The API validates against `ALLOWED_THEMES` which is derived from `STYLES`,
   so adding the entry there is enough.
5. The DB has a `trips.theme` CHECK constraint listing allowed strings — needs
   a migration if you want it to accept the new value (additive only per the
   schema rule).

## How to add a new effect

1. Add the string literal to `TripEffect` in `shared/types.ts`.
2. Add a `variants[...]` entry in `effect-overlay.tsx` defining char/size/color/
   animation/extraClass.
3. Add a row to `EFFECT_CATALOG` at the bottom of the same file (the picker
   reads from this).
4. Add the string to `ALLOWED_EFFECTS` in `web/app/api/trips/[id]/route.ts`.
5. If your effect needs a new `@keyframes` rule, add it inline in the `<style>`
   block at the bottom of `effect-overlay.tsx`.

## Design tokens cheatsheet (referenced by every theme)

```
--color-cream      #FBF7EF   page bg
--color-cream-2    #F4ECDF   secondary surface
--color-card       #FFFCF6   elevated card
--color-line       #D9CCB6   hairline border
--color-green      #0F3F2E   anchor / CTA
--color-green-2    #174F3C   pressed CTA
--color-green-soft #DFE8D2   accent fill
--color-ink        #163026   primary text
--color-muted      #5F685F   secondary text
--color-gold       #F3C96A   warm accent (only allowed warm)
--color-error      #C13515   destructive surface
--color-orange     #D85A30   RETIRED — coral, do not use
```

Fonts:
```
--font-display: "Fredoka One", "Fredoka", system fallbacks   (chunky bubbly)
--font-body:    "Fredoka",     system fallbacks              (rounded sans)
```
- Body baseline weight 600 (set on html/body).
- `font-synthesis: none` globally so display elements asking for 700 walk the
  cascade to Fredoka (Fredoka One only ships weight 400).

---

# 1. `shared/types.ts` (theme + effect excerpt)

```ts
// ─── Trips ────────────────────────────────────────────────────────

export type TripTheme =
  // ─── Vibes (the original six) ───────────────────────────────────
  | "classic"
  | "eclectic"
  | "fancy"
  | "literary"
  | "digital"
  | "elegant"
  // ─── Light ──────────────────────────────────────────────────────
  | "mist"
  | "blossom"
  | "sage"
  // ─── Dark ───────────────────────────────────────────────────────
  | "midnight"
  | "forest"
  | "noir"
  // ─── Vibes (new) ────────────────────────────────────────────────
  | "sunset"
  | "neon"
  // ─── Seasonal ───────────────────────────────────────────────────
  | "spring"
  | "summer"
  | "autumn"
  | "winter";

/** Category bucket for the theme picker filters. */
export type ThemeCategory = "vibes" | "light" | "dark" | "seasonal";

/** Visual effect rendered as an animated overlay on the trip page. */
export type TripEffect =
  | "sparkles"
  | "confetti"
  | "hearts"
  | "snowflakes"
  | "bubbles"
  | "petals"
  | "embers"
  | "stars";

/** Category bucket for the effect picker. */
export type EffectCategory = "fun" | "classic" | "seasonal";
```

---

# 2. `web/lib/themes.ts`

```ts
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
  eyebrow:       "font-display text-green tracking-[0.18em] uppercase font-bold",
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

  // Reskinned 2026-05-16 — re-anchored to green + gold per the brand
  // coral retirement. Same "bold" energy as before, brand-coherent now.
  eclectic: {
    root:          "bg-[#FAF1DC]",
    display:       "font-display text-green",
    body:          "text-ink",
    meta:          "text-[#6B5530]",
    cover:         "bg-gradient-to-br from-green via-[var(--color-gold)] to-green-soft",
    coverInk:      "font-display text-cream drop-shadow-[0_2px_8px_rgba(0,0,0,0.25)]",
    eyebrow:       "font-display text-green tracking-[0.3em] uppercase font-bold",
    accent:        "bg-[var(--color-gold)]/30 text-green",
    surface:       "bg-[#FFFBF1]",
    surfaceBorder: "border-[#E8D9B8]",
    label:         "Eclectic",
    mood:          "bold + gold",
    category:      "vibes",
  },

  fancy: {
    root:          "bg-[#F8F1E0]",
    display:       "font-display italic text-green tracking-tight",
    body:          "text-ink",
    meta:          "text-[#6E5530] italic",
    cover:         "bg-[#F8F1E0] border-2 border-[var(--color-gold)]/50",
    coverInk:      "font-display italic text-green-2",
    eyebrow:       "font-display text-[#8B5A1E] tracking-[0.4em] uppercase text-[10px] font-bold",
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
    display:       "font-mono uppercase text-ink tracking-tight font-semibold",
    body:          "font-mono text-ink",
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
    meta:          "text-[#54667A]",
    cover:         "bg-gradient-to-b from-[#CCDCEA] via-[#E8EEF5] to-[#F0F4F8]",
    coverInk:      "font-display text-[#1F3447]",
    eyebrow:       "font-display text-[#2A5C82] tracking-[0.2em] uppercase font-semibold text-[11px]",
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
    meta:          "text-[#8B5660]",
    cover:         "bg-gradient-to-br from-[#FFE1DB] via-[#FFD5E5] to-[#F8D6CC]",
    coverInk:      "font-display text-[#5C1F2A]",
    eyebrow:       "font-display text-[#9F3A52] tracking-[0.22em] uppercase font-bold text-[11px]",
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
    meta:          "text-[#4E5E50]",
    cover:         "bg-gradient-to-br from-[#C8D4BA] via-[#DFE8D2] to-[#EFF2EB]",
    coverInk:      "font-display text-[#1F3526]",
    eyebrow:       "font-display text-[#385140] tracking-[0.22em] uppercase font-semibold text-[11px]",
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
    eyebrow:       "font-display text-[#F3C96A] tracking-[0.3em] uppercase font-bold text-[10px]",
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
    eyebrow:       "font-display text-[#C8E6BB] tracking-[0.25em] uppercase font-bold text-[10px]",
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
    eyebrow:       "font-display text-[#E5DDBB] tracking-[0.4em] uppercase font-bold text-[10px]",
    accent:        "bg-[#1A1810] text-[#E5DDBB] border border-[#E5DDBB]/30",
    surface:       "bg-[#141410]",
    surfaceBorder: "border-[#2A2820]",
    label:         "Noir",
    mood:          "black + brass",
    category:      "dark",
  },

  // ─── Vibes (new) ─────────────────────────────────────────────────
  sunset: {
    root:          "bg-[#F8EEDA]",
    display:       "font-display text-[#3A2912]",
    body:          "text-[#3A2912]",
    meta:          "text-[#6E5530]",
    cover:         "bg-gradient-to-br from-[var(--color-gold)] via-[#C18A2E] to-green",
    coverInk:      "font-display text-cream drop-shadow-[0_1px_2px_rgba(20,30,20,0.55)] [text-shadow:0_0_12px_rgba(40,30,10,0.45)]",
    eyebrow:       "font-display text-[#8B5A1E] tracking-[0.3em] uppercase font-bold text-[11px]",
    accent:        "bg-[var(--color-gold)]/30 text-[#5C3F12]",
    surface:       "bg-[#FFF8E8]",
    surfaceBorder: "border-[#E8D5A8]",
    label:         "Sunset",
    mood:          "golden hour",
    category:      "vibes",
  },

  neon: {
    root:          "bg-[#0B0420]",
    display:       "font-body font-bold text-[#F8E5FF] tracking-tight",
    body:          "text-[#E2D2F8]",
    meta:          "text-[#9F87C9]",
    cover:         "bg-[#0B0420] bg-[radial-gradient(circle_at_30%_30%,rgba(255,69,159,0.5),transparent_50%),radial-gradient(circle_at_70%_70%,rgba(0,255,201,0.4),transparent_50%)]",
    coverInk:      "font-body font-bold uppercase text-[#FF459F] tracking-widest",
    eyebrow:       "font-display text-[#00FFC9] tracking-[0.4em] uppercase font-bold text-[10px]",
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
    cover:         "bg-gradient-to-br from-[#E8F0C7] via-[#FFD7DD] to-[#C8E6D2]",
    coverInk:      "font-display text-[#264028] drop-shadow-[0_1px_2px_rgba(255,255,255,0.6)]",
    eyebrow:       "font-display text-[#A93D5A] tracking-[0.22em] uppercase font-bold text-[11px]",
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
    meta:          "text-[#946B3D]",
    cover:         "bg-gradient-to-br from-[#FFCD3A] via-[#FF8C4B] to-[#F35F77]",
    coverInk:      "font-display text-white drop-shadow-[0_1px_2px_rgba(60,30,0,0.55)] [text-shadow:0_0_12px_rgba(60,30,0,0.45)]",
    eyebrow:       "font-display text-[#B53F00] tracking-[0.25em] uppercase font-bold text-[11px]",
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
    eyebrow:       "font-display text-[#8B3110] tracking-[0.25em] uppercase font-bold text-[11px]",
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
    eyebrow:       "font-display text-[#365F8B] tracking-[0.28em] uppercase font-bold text-[10px]",
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
```

---

# 3. `web/lib/effects/effect-overlay.tsx`

```tsx
"use client";

/**
 * Effect overlay — renders an animated decorative layer over the
 * trip page when `trips.effect` is set. All effects are CSS-only
 * (no canvas, no JS animation loops) so they run cheaply, work on
 * SSR, and never block interaction. The overlay is `pointer-events-
 * none` so clicks pass through to the content beneath.
 *
 * Each effect uses a small swarm of particles (8-24) rendered as
 * absolutely-positioned spans/svgs, each with a distinct animation
 * delay + duration to look organic.
 *
 * Effects:
 *   sparkles    — twinkling pinpoint stars
 *   confetti    — drifting square confetti
 *   hearts      — rising heart emoji
 *   snowflakes  — falling snowflakes
 *   bubbles     — rising soap bubbles
 *   petals      — drifting cherry-blossom petals
 *   embers      — rising glowing dots
 *   stars       — slow drifting star pattern
 */

import type { TripEffect } from "@shared/types";

const N_PARTICLES = 18;

export default function EffectOverlay({ effect }: { effect: TripEffect | null | undefined }) {
  if (!effect) return null;

  const variants: Record<TripEffect, EffectVariant> = {
    sparkles:   { char: "✦",  size: "0.9rem", color: "#F3C96A", anim: "rally-drift",    extraClass: "" },
    confetti:   { char: "■",  size: "0.7rem", color: "#FF6A45", anim: "rally-fall",     extraClass: "rally-confetti-spin" },
    hearts:     { char: "❤",  size: "1rem",   color: "#FF459F", anim: "rally-rise",     extraClass: "" },
    snowflakes: { char: "❄",  size: "1rem",   color: "#E8EEF5", anim: "rally-fall",     extraClass: "" },
    bubbles:    { char: "○",  size: "1.1rem", color: "#9FE8FF", anim: "rally-rise",     extraClass: "" },
    petals:     { char: "✿",  size: "1rem",   color: "#FFD5E5", anim: "rally-drift",    extraClass: "" },
    embers:     { char: "•",  size: "0.6rem", color: "#FF8C4B", anim: "rally-ember",    extraClass: "" },
    stars:      { char: "★",  size: "0.7rem", color: "#F3C96A", anim: "rally-twinkle",  extraClass: "" },
  };
  const v = variants[effect];

  // Stable random-looking values seeded by the index — keeps SSR/
  // hydration consistent without importing a seeded-RNG library.
  const particles = Array.from({ length: N_PARTICLES }, (_, i) => {
    const leftPct  = (i * 137) % 100;
    const delay    = (i * 0.43) % (effect === "embers" ? 4 : 8);
    const duration = (effect === "embers" ? 3 : 8) + ((i * 0.71) % 6);
    const opacity  = 0.5 + ((i * 0.11) % 0.5);
    const size     = parseFloat(v.size) * (0.6 + ((i * 0.13) % 0.8));
    return { leftPct, delay, duration, opacity, size, i };
  });

  return (
    <div
      aria-hidden
      className="fixed inset-0 pointer-events-none z-30 overflow-hidden"
    >
      {particles.map((p) => (
        <span
          key={p.i}
          className={"absolute select-none " + v.extraClass}
          style={{
            left:                    `${p.leftPct}%`,
            top:                     `-10%`,
            fontSize:                `${p.size}rem`,
            color:                   v.color,
            opacity:                 p.opacity,
            animationName:           v.anim,
            animationDuration:       `${p.duration}s`,
            animationTimingFunction: "linear",
            animationIterationCount: "infinite",
            animationDelay:          `${p.delay}s`,
            textShadow:              effect === "sparkles" || effect === "stars" || effect === "embers"
              ? `0 0 8px ${v.color}`
              : undefined,
          }}
        >
          {v.char}
        </span>
      ))}
      <style>{`
        @keyframes rally-fall {
          0%   { transform: translate3d(0,  -10vh, 0) rotate(0deg); }
          100% { transform: translate3d(0, 110vh, 0) rotate(360deg); }
        }
        @keyframes rally-rise {
          0%   { transform: translate3d(0,  110vh, 0) scale(0.8); opacity: 0; }
          15%  { opacity: 1; }
          100% { transform: translate3d(0,  -10vh, 0) scale(1.2); opacity: 0; }
        }
        @keyframes rally-drift {
          0%   { transform: translate3d(0,  -10vh, 0); }
          100% { transform: translate3d(8vw, 110vh, 0); }
        }
        @keyframes rally-ember {
          0%   { transform: translate3d(0,  100vh, 0) scale(0.6); opacity: 0; }
          10%  { opacity: 1; }
          100% { transform: translate3d(-4vw, -10vh, 0) scale(1.2); opacity: 0; }
        }
        @keyframes rally-twinkle {
          0%, 100% { opacity: 0.2; transform: scale(0.7); }
          50%      { opacity: 1;   transform: scale(1.2); }
        }
        .rally-confetti-spin { display: inline-block; }
      `}</style>
    </div>
  );
}

interface EffectVariant {
  char: string;
  size: string;
  color: string;
  anim: string;
  extraClass: string;
}

/** Category label for the effect picker. */
export const EFFECT_CATALOG: {
  value: TripEffect;
  label: string;
  emoji: string;
  category: "fun" | "classic" | "seasonal";
}[] = [
  { value: "sparkles",   label: "Sparkles",   emoji: "✨", category: "fun"      },
  { value: "confetti",   label: "Confetti",   emoji: "🎉", category: "fun"      },
  { value: "hearts",     label: "Hearts",     emoji: "❤️", category: "fun"      },
  { value: "bubbles",    label: "Bubbles",    emoji: "🫧", category: "fun"      },
  { value: "stars",      label: "Starfield",  emoji: "⭐", category: "classic"  },
  { value: "embers",     label: "Embers",     emoji: "🔥", category: "classic"  },
  { value: "petals",     label: "Petals",     emoji: "🌸", category: "seasonal" },
  { value: "snowflakes", label: "Snowfall",   emoji: "❄️", category: "seasonal" },
];
```

---

# 4. `web/app/trips/[id]/style-picker.tsx`

```tsx
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

import { useEffect, useState } from "react";
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
  const collapsedKey = `rally.stylepicker.collapsed.${tripId}`;
  const [collapsedMobile, setCollapsedMobile] = useState<boolean>(true);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(collapsedKey);
      if (stored === "0") setCollapsedMobile(false);
      else if (stored === "1") setCollapsedMobile(true);
    } catch { /* ignore */ }
  }, [collapsedKey]);

  function toggleCollapsed() {
    setCollapsedMobile((prev) => {
      const next = !prev;
      try { localStorage.setItem(collapsedKey, next ? "1" : "0"); } catch { /* ignore */ }
      if (next) setOpen(null);
      return next;
    });
  }

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
      {/* Mobile collapsed: single floating 🎨 tab. */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label="Open theme + effect picker"
        className={
          "fixed right-3 top-1/2 -translate-y-1/2 z-30 h-11 w-11 rounded-full bg-cream/95 backdrop-blur-sm shadow-lg border border-line items-center justify-center text-lg active:scale-95 transition-transform " +
          (collapsedMobile ? "inline-flex sm:hidden" : "hidden")
        }
      >
        🎨
      </button>

      {/* Mobile expanded + sm+: full rail. */}
      <div
        className={
          "fixed right-3 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2 bg-cream/95 backdrop-blur-sm rounded-2xl shadow-lg border border-line p-2 " +
          (collapsedMobile ? "hidden sm:flex" : "flex")
        }
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Collapse picker"
          className="sm:hidden h-7 w-9 rounded-lg hover:bg-line/40 text-xs text-muted self-end -mb-1"
        >
          ✕
        </button>
        <RailButton label="Theme"  emoji="🎨" active={open === "theme"}  onClick={() => setOpen(open === "theme"  ? null : "theme")} />
        <RailButton label="Effect" emoji="✨" active={open === "effect"} onClick={() => setOpen(open === "effect" ? null : "effect")} />
      </div>

      {open === "theme"  && <ThemePanel  currentTheme={currentTheme}   onPick={(t) => patch({ theme: t  })} onClose={() => setOpen(null)} />}
      {open === "effect" && <EffectPanel currentEffect={currentEffect} onPick={(e) => patch({ effect: e })} onClose={() => setOpen(null)} />}
    </>
  );
}

function RailButton({ label, emoji, active, onClick }: { label: string; emoji: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-colors " +
        (active ? "bg-green text-cream" : "bg-card text-ink hover:bg-green-soft")
      }
    >
      <span className="text-2xl leading-none" aria-hidden>{emoji}</span>
      <span className="text-[10px] mt-1 font-semibold">{label}</span>
    </button>
  );
}

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
        <FilterChip label="All" emoji="✦" active={filter === "all"} onClick={() => setFilter("all")} />
        {THEME_CATEGORIES.map((c) => (
          <FilterChip key={c.value} label={c.label} emoji={c.emoji} active={filter === c.value} onClick={() => setFilter(c.value)} />
        ))}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
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
        <button
          type="button"
          onClick={() => onPick(null)}
          className="flex flex-col items-center gap-1 group"
          title="No effect"
        >
          <span className={
            "w-16 h-16 rounded-full overflow-hidden border-2 bg-cream-2 flex items-center justify-center transition-transform group-hover:scale-105 " +
            (currentEffect == null ? "border-ink" : "border-transparent")
          }>
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

function PanelShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close picker"
        className="absolute inset-0 bg-ink/30 backdrop-blur-sm pointer-events-auto animate-fade-in"
      />
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

function FilterChip({ label, emoji, active, onClick }: { label: string; emoji: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "h-9 px-3 rounded-full text-sm font-semibold transition-colors flex items-center gap-1.5 " +
        (active ? "bg-ink text-cream" : "bg-card text-ink border border-line hover:border-green-soft")
      }
    >
      <span aria-hidden>{emoji}</span>
      {label}
    </button>
  );
}
```

---

# 5. `web/app/api/trips/route.ts` (POST excerpt — theme validation)

```ts
import { ALLOWED_THEMES } from "@/lib/themes";
import type { TripTheme } from "@shared/types";

// Inside POST handler:
const theme = strOrNull(body.theme) as TripTheme | null;
if (theme && !ALLOWED_THEMES.has(theme)) return jsonErr(400, "invalid_theme");
```

---

# 6. `web/app/api/trips/[id]/route.ts` (PATCH excerpt — both validations)

```ts
import { ALLOWED_THEMES } from "@/lib/themes";
import type { TripTheme, TripEffect } from "@shared/types";

const ALLOWED_EFFECTS: ReadonlySet<TripEffect> = new Set([
  "sparkles", "confetti", "hearts", "snowflakes",
  "bubbles", "petals", "embers", "stars",
]);

// Inside PATCH handler:
if ("theme" in body) {
  const t = strOrNull(body.theme) as TripTheme | null;
  if (t && !ALLOWED_THEMES.has(t)) return jsonErr(400, "invalid_theme");
  patch.theme = t;
}
if ("effect" in body) {
  const e = strOrNull(body.effect) as TripEffect | null;
  if (e && !ALLOWED_EFFECTS.has(e)) return jsonErr(400, "invalid_effect");
  patch.effect = e;
}
```

---

# 7. `web/app/globals.css` (design tokens — referenced by every theme)

```css
@import "tailwindcss";

@theme {
  /* Surfaces — cream-leaning, layered */
  --color-cream:        #FBF7EF;
  --color-cream-2:      #F4ECDF;
  --color-cream-warm:   #EFE3D0;
  --color-card:         #FFFCF6;
  --color-line:         #D9CCB6;

  /* Primary — green anchor */
  --color-green:        #0F3F2E;
  --color-green-2:      #174F3C;
  --color-green-soft:   #DFE8D2;

  /* Text */
  --color-ink:          #163026;
  --color-muted:        #5F685F;

  /* Controlled accent */
  --color-gold:         #F3C96A;

  /* Semantic */
  --color-success:      #1D9E75;
  --color-warning:      #F3C96A;
  --color-error:        #C13515;
  --color-destructive:  #9A3F23;

  /* RETIRED — coral, do not use in new themes */
  --color-orange:       #D85A30;

  /* Shadows — warm-tinted */
  --shadow-sm: 0 3px 8px  rgba(58, 45, 20, 0.06);
  --shadow-md: 0 6px 16px rgba(58, 45, 20, 0.09);
  --shadow-lg: 0 18px 40px rgba(58, 45, 20, 0.14);

  /* Fonts */
  --font-display: "Fredoka One", "Fredoka", ui-sans-serif, system-ui, sans-serif;
  --font-body:    "Fredoka",     ui-sans-serif, system-ui, sans-serif;
}

@import url("https://fonts.googleapis.com/css2?family=Fredoka+One&family=Fredoka:wght@400;500;600;700&display=swap");

html, body {
  background-color: var(--color-cream);
  color: var(--color-ink);
  font-family: var(--font-body);
  font-weight: 600;
  font-synthesis: none;
}
```

---

# Brand rules a downstream agent should respect

- **Never reintroduce coral** (`--color-orange`) into any new theme. It was retired 2026-04-25; the token is a compile-shim only.
- **Green is the brand anchor.** New themes should keep some green-family or warm-cream presence unless they're explicitly a dark/seasonal departure.
- **Gold is the only allowed warm accent.** Coral/peach/pink can appear as cover gradients on seasonal themes (e.g., Spring uses pink mid-stop) but not as primary text/border color.
- **Surfaces always warm-tinted.** Even dark themes lean toward warm darks (forest green, midnight blue with gold accent) rather than neutral gray-black.
- **Eyebrows must declare a font-family.** Every existing theme either has `font-display`, `font-display italic`, or `font-mono` on its eyebrow — never bare. Otherwise the brand drifts.
- **Effects must work CSS-only.** No canvas, no JS animation loops. Particles are absolutely-positioned spans with `@keyframes`. SSR-safe.
- **Mobile dev defaults: collapsed picker rail.** Don't add new picker UI that assumes lots of horizontal space.

# Ideas a downstream agent might explore

- **Themes**: tropical (palm/teal/coconut), arctic (icy blue + silver), desert (terracotta + sage), retro-postcard (sepia + halftone), galactic (deep purple + nebula gradient), monochrome (high-contrast grayscale with one signature color), watercolor (washy gradients), brutalist (sharp borders, mono, high-contrast).
- **Effects**: leaves drifting (autumn-locked), fireflies (rising glowing dots that fade in/out), rain (vertical lines), shooting stars (diagonal streaks), record-spinner (slowly rotating disc in a corner), neon-flicker (existing neon theme with flicker overlay).
- **Cohesive theme+effect bundles** ("Tropical" theme + "Bubbles" effect pre-paired as a "Beach trip" preset).
