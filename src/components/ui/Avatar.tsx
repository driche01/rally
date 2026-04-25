import React from 'react';
import { Image, Text, View } from 'react-native';
import { T } from '@/theme';

/**
 * <Avatar> — circular profile element.
 *
 * Two render modes:
 *   - `imageUri` provided: renders the image cropped to a circle
 *   - `name` provided (no image): renders a colored circle with the first
 *     letter (uppercased). Background tint is deterministic per name so
 *     the same person always gets the same color.
 *
 * Sizes follow a 4-step scale for predictability across the app.
 */
type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

interface AvatarProps {
  /** If supplied, renders the image. */
  imageUri?: string | null;
  /** Used for the initial fallback + deterministic color. */
  name?: string | null;
  size?: AvatarSize;
  /** Optional style overrides (e.g. negative margin for stacked avatars). */
  style?: object;
}

const SIZE_PX: Record<AvatarSize, number> = {
  xs: 22,
  sm: 28,
  md: 36,
  lg: 48,
};

const FONT_SIZE: Record<AvatarSize, number> = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 18,
};

// Brand-coherent tint palette for initial fallbacks. Sticks to green-soft,
// gold/40, cream-warm so avatars never break the brand. Deterministic
// per-name selection keeps the same person's color stable across renders.
const TINTS = [
  { bg: T.greenSoft, fg: T.greenDark },
  { bg: '#F4E5BD',   fg: '#7C5A0A' },  // gold-tinted
  { bg: T.creamWarm, fg: T.ink },
  { bg: '#DDE8D8',   fg: T.greenDark }, // sage variant
  { bg: '#F2E5D8',   fg: '#7A4C1E' },   // earth variant
];

function tintFor(name: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return TINTS[Math.abs(hash) % TINTS.length];
}

export function Avatar({ imageUri, name, size = 'md', style }: AvatarProps) {
  const px = SIZE_PX[size];
  const fontSize = FONT_SIZE[size];
  const baseStyle = {
    width: px,
    height: px,
    borderRadius: px / 2,
    overflow: 'hidden' as const,
  };

  if (imageUri) {
    return (
      <View style={[baseStyle, style]}>
        <Image source={{ uri: imageUri }} style={{ width: px, height: px }} />
      </View>
    );
  }

  const initial = (name?.trim() || '?').slice(0, 1).toUpperCase();
  const tint = tintFor(name?.trim() || '?');
  return (
    <View
      style={[
        baseStyle,
        {
          backgroundColor: tint.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text style={{ color: tint.fg, fontSize, fontWeight: '700' }}>{initial}</Text>
    </View>
  );
}
