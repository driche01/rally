import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/theme';

/**
 * <FilterChip> — the icon + label + optional menu chevron pattern that
 * sits above filterable lists (Activity log, Decision queue, etc.).
 *
 * Distinct from <Pill> (status tag / segmented toggle): a FilterChip
 * implies a menu opens on tap — `Date: All time ▾`, `Member: Alex ▾` —
 * and goes "active" when the user has narrowed away from the default.
 *
 * Responsive contract — three guarantees that make filter bars survive
 * narrow phones:
 *
 *   1. `flexShrink: 1` by default so the chip absorbs squeeze in a
 *      crowded row instead of pushing siblings off-screen.
 *   2. `numberOfLines={1}` + `ellipsizeMode="tail"` on the label so a
 *      long member name truncates cleanly instead of expanding the row.
 *   3. Icon-only mode (when `label` is omitted) collapses to a ~36pt
 *      tap target — the right shape for binary toggles like sort
 *      direction. Set `accessibilityLabel` so screen readers still
 *      announce intent.
 *
 * Active state uses the brand green-soft surface + green border, same
 * as the chip pattern that already exists across the app — this is a
 * drop-in replacement for the inline `FilterChip` defined per-screen.
 */
export interface FilterChipProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** Omit to render an icon-only button (binary toggles like sort). */
  label?: string;
  /** True when the user has narrowed away from the chip's default. */
  active?: boolean;
  /** Drop the right-side chevron — set for binary toggles where there's
   *  no menu to open and the chevron would mislead. Forced true in
   *  icon-only mode. */
  hideTrailingChevron?: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** Required when the label is omitted (icon-only). Ignored otherwise
   *  — the visible label already serves as the a11y label. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function FilterChip({
  icon,
  label,
  active = false,
  hideTrailingChevron,
  disabled,
  onPress,
  accessibilityLabel,
  style,
}: FilterChipProps) {
  const iconOnly = !label;
  const iconColor = active ? T.green : T.muted;
  const a11yLabel = accessibilityLabel ?? label ?? '';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.chip,
        iconOnly && styles.chipIconOnly,
        active && styles.chipActive,
        disabled && styles.chipDisabled,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={6}
    >
      <Ionicons name={icon} size={iconOnly ? 16 : 13} color={iconColor} />
      {label ? (
        <Text
          style={[styles.chipText, active && styles.chipTextActive]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
      ) : null}
      {label && !hideTrailingChevron ? (
        <Ionicons
          name="chevron-down"
          size={11}
          color={active ? T.green : T.muted}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.line,
    flexShrink: 1,
  },
  chipIconOnly: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexShrink: 0,
  },
  chipActive: {
    backgroundColor: T.greenSoft,
    borderColor: T.green,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    fontSize: 14,
    color: T.muted,
    fontWeight: '600',
    flexShrink: 1,
  },
  chipTextActive: {
    color: T.green,
  },
});
