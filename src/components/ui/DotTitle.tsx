/**
 * DotTitle — section / screen title rendered in the Rally wordmark format:
 * green dot + uppercase Georgia bold + letterspacing. Mirrors `BrandMark`
 * but takes a custom label, so screen headers like "Itinerary", "Lodging",
 * "Travel", "Expenses" share the brand's visual identity without each
 * shipping their own one-off styling.
 *
 * Use this for top-of-screen / top-of-section titles. For the actual brand
 * mark itself, keep using <BrandMark>.
 */
import { Text, View } from 'react-native';
import { T, headlineFont } from '@/theme';

export type DotTitleSize = 'sm' | 'md' | 'lg';

interface DotTitleProps {
  label: string;
  size?: DotTitleSize;
}

const SIZE_MAP: Record<DotTitleSize, { dot: number; font: number; gap: number; letterSpacing: number }> = {
  sm: { dot: 7,  font: 14, gap: 5, letterSpacing: 0.8 },
  md: { dot: 9,  font: 18, gap: 6, letterSpacing: 1 },
  lg: { dot: 11, font: 22, gap: 7, letterSpacing: 1.2 },
};

export function DotTitle({ label, size = 'md' }: DotTitleProps) {
  const { dot, font, gap, letterSpacing } = SIZE_MAP[size];

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap }}
      accessibilityRole="header"
      accessibilityLabel={label}
    >
      <View
        style={{
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: T.green,
        }}
      />
      <Text
        style={{
          ...headlineFont.bold,
          fontSize: font,
          color: T.green,
          letterSpacing,
        }}
      >
        {label.toUpperCase()}
      </Text>
    </View>
  );
}
