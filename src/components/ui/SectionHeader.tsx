import React from 'react';
import { Text, View } from 'react-native';
import { T } from '@/theme';

/**
 * <SectionHeader> — small uppercase label that introduces a section.
 *
 * Replaces the inline pattern repeated across every form:
 *   <Text className="text-xs font-semibold uppercase tracking-wide text-muted">
 *     Title *
 *   </Text>
 *
 * `required` adds a subtle * indicator. `trailing` slot for a right-aligned
 * helper (e.g. character count, "Optional", "Clear" link).
 */
interface SectionHeaderProps {
  children: React.ReactNode;
  required?: boolean;
  trailing?: React.ReactNode;
  /** Tighter top spacing — use when stacking inside a card or sheet body. */
  tight?: boolean;
}

export function SectionHeader({
  children,
  required = false,
  trailing,
  tight = false,
}: SectionHeaderProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: tight ? 0 : 4,
        marginBottom: 8,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: '700',
          color: T.muted,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}
      >
        {children}
        {required ? (
          <Text style={{ color: T.muted }}> *</Text>
        ) : null}
      </Text>
      {trailing ? <View>{trailing}</View> : null}
    </View>
  );
}
