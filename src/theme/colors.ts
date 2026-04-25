/**
 * Brand color palette (2026-04-24).
 *
 * Voice & rules:
 *  - Green is primary (CTAs, anchors, headlines).
 *  - Cream is the signature background — never pure white.
 *  - Ink is primary text — never pure black.
 *  - Coral is a SPARINGLY-USED accent. Do not use as a primary CTA.
 *  - Gold is for premium/highlight signals.
 *  - No blue. No cool tones.
 *  - Approximate ratio: 70% cream / 20% green / 10% accents.
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
  cream: {
    DEFAULT: '#FBF7EF',  // page background
    warm:    '#F4ECDF',  // section background, slightly warmer
  },
  card:     '#FFFAF2',   // card surface — slight warmth, not pure white
  line:     '#E7DDCF',   // borders, hairlines

  // ─── Text ─────────────────────────────────────────────────────────────────
  ink:      '#163026',   // primary text — never #000
  muted:    '#5F685F',   // secondary text

  // ─── Accents (controlled use) ─────────────────────────────────────────────
  gold:     '#F3C96A',   // premium signal, badges, subtle emphasis
  /**
   * Coral — SPARINGLY-USED accent only. Demoted from prior primary status.
   * Acceptable: small highlights, notification dots, occasional CTA hovers.
   * Forbidden: primary CTAs, page-level accents, large filled surfaces.
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
