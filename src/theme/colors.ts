/**
 * Brand color palette (2026-04-24).
 *
 * ★ SINGLE SOURCE OF TRUTH for Rally brand colors. ★
 *
 * If you need a brand color anywhere in the codebase:
 *   1. Inside JSX/styles → use the Tailwind utilities from tailwind.config.js
 *      (`bg-cream`, `text-ink`, `bg-green`, etc.).
 *   2. As an inline style or in non-JSX code (e.g. ActivityIndicator color,
 *      placeholderTextColor, RPC parameters) → `import { T } from '@/theme'`
 *      and reference `T.green`, `T.ink`, etc.
 *   3. As a per-stage / per-type variant map → import from this file and
 *      reference the named tokens (see STAGE_ACCENT in src/lib/tripStage.ts
 *      for the pattern). Never inline raw hex.
 *
 * DO NOT add raw `#XXXXXX` color literals to feature files. They drift.
 * The Tailwind config and this file are the only places hex values live.
 *
 * Voice & rules:
 *  - Green is primary (CTAs, anchors, headlines).
 *  - Cream is the signature background — never pure white.
 *  - Ink is primary text — never pure black.
 *  - Gold is the one allowed warm accent — premium/highlight signals.
 *  - Destructive actions use a warm-rust (#9A3F23) defined in
 *    `src/components/ui/Button.tsx` — NOT pure red, NOT coral.
 *  - NO CORAL anywhere. The legacy `coral` palette below is kept ONLY
 *    so existing class references compile during migration; do not use
 *    `bg-coral-*` / `text-coral-*` in new code, and migrate any you
 *    encounter. Use green/green-soft for action accents, gold for
 *    highlight, warm-rust (via Button destructive variant) for delete.
 *  - No blue. No cool tones.
 *  - Approximate ratio: 70% cream / 25% green / 5% gold accents.
 *
 * Tailwind/NativeWind utilities for these are defined in tailwind.config.js.
 */
export const colors = {
  // ─── Primary ──────────────────────────────────────────────────────────────
  green: {
    DEFAULT: '#0F3F2E',  // primary anchor
    dark:    '#174F3C',  // hover / secondary anchor
    soft:    '#DFE8D2',  // empty states, avatar backgrounds, accent surfaces
  },

  // ─── Backgrounds & surfaces ───────────────────────────────────────────────
  // Layered surface system. ~5–8% luminance step between adjacent layers so
  // each surface is perceivable at a glance against the one below it. Warm
  // palette + low-contrast page demands this — too-close steps wash out.
  cream: {
    DEFAULT: '#FBF7EF',  // page background — lightest
    warm:    '#EFE3D0',  // inactive interactive surfaces (pills, toggles, calendar)
                         //   — ~8% darker than page, clearly differentiated
  },
  card:     '#FFFCF6',   // elevated card surface — near-white with a whisper of warmth
                         //   (clearly whiter than cream page, doesn't read clinical)
  line:     '#D9CCB6',   // hairline borders — visible-but-quiet on cream surfaces

  // ─── Text ─────────────────────────────────────────────────────────────────
  ink:      '#163026',   // primary text — never #000
  muted:    '#5F685F',   // secondary text

  // ─── Accents (controlled use) ─────────────────────────────────────────────
  gold:     '#F3C96A',   // premium signal, badges, subtle emphasis
  /**
   * Coral — RETIRED (2026-04-25). Kept here so legacy `bg-coral-*` /
   * `text-coral-*` class references continue to compile while remaining
   * usages are migrated. Do not introduce new references. Replace with
   * green/green-soft (action accents), gold (highlight), or the
   * warm-rust destructive variant in Button.tsx (delete).
   */
  coral: {
    50:  '#FEF3EE',
    100: '#FCE3D1',
    200: '#F9C4A5',
    300: '#F49D70',
    400: '#ED7040',
    500: '#D85A30',
    600: '#BE4820',
    700: '#9A3918',
    800: '#782B12',
    900: '#551E0C',
  },

  // ─── Legacy neutrals ──────────────────────────────────────────────────────
  // Kept for non-brand-critical surfaces. Prefer cream/card/line/ink/muted
  // when designing new screens.
  neutral: {
    50:  '#FAFAFA',
    100: '#F5F5F5',
    200: '#E8E8E8',
    300: '#D1D1D1',
    400: '#A8A8A8',
    500: '#717171',
    600: '#4A4A4A',
    700: '#3A3A3A',
    800: '#222222',
    900: '#111111',
  },

  // ─── Semantic ─────────────────────────────────────────────────────────────
  success:     '#1D9E75', // shifted toward our green family
  warning:     '#F3C96A', // gold doubles as warning
  error:       '#C13515',

  // ─── Utility ──────────────────────────────────────────────────────────────
  white:       '#FFFFFF',
  black:       '#000000',
  transparent: 'transparent',
} as const;

export type ColorKey = keyof typeof colors;

/**
 * Flat brand-token alias for inline-style code.
 *
 * Prefer the Tailwind utilities (`bg-green`, `text-ink`, etc.) inside JSX.
 * Use `T.*` when you need a literal hex string — RN's
 * `placeholderTextColor`, `ActivityIndicator color`, native splash bg,
 * inline `style={{ color: ... }}` props on Text, per-stage accent maps, etc.
 *
 * Adding a new brand token? Add it here AND in `tailwind.config.js` so
 * both the JS-string form and the Tailwind-class form stay in sync.
 */
export const T = {
  green:        colors.green.DEFAULT,
  greenDark:    colors.green.dark,
  greenSoft:    colors.green.soft,
  cream:        colors.cream.DEFAULT,
  creamWarm:    colors.cream.warm,
  card:         colors.card,
  line:         colors.line,
  ink:          colors.ink,
  muted:        colors.muted,
  gold:         colors.gold,
  coral:        colors.coral[500],   // sparing accent only — see brand rules above
  white:        colors.white,
  error:        colors.error,
} as const;
export type BrandToken = keyof typeof T;
