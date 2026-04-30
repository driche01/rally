/**
 * FormSectionHeader — small-caps numbered header used to chunk the
 * trip-creation and trip-edit forms into three scannable sections.
 *
 * Renders a hairline divider above the header (skip with `first`) and
 * a tightly-tracked uppercase label. Visual chrome is intentionally
 * minimal — the goal is to give the eye landmarks without slowing the
 * planner down.
 *
 * Use a single `gap-10` on the parent View + a `gap-6` inside each
 * section's content block to create the rhythm.
 */
import React from 'react';
import { Text, View } from 'react-native';

interface Props {
  /** Two-digit step number, e.g. "01". */
  step: string;
  /** Section title. Will be rendered uppercase by the styling. */
  title: string;
  /** True for the first section in the form — suppresses the divider. */
  first?: boolean;
}

export function FormSectionHeader({ step, title, first }: Props) {
  return (
    <View
      style={{
        marginBottom: 6,
        ...(first
          ? null
          : {
              borderTopWidth: 1.5,
              borderTopColor: '#0F3F2E',
              paddingTop: 24,
              marginTop: 6,
            }),
      }}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: '600',
          color: '#737373',
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}
      >
        {step} — {title}
      </Text>
    </View>
  );
}
