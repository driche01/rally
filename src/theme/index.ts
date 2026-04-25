import { Platform } from 'react-native';

export { colors } from './colors';

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

/** Shadows — kept light per brand direction. No heavy drops. */
export const shadow = {
  sm: {
    shadowColor:   '#111111',
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius:  8,
    elevation:     1,
  },
  md: {
    shadowColor:   '#111111',
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius:  24,
    elevation:     3,
  },
  lg: {
    shadowColor:   '#111111',
    shadowOffset:  { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius:  48,
    elevation:     6,
  },
} as const;
