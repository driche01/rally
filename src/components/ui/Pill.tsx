import React from 'react';
import { Pressable, Text, type PressableProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/theme';

/**
 * <Pill> — small chip-shaped element. Two roles:
 *
 *   1. Static (no `onPress`): a status/category tag. Like <Badge>, but
 *      pill-shaped (rounded-full) with optional icon.
 *   2. Interactive (with `onPress` and optional `selected`): a toggle/
 *      filter/segmented option. The "Activity / Meal / Travel" type
 *      selector in the Add-block sheet, the "1 day / 2 days / 3 days"
 *      duration chips, etc.
 *
 * Variants:
 *   default  → cream-warm bg + ink text (inactive interactive)
 *   selected → green bg + white text (active interactive)
 *   subtle   → cream bg + muted text (status tag)
 *   accent   → green-soft bg + green-dark text (highlight)
 *   gold     → gold/40 bg + ink text (warning/voted)
 *
 * Selected state: pass `selected={true}` and the variant flips to the
 * selected style automatically (no need to compute it at the call site).
 */
type PillVariant = 'default' | 'selected' | 'subtle' | 'accent' | 'gold';

interface PillProps extends Omit<PressableProps, 'children'> {
  children: React.ReactNode;
  variant?: PillVariant;
  /** When true, overrides variant with the "selected" style. */
  selected?: boolean;
  /** Optional Ionicons name to render before the label. */
  leadingIcon?: React.ComponentProps<typeof Ionicons>['name'];
  size?: 'sm' | 'md';
}

const variantClasses: Record<PillVariant, { container: string; text: string }> = {
  default:  { container: 'bg-cream-warm border border-line', text: 'text-ink' },
  selected: { container: 'bg-green border border-green',     text: 'text-white' },
  subtle:   { container: 'bg-cream border border-line',      text: 'text-muted' },
  accent:   { container: 'bg-green-soft border border-green',text: 'text-green-dark' },
  gold:     { container: 'bg-gold/40 border border-gold/40', text: 'text-ink' },
};

const sizeClasses: Record<'sm' | 'md', { container: string; text: string; iconSize: number }> = {
  sm: { container: 'px-2.5 py-1 rounded-full',   text: 'text-xs font-medium',  iconSize: 12 },
  md: { container: 'px-4 py-2 rounded-full',     text: 'text-sm font-medium',  iconSize: 14 },
};

const ICON_COLOR: Record<PillVariant, string> = {
  default:  T.ink,
  selected: T.white,
  subtle:   T.muted,
  accent:   T.green,
  gold:     T.ink,
};

export function Pill({
  children,
  variant = 'default',
  selected = false,
  leadingIcon,
  size = 'md',
  onPress,
  ...rest
}: PillProps) {
  const effective: PillVariant = selected ? 'selected' : variant;
  const v = variantClasses[effective];
  const s = sizeClasses[size];
  const iconColor = ICON_COLOR[effective];

  const content = (
    <>
      {leadingIcon ? (
        <Ionicons
          name={leadingIcon}
          size={s.iconSize}
          color={iconColor}
          style={{ marginRight: 4 }}
        />
      ) : null}
      <Text className={`${v.text} ${s.text}`}>{children}</Text>
    </>
  );

  // Static (no onPress) — render as View-like Pressable that ignores taps
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className={`flex-row items-center justify-center ${v.container} ${s.container}`}
      accessible
      accessibilityRole={onPress ? 'button' : undefined}
      {...rest}
    >
      {content}
    </Pressable>
  );
}
