/**
 * <PollSectionHeader> — header row for the standard poll sections in the
 * new-trip and edit-trip forms.
 *
 * Renders the field label on the left, an optional status pill ("Will be
 * polled" / "Locked in" / "Group decides") plus a "Skip" link on the
 * right when the section is enabled, or a single "Off · Re-enable" pill
 * when the planner has skipped this question.
 *
 * Tapping "Skip" / "Re-enable" toggles the section's disabled state.
 * The parent uses that flag to hide the body, drop the poll from the
 * create/update payload, and null out the trip-level field so the survey
 * doesn't render a "decided" poll that the planner explicitly opted out
 * of.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';

const FORM_LABEL_STYLE = { fontSize: 14, fontWeight: '500' as const, color: '#404040' };

export interface PollSectionStatus {
  text: string;
  tone: 'green' | 'muted';
}

interface Props {
  label: string;
  /** Status indicator shown when the section is enabled. Pass null to render only the label. */
  status: PollSectionStatus | null;
  disabled: boolean;
  onToggle: () => void;
  /** Optional trailing slot rendered next to the label (used for the info icon on Spend per person). */
  labelTrailing?: React.ReactNode;
}

export function PollSectionHeader({ label, status, disabled, onToggle, labelTrailing }: Props) {
  return (
    <View className="flex-row items-baseline justify-between">
      {labelTrailing ? (
        <View className="flex-row items-center gap-1.5">
          <Text style={FORM_LABEL_STYLE}>{label}</Text>
          {labelTrailing}
        </View>
      ) : (
        <Text style={FORM_LABEL_STYLE}>{label}</Text>
      )}
      {disabled ? (
        <Pressable
          onPress={onToggle}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Re-enable ${label}`}
        >
          <Text className="text-[11px] font-semibold text-green">Off · Re-enable</Text>
        </Pressable>
      ) : (
        <View className="flex-row items-baseline gap-3">
          {status ? (
            <Text
              className={`text-[11px] font-semibold ${status.tone === 'green' ? 'text-green' : 'text-[#737373]'}`}
            >
              {status.text}
            </Text>
          ) : null}
          <Pressable
            onPress={onToggle}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Skip ${label}`}
          >
            <Text className="text-[11px] font-semibold text-[#A0A0A0]">Skip</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export const SKIPPED_HINT_STYLE = { fontSize: 13, color: '#A0A0A0', fontStyle: 'italic' as const };

/**
 * Map an option-count to the section's status pill. Shared between the
 * new-trip and edit-trip forms so the three states stay consistent.
 *   0 options       → "Group decides"  (write-in poll for the group)
 *   1 option        → "Locked in"      (decided poll / trip primitive set)
 *   2+ options      → "Will be polled" (live poll the group votes on)
 *
 * Pass `decided=true` when the section has been collapsed into a decided
 * trip-level value via a different mechanism — e.g. a date range whose
 * night-count matches the lone duration chip.
 */
export function computePollStatus(filledCount: number, decided = false): PollSectionStatus {
  if (decided) return { text: 'Locked in', tone: 'green' };
  if (filledCount >= 2) return { text: 'Will be polled', tone: 'green' };
  if (filledCount === 1) return { text: 'Locked in', tone: 'green' };
  return { text: 'Group decides', tone: 'muted' };
}
