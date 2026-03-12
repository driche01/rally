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

const variantClasses: Record<Variant, { container: string; text: string }> = {
  primary: {
    container: 'bg-coral-500 active:bg-coral-600',
    text: 'text-white font-semibold',
  },
  secondary: {
    container: 'bg-white border border-neutral-200 active:bg-neutral-50',
    text: 'text-neutral-800 font-medium',
  },
  ghost: {
    container: 'bg-transparent active:bg-neutral-100',
    text: 'text-coral-500 font-medium',
  },
  destructive: {
    container: 'bg-red-500 active:bg-red-600',
    text: 'text-white font-semibold',
  },
};

const sizeClasses: Record<Size, { container: string; text: string }> = {
  sm: { container: 'px-4 py-2 rounded-xl min-h-[36px]', text: 'text-sm' },
  md: { container: 'px-6 py-3 rounded-2xl min-h-[48px]', text: 'text-base' },
  lg: { container: 'px-8 py-4 rounded-2xl min-h-[56px]', text: 'text-lg' },
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
        <ActivityIndicator
          size="small"
          color={variant === 'primary' || variant === 'destructive' ? '#fff' : '#FF6B5B'}
        />
      ) : (
        <Text className={[v.text, s.text].join(' ')}>{children}</Text>
      )}
    </Pressable>
  );
}
