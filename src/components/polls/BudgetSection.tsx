import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Divider, Input } from '@/components/ui';
import type { BudgetRange } from '@/types/polls';

// ── BoundaryInput ─────────────────────────────────────────────────────────────
// Editable number input for the upper bound of a budget tier.

function BoundaryInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  function handleCommit() {
    const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(num) && num > 0) {
      onCommit(num);
    } else {
      setText(String(value));
    }
  }

  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onBlur={handleCommit}
      onSubmitEditing={handleCommit}
      keyboardType="number-pad"
      selectTextOnFocus
      className="min-w-[56px] rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 text-center text-sm font-medium text-neutral-700"
      accessibilityLabel="budget boundary"
    />
  );
}

// ── BudgetSection ─────────────────────────────────────────────────────────────

export interface BudgetSectionProps {
  title: string;
  onTitleChange: (v: string) => void;
  budgetRanges: BudgetRange[];
  onToggle: (id: string) => void;
  onBoundaryUpdate: (i: number, max: number) => void;
  onLabelUpdate: (id: string, label: string) => void;
  onTierAdd: () => void;
  onTierRemove: (id: string) => void;
  accentColor?: string;
}

export function BudgetSection({
  title,
  onTitleChange,
  budgetRanges,
  onToggle,
  onBoundaryUpdate,
  onLabelUpdate,
  onTierAdd,
  onTierRemove,
  accentColor = '#D85A30',
}: BudgetSectionProps) {
  return (
    <>
      <Input
        label="Question"
        value={title}
        onChangeText={onTitleChange}
        placeholder="What's the spend looking like?"
      />

      <Divider />

      <View className="gap-2">
        <Text className="text-sm font-medium text-neutral-700">Budget tiers</Text>
        <Text className="text-xs text-neutral-400 -mt-1">
          Tap a label to rename · tap a number to change the boundary
        </Text>
        {budgetRanges.map((r, i) => {
          const isLast = i === budgetRanges.length - 1;
          return (
            <View
              key={r.id}
              className="flex-row items-center gap-2 rounded-xl border px-3 py-3"
              style={r.selected
                ? { borderColor: accentColor + '80', backgroundColor: accentColor + '10' }
                : { borderColor: '#E5E5E5', backgroundColor: '#FFFFFF' }
              }
            >
              {/* Checkbox */}
              <Pressable
                onPress={() => onToggle(r.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: r.selected }}
              >
                <View
                  className="h-5 w-5 items-center justify-center rounded-md border-2"
                  style={r.selected
                    ? { borderColor: accentColor, backgroundColor: accentColor }
                    : { borderColor: '#D4D4D4', backgroundColor: '#FFFFFF' }
                  }
                >
                  {r.selected ? <Ionicons name="checkmark" size={12} color="white" /> : null}
                </View>
              </Pressable>

              {/* Editable label */}
              <TextInput
                value={r.label}
                onChangeText={(v) => onLabelUpdate(r.id, v)}
                className="flex-1 text-sm text-neutral-800"
                placeholderTextColor="#A8A8A8"
                maxLength={40}
              />

              {/* Boundary input — hidden for the last "over X" tier */}
              {!isLast ? (
                <View className="flex-row items-center gap-1">
                  <Text className="text-xs text-neutral-400">Up to</Text>
                  <BoundaryInput
                    value={r.max!}
                    onCommit={(n) => onBoundaryUpdate(i, n)}
                  />
                </View>
              ) : null}

              {/* Remove button — only when more than 2 tiers */}
              {budgetRanges.length > 2 ? (
                <Pressable
                  onPress={() => onTierRemove(r.id)}
                  accessibilityRole="button"
                  accessibilityLabel="remove tier"
                >
                  <Ionicons name="close-circle" size={20} color="#A8A8A8" />
                </Pressable>
              ) : null}
            </View>
          );
        })}

        {/* Add tier */}
        {budgetRanges.length < 6 ? (
          <Pressable
            onPress={onTierAdd}
            className="flex-row items-center gap-2 py-2"
            accessibilityRole="button"
          >
            <Ionicons name="add-circle-outline" size={20} color={accentColor} />
            <Text className="text-base" style={{ color: accentColor }}>Add tier</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}
