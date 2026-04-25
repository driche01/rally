import React from 'react';
import { Text, View } from 'react-native';

type BadgeVariant = 'default' | 'success' | 'warning' | 'coral' | 'muted';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
}

// Brand semantics (updated 2026-04-25 — coral retired):
//   default = neutral / closed states     → cream-warm fill, ink text
//   success = active / live states        → green-soft fill, green-dark text
//   warning = attention                   → gold-tinted fill, ink text
//   coral   = celebratory / decided       → gold-tinted fill, ink text
//                                            (legacy variant name kept for
//                                             callers; visually = warning)
//   muted   = inactive / draft            → cream fill, muted text
const variantClasses: Record<BadgeVariant, { container: string; text: string }> = {
  default: { container: 'bg-cream-warm',   text: 'text-ink' },
  success: { container: 'bg-green-soft',   text: 'text-green-dark' },
  warning: { container: 'bg-gold/40',      text: 'text-ink' },
  coral:   { container: 'bg-gold/40',     text: 'text-ink' },
  muted:   { container: 'bg-cream',        text: 'text-muted' },
};

export function Badge({ children, variant = 'default' }: BadgeProps) {
  const v = variantClasses[variant];
  return (
    <View className={`rounded-full px-3 py-1 ${v.container}`}>
      <Text className={`text-xs font-medium ${v.text}`}>{children}</Text>
    </View>
  );
}
