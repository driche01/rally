import React from 'react';
import { ActivityIndicator } from 'react-native';
import { T } from '@/theme';

/**
 * <Spinner> — branded ActivityIndicator wrapper.
 *
 * Replaces inline `<ActivityIndicator size="small" color="#0F3F2E" />`
 * (or worse, hardcoded coral / blue / gray colors) scattered across the
 * app. Default color is the brand green; override via `tone="muted"` for
 * indicators on muted surfaces, or `tone="onPrimary"` for white spinner
 * on a green button background.
 */
type SpinnerTone = 'brand' | 'muted' | 'onPrimary';

const COLOR: Record<SpinnerTone, string> = {
  brand:     T.green,
  muted:     T.muted,
  onPrimary: T.white,
};

interface SpinnerProps {
  size?: 'small' | 'large';
  tone?: SpinnerTone;
}

export function Spinner({ size = 'small', tone = 'brand' }: SpinnerProps) {
  return <ActivityIndicator size={size} color={COLOR[tone]} />;
}
