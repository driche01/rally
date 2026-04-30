/**
 * CustomPollsSection — free-form poll editor for the trip-card flow.
 *
 * Used by both `app/(app)/trips/new.tsx` and
 * `app/(app)/trips/[id]/edit.tsx`. Default state is a single compact
 * "Anything else for the group?" line + a "+ Custom question" button.
 * Tapping the button adds an empty poll card to fill in. Existing
 * polls (when hydrated from edit.tsx) render as full editable cards
 * above the add button.
 *
 * Each entry uses the shared `CustomPoll` shape from `@/types/polls`.
 *
 * The section is "dumb" — it owns no state. The parent passes the
 * array and a setter; per-row editing happens via produced helpers.
 *
 * Reset warnings (used by edit.tsx) are rendered via the optional
 * `renderResetWarning` render prop — the parent decides which polls
 * have existing votes that an edit would invalidate.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Input, Toggle } from '@/components/ui';
import type { CustomPoll } from '@/types/polls';
import { tapHaptic } from '@/lib/haptics';

const FORM_LABEL_STYLE = { fontSize: 14, fontWeight: '500' as const, color: '#404040' };

const MAX_POLLS = 3;
const MAX_OPTIONS = 6;
const MIN_OPTIONS = 2;

interface Props {
  value: CustomPoll[];
  onChange: (next: CustomPoll[]) => void;
  /**
   * Optional per-poll warning. The parent (edit.tsx) returns a node when
   * the poll has existing votes that an edit would reset. Rendered just
   * below each poll card.
   */
  renderResetWarning?: (poll: CustomPoll) => React.ReactNode;
}

function freshKey(): string {
  return `cp_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function cleanedOptionCount(p: CustomPoll): number {
  return p.options.filter((o) => o.trim().length > 0).length;
}

export function CustomPollsSection({ value, onChange, renderResetWarning }: Props) {
  const atCap = value.length >= MAX_POLLS;

  function addPoll(question = '') {
    if (atCap) return;
    tapHaptic();
    onChange([
      ...value,
      { id: freshKey(), question, options: ['', ''], allowMulti: false },
    ]);
  }

  function removePoll(id: string) {
    onChange(value.filter((p) => p.id !== id));
  }

  function patchPoll(id: string, patch: Partial<CustomPoll>) {
    onChange(value.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function setOption(id: string, idx: number, next: string) {
    const poll = value.find((p) => p.id === id);
    if (!poll) return;
    const opts = [...poll.options];
    opts[idx] = next;
    patchPoll(id, { options: opts });
  }

  function addOption(id: string) {
    const poll = value.find((p) => p.id === id);
    if (!poll || poll.options.length >= MAX_OPTIONS) return;
    patchPoll(id, { options: [...poll.options, ''] });
  }

  function removeOption(id: string, idx: number) {
    const poll = value.find((p) => p.id === id);
    if (!poll || poll.options.length <= MIN_OPTIONS) return;
    patchPoll(id, { options: poll.options.filter((_, i) => i !== idx) });
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-baseline justify-between">
        <Text style={FORM_LABEL_STYLE}>
          {value.length === 0 ? 'Anything else for the group?' : 'Custom questions'}
        </Text>
        {value.length > 0 ? (
          <Text className="text-[11px] text-[#737373]">{value.length}/{MAX_POLLS}</Text>
        ) : null}
      </View>

      {value.map((cp, pollIdx) => {
        const visibleOptCount = cleanedOptionCount(cp);
        return (
          <View key={cp.id} className="gap-2.5 mt-1.5">
            <View className="rounded-2xl border border-line bg-card p-3.5 gap-3">
              {/* Header row — Question N + remove */}
              <View className="flex-row items-baseline justify-between">
                <View className="flex-row items-baseline gap-2">
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#404040' }}>
                    Question {pollIdx + 1}
                  </Text>
                  {visibleOptCount >= MIN_OPTIONS ? (
                    <Text className="text-[11px] font-semibold text-green">Will be polled</Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => removePoll(cp.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove question ${pollIdx + 1}`}
                >
                  <Ionicons name="close-circle" size={20} color="#A0A0A0" />
                </Pressable>
              </View>

              {/* Question input */}
              <Input
                value={cp.question}
                onChangeText={(v) => patchPoll(cp.id, { question: v })}
                placeholder="e.g. What vibe are we going for?"
                maxLength={80}
              />

              {/* Options */}
              <View className="gap-2">
                <View className="flex-row items-baseline justify-between">
                  <Text style={{ fontSize: 12, color: '#737373' }}>Options</Text>
                  <Text className="text-[11px] text-[#A0A0A0]">{cp.options.length}/{MAX_OPTIONS}</Text>
                </View>
                {cp.options.map((opt, optIdx) => (
                  <View key={optIdx} className="flex-row items-center gap-2">
                    <View style={{ flex: 1 }}>
                      <Input
                        value={opt}
                        onChangeText={(v) => setOption(cp.id, optIdx, v)}
                        placeholder={`Option ${optIdx + 1}`}
                        maxLength={60}
                      />
                    </View>
                    {cp.options.length > MIN_OPTIONS ? (
                      <Pressable
                        onPress={() => removeOption(cp.id, optIdx)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Remove option"
                      >
                        <Ionicons name="close-circle" size={20} color="#A0A0A0" />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                {cp.options.length < MAX_OPTIONS ? (
                  <Pressable
                    onPress={() => addOption(cp.id)}
                    className="flex-row items-center gap-1 self-start mt-0.5"
                    accessibilityRole="button"
                  >
                    <Ionicons name="add-outline" size={14} color="#0F3F2E" />
                    <Text className="text-[13px] font-semibold text-green">Add option</Text>
                  </Pressable>
                ) : null}
              </View>

              {/* Allow-multi toggle */}
              <View className="flex-row items-center justify-between pt-1.5 border-t border-line">
                <Text style={{ fontSize: 13, color: '#404040' }}>Allow multiple picks</Text>
                <Toggle
                  value={cp.allowMulti}
                  onValueChange={(v) => patchPoll(cp.id, { allowMulti: v })}
                />
              </View>
            </View>
            {renderResetWarning?.(cp)}
          </View>
        );
      })}

      {/* Add a question — single button. Tapping spawns an empty poll card. */}
      {!atCap ? (
        <Pressable
          onPress={() => addPoll('')}
          className="flex-row items-center gap-1 self-start mt-1"
          accessibilityRole="button"
          accessibilityLabel="Add a custom question"
        >
          <Ionicons name="add-outline" size={14} color="#0F3F2E" />
          <Text className="text-[13px] font-semibold text-green">
            {value.length === 0 ? 'Add a custom question' : 'Add another question'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Strip a custom poll down to the shape the create/update flow needs.
 * Returns `null` when the poll has no question or fewer than 1 option —
 * such polls are silently dropped on save.
 */
export function cleanCustomPoll(p: CustomPoll): {
  question: string;
  options: string[];
  allowMulti: boolean;
} | null {
  const question = p.question.trim();
  if (!question) return null;
  const options = p.options.map((o) => o.trim()).filter((o) => o.length > 0);
  if (options.length === 0) return null;
  return { question, options, allowMulti: p.allowMulti };
}
