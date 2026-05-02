/**
 * BrandMark — the canonical Rally wordmark: green dot + uppercase Georgia
 * "RALLY" with letterspacing. Use this anywhere the brand identifies
 * itself (auth screens, app headers, the respond/[tripId] entry pages).
 *
 * NEVER render the wordmark as a raw <Text>rally</Text> — that lowercase
 * form is being phased out. Drift between screens is exactly what this
 * component prevents.
 *
 * Variants:
 *   green (default) — for cream / light backgrounds
 *   white           — for photo / dark backgrounds; the photo on the home
 *                     screen is muted enough that the wordmark reads
 *                     without a text shadow. If a brighter background
 *                     ever needs help, layer a shadow at the call site.
 *
 * Sizes (dot diameter / fontSize):
 *   sm  →  8 / 16   — tight headers, navigation bars
 *   md  → 10 / 20   — auth screens (default)
 *   lg  → 14 / 28   — full-screen entry points (respond pages, home hero)
 */
import { Text, View } from 'react-native';
import { T, headlineFont } from '@/theme';

export type BrandMarkSize = 'sm' | 'md' | 'lg';
export type BrandMarkVariant = 'green' | 'white';

interface BrandMarkProps {
  size?: BrandMarkSize;
  variant?: BrandMarkVariant;
}

const SIZE_MAP: Record<BrandMarkSize, { dot: number; font: number; gap: number }> = {
  sm: { dot: 8,  font: 16, gap: 5 },
  md: { dot: 10, font: 20, gap: 6 },
  lg: { dot: 14, font: 28, gap: 8 },
};

export function BrandMark({ size = 'md', variant = 'green' }: BrandMarkProps) {
  const { dot, font, gap } = SIZE_MAP[size];
  const color = variant === 'white' ? '#FFFFFF' : T.green;

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap }}
      accessibilityRole="header"
      accessibilityLabel="Rally"
    >
      <View
        style={{
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: color,
        }}
      />
      <Text
        style={{
          ...headlineFont.bold,
          fontSize: font,
          color,
          letterSpacing: 1,
        }}
      >
        RALLY
      </Text>
    </View>
  );
}
