import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  type PressableProps,
} from 'react-native';
import { T } from '@/theme';

/**
 * ★ USE THIS COMPONENT FOR EVERY BUTTON IN THE APP ★
 *
 * Don't roll your own <Pressable> with inline padding/colors. Doing so
 * orphans the button from the design system — when the brand updates,
 * you get drift (coral CTAs that should be green, gray "Delete" that
 * should be warm-rust, etc.). The whole point of this component is one
 * place to express button semantics.
 *
 * Variants:
 *   primary      → deep green fill, white text. Default CTA.
 *   secondary    → cream-warm fill, ink text, hairline border. Cancel,
 *                  back, secondary actions in modal sheets.
 *   ghost        → transparent, green text. Inline links / nav actions.
 *   destructive  → cream-warm fill, warm-rust text + border.
 *                  Delete, remove, leave-trip, cancel-RSVP — anything
 *                  that the user can't undo with one tap.
 *
 * Need a primary green delete (e.g. confirmation modal "Delete forever")?
 * Use variant="destructive" with size="lg" — the warm-rust reads as
 * destructive without breaking the cream/green brand by going pure red.
 *
 * Sizes: sm | md (default) | lg.
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

// Brand-coherent destructive — a warm rust that reads "this can't be undone"
// without introducing a cool/clashing red on the warm cream brand.
const DESTRUCTIVE_RUST = '#9A3F23';

interface ButtonProps extends PressableProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: React.ReactNode;
  fullWidth?: boolean;
}

// 2026-04-24 brand palette:
//   primary     → deep green (filled CTA)
//   secondary   → warm card surface with hairline border
//   ghost       → text-only green
//   destructive → cream-warm fill with warm-rust text + border
//                 (NOT pure red — keeps the warm/editorial brand intact)
const variantClasses: Record<Variant, { container: string; text: string; textStyle?: object }> = {
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
    container: 'bg-card active:bg-cream-warm',
    text: 'font-semibold',
    // Inline style — Tailwind doesn't have a brand-rust utility and we
    // don't want to add it (single-use color, not part of T).
    textStyle: { color: DESTRUCTIVE_RUST },
  },
};

const sizeClasses: Record<Size, { container: string; text: string }> = {
  sm: { container: 'px-4 py-2 rounded-md min-h-[36px]', text: 'text-sm' },
  md: { container: 'px-6 py-3 rounded-md min-h-[48px]', text: 'text-base' },
  lg: { container: 'px-8 py-4 rounded-lg min-h-[56px]', text: 'text-lg' },
};

const SPINNER_COLOR: Record<Variant, string> = {
  primary:     T.white,
  secondary:   T.green,
  ghost:       T.green,
  destructive: DESTRUCTIVE_RUST,
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
        <Text className={[v.text, s.text].join(' ')} style={v.textStyle}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}
