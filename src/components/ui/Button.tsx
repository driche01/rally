import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  type PressableProps,
} from 'react-native';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends PressableProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: React.ReactNode;
  fullWidth?: boolean;
}

// 2026-04-24 brand palette:
//   primary    → deep green
//   secondary  → warm card surface with a hairline border
//   ghost      → text-only green
//   destructive→ semantic error
const variantClasses: Record<Variant, { container: string; text: string }> = {
  primary: {
    container: 'bg-green active:bg-green-dark',
    text: 'text-white font-semibold',
  },
  secondary: {
    container: 'bg-card border border-line active:bg-cream-warm',
    text: 'text-ink font-medium',
  },
  ghost: {
    container: 'bg-transparent active:bg-green-soft',
    text: 'text-green font-medium',
  },
  destructive: {
    container: 'bg-red-500 active:bg-red-600',
    text: 'text-white font-semibold',
  },
};

const sizeClasses: Record<Size, { container: string; text: string }> = {
  sm: { container: 'px-4 py-2 rounded-md min-h-[36px]', text: 'text-sm' },
  md: { container: 'px-6 py-3 rounded-md min-h-[48px]', text: 'text-base' },
  lg: { container: 'px-8 py-4 rounded-lg min-h-[56px]', text: 'text-lg' },
};

const SPINNER_COLOR: Record<Variant, string> = {
  primary:     '#FFFFFF',
  secondary:   '#0F3F2E', // green
  ghost:       '#0F3F2E',
  destructive: '#FFFFFF',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  children,
  fullWidth = false,
  disabled,
  className,
  ...props
}: ButtonProps & { className?: string }) {
  const isDisabled = disabled || loading;
  const v = variantClasses[variant];
  const s = sizeClasses[size];

  return (
    <Pressable
      className={[
        'flex-row items-center justify-center',
        v.container,
        s.container,
        fullWidth ? 'w-full' : 'self-start',
        isDisabled ? 'opacity-50' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={isDisabled}
      accessible
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={SPINNER_COLOR[variant]} />
      ) : (
        <Text className={[v.text, s.text].join(' ')}>{children}</Text>
      )}
    </Pressable>
  );
}
