import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Input, Toggle } from '@/components/ui';
import type { CustomPoll } from '@/types/polls';

// ── CustomSection ─────────────────────────────────────────────────────────────

export interface CustomSectionProps {
  customPolls: CustomPoll[];
  onPollAdd: () => void;
  onPollRemove: (id: string) => void;
  onQuestionChange: (id: string, question: string) => void;
  onOptionAdd: (id: string) => void;
  onOptionChange: (id: string, optIdx: number, value: string) => void;
  onOptionRemove: (id: string, optIdx: number) => void;
  onMultiToggle: (id: string) => void;
  accentColor?: string;
}

export function CustomSection({
  customPolls,
  onPollAdd,
  onPollRemove,
  onQuestionChange,
  onOptionAdd,
  onOptionChange,
  onOptionRemove,
  onMultiToggle,
  accentColor = '#D85A30',
}: CustomSectionProps) {
  return (
    <>
      <View className="gap-1 -mt-1">
        <Text className="text-sm font-medium text-ink">
          Custom questions{' '}
          <Text className="font-normal text-muted">({customPolls.length}/3)</Text>
        </Text>
        <Text className="text-xs text-muted">
          Add up to 3 free-form polls alongside Destination, Dates, and Budget.
        </Text>
      </View>

      {customPolls.map((cp, pollIdx) => {
        const isLocked = cp.status === 'live' || cp.status === 'decided';
        const statusLabel =
          cp.status === 'live' ? 'Live' : cp.status === 'decided' ? 'Decided' : null;

        if (isLocked) {
          // ── Read-only card for live / decided polls ─────────────────────────
          return (
            <View
              key={cp.id}
              className="rounded-2xl border border-line bg-cream p-4 gap-3 opacity-60"
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-muted">
                  Question {pollIdx + 1}
                </Text>
                {statusLabel ? (
                  <View className="rounded-full bg-line px-2.5 py-0.5">
                    <Text className="text-xs font-medium text-muted">{statusLabel}</Text>
                  </View>
                ) : null}
              </View>
              <Text className="text-base text-muted px-1">{cp.question}</Text>
              <View className="gap-1.5">
                {cp.options.filter((o) => o.trim()).map((opt, optIdx) => (
                  <View key={optIdx} className="rounded-2xl border border-line bg-cream-warm px-4 py-2.5">
                    <Text className="text-sm text-muted">{opt}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        }

        // ── Editable card for draft / new polls ─────────────────────────────
        const editableDraftCount = customPolls.filter(
          (p) => !p.status || p.status === 'draft'
        ).length;

        return (
          <View key={cp.id} className="rounded-2xl border border-line bg-cream-warm p-4 gap-4">
            {/* Poll header */}
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-ink">
                Question {pollIdx + 1}
              </Text>
              {editableDraftCount > 1 ? (
                <Pressable
                  onPress={() => onPollRemove(cp.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="remove question"
                >
                  <Ionicons name="close-circle" size={20} color="#A8A8A8" />
                </Pressable>
              ) : null}
            </View>

            {/* Question input */}
            <Input
              value={cp.question}
              onChangeText={(v) => onQuestionChange(cp.id, v)}
              placeholder="e.g. What vibe are we going for?"
              maxLength={80}
            />

            {/* Options */}
            <View className="gap-2">
              <Text className="text-xs font-medium text-muted">
                Options{' '}
                <Text className="font-normal text-muted">({cp.options.length}/6)</Text>
              </Text>
              {cp.options.map((opt, optIdx) => (
                <View key={optIdx} className="flex-row items-center gap-2">
                  <View style={{ flex: 1 }}>
                    <Input
                      value={opt}
                      onChangeText={(v) => onOptionChange(cp.id, optIdx, v)}
                      placeholder={`Option ${optIdx + 1}${optIdx < 2 ? ' *' : ''}`}
                      maxLength={60}
                    />
                  </View>
                  {cp.options.length > 2 ? (
                    <Pressable
                      onPress={() => onOptionRemove(cp.id, optIdx)}
                      accessibilityRole="button"
                      accessibilityLabel="remove option"
                    >
                      <Ionicons name="close-circle" size={22} color="#A8A8A8" />
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {cp.options.length < 6 ? (
                <Pressable
                  onPress={() => onOptionAdd(cp.id)}
                  className="flex-row items-center gap-2 py-1"
                  accessibilityRole="button"
                >
                  <Ionicons name="add-circle-outline" size={20} color={accentColor} />
                  <Text className="text-sm" style={{ color: accentColor }}>Add option</Text>
                </Pressable>
              ) : null}
            </View>

            {/* Allow multi toggle */}
            <View className="flex-row items-center justify-between pt-1 border-t border-line">
              <Text className="text-sm text-ink">Allow multiple picks</Text>
              <Toggle
                value={cp.allowMulti}
                onValueChange={() => onMultiToggle(cp.id)}
              />
            </View>
          </View>
        );
      })}

      {customPolls.length < 3 ? (
        <Pressable
          onPress={onPollAdd}
          className="flex-row items-center gap-2 py-2"
          accessibilityRole="button"
        >
          <Ionicons name="add-circle-outline" size={20} color={accentColor} />
          <Text className="text-base" style={{ color: accentColor }}>Add another question</Text>
        </Pressable>
      ) : null}
    </>
  );
}
