import React from 'react';
import { Text, View } from 'react-native';

type BadgeVariant = 'default' | 'success' | 'warning' | 'coral' | 'muted';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, { container: string; text: string }> = {
  default: { container: 'bg-cream-warm', text: 'text-ink' },
  success: { container: 'bg-teal-50', text: 'text-teal-700' },
  warning: { container: 'bg-amber-50', text: 'text-amber-700' },
  coral: { container: 'bg-green-soft', text: 'text-green-dark' },
  muted: { container: 'bg-cream', text: 'text-muted' },
};

export function Badge({ children, variant = 'default' }: BadgeProps) {
  const v = variantClasses[variant];
  return (
    <View className={`rounded-full px-3 py-1 ${v.container}`}>
      <Text className={`text-xs font-medium ${v.text}`}>{children}</Text>
    </View>
  );
}
