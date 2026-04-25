import { Platform } from 'react-native';

export { colors, T } from './colors';
export type { BrandToken, ColorKey } from './colors';

/**
 * Display font for headlines and hero copy (2026-04-24 brand update).
 * System Georgia on iOS/macOS/web; falls back to platform serif on Android.
 * No font-loader needed — these are system fonts.
 */
export const headlineFont = {
  regular: { fontFamily: Platform.OS === 'android' ? 'serif' : 'Georgia' } as const,
  bold:    { fontFamily: Platform.OS === 'android' ? 'serif' : 'Georgia', fontWeight: '700' as const },
};

/**
 * @deprecated Use `headlineFont` instead. SpaceGrotesk display font is
 * being phased out in favor of editorial Georgia per the 2026-04 brand
 * direction. Existing usages will be swept; do not introduce new ones.
 */
export const displayFont = {
  semiBold: { fontFamily: 'SpaceGrotesk_600SemiBold' } as const,
  bold:     { fontFamily: 'SpaceGrotesk_700Bold' } as const,
};

export const spacing = {
  xs:   4,
  sm:   8,
  md:   16,
  lg:   24,
  xl:   32,
  '2xl': 48,
  '3xl': 64,
} as const;

/** Border radii — aligned with brand spec. */
export const radius = {
  sm:   8,
  md:   12,
  lg:   18,
  xl:   28,
  full: 9999,
} as const;

/**
 * Shadows — warm-tinted to blend with the cream brand surface.
 * Cool/neutral shadows on a warm palette read as "off." The brown-tinted
 * shadow color (#3A2D14) complements cream/card without darkening to gray.
 *
 * Opacities tuned for visibility on warm bg:
 *   sm  ~6%  — inputs, small lifted elements
 *   md  ~9%  — cards, modals, sheets
 *   lg ~14%  — overlays, big floating CTAs
 */
export const shadow = {
  sm: {
    shadowColor:   '#3A2D14',
    shadowOffset:  { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius:  8,
    elevation:     2,
  },
  md: {
    shadowColor:   '#3A2D14',
    shadowOffset:  { width: 0, height: 6 },
    shadowOpacity: 0.09,
    shadowRadius:  16,
    elevation:     4,
  },
  lg: {
    shadowColor:   '#3A2D14',
    shadowOffset:  { width: 0, height: 18 },
    shadowOpacity: 0.14,
    shadowRadius:  40,
    elevation:     8,
  },
} as const;
