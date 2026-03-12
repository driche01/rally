import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { Divider, Input } from '@/components/ui';
import { POPULAR_DESTINATIONS } from '@/lib/constants/destinations';

// ── DestinationInput ──────────────────────────────────────────────────────────
// TextInput with inline autocomplete dropdown from POPULAR_DESTINATIONS.

function DestinationInput({
  value,
  onChangeText,
  placeholder,
  maxLength,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  maxLength?: number;
}) {
  const [focused, setFocused] = useState(false);

  const trimmed = value.trim().toLowerCase();
  const suggestions =
    focused && trimmed.length >= 1
      ? POPULAR_DESTINATIONS.filter((d) => d.toLowerCase().includes(trimmed)).slice(0, 5)
      : [];

  return (
    <View>
      <TextInput
        value={value}
        onChangeText={(v) => onChangeText(maxLength ? v.slice(0, maxLength) : v)}
        placeholder={placeholder}
        maxLength={maxLength}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        className="min-h-[48px] rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-base text-neutral-800"
        placeholderTextColor="#A8A8A8"
      />
      {suggestions.length > 0 ? (
        <View className="mt-1 overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {suggestions.map((s, i) => (
            <Pressable
              key={s}
              onPress={() => {
                onChangeText(maxLength ? s.slice(0, maxLength) : s);
                setFocused(false);
              }}
              className={[
                'flex-row items-center gap-2 px-4 py-3',
                i < suggestions.length - 1 ? 'border-b border-neutral-100' : '',
              ].join(' ')}
            >
              <Ionicons name="location-outline" size={15} color="#A8A8A8" />
              <Text className="text-sm text-neutral-700">{s}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ── DestinationSection ────────────────────────────────────────────────────────

export interface DestinationSectionProps {
  title: string;
  onTitleChange: (v: string) => void;
  options: string[];
  onOptionChange: (i: number, v: string) => void;
  onOptionRemove: (i: number) => void;
  onOptionAdd: () => void;
  allowMulti: boolean;
  onAllowMultiChange: (v: boolean) => void;
}

export function DestinationSection({
  title,
  onTitleChange,
  options,
  onOptionChange,
  onOptionRemove,
  onOptionAdd,
  allowMulti,
  onAllowMultiChange,
}: DestinationSectionProps) {
  return (
    <>
      <Input
        label="Question"
        value={title}
        onChangeText={onTitleChange}
        placeholder="What should the group decide?"
      />

      <Divider />

      <View className="gap-2">
        <Text className="text-sm font-medium text-neutral-700">
          Options{' '}
          <Text className="font-normal text-neutral-400">({options.length}/6)</Text>
        </Text>
        <Text className="text-xs text-neutral-400 -mt-1">
          Type to search cities &amp; countries
        </Text>
        {options.map((opt, i) => (
          <View key={i} className="flex-row items-center gap-2">
            <View className="flex-1">
              <DestinationInput
                value={opt}
                onChangeText={(v) => onOptionChange(i, v)}
                placeholder={`Option ${i + 1}${i < 2 ? ' *' : ''}`}
                maxLength={40}
              />
            </View>
            {options.length > 2 ? (
              <Pressable
                onPress={() => onOptionRemove(i)}
                className="p-2"
                accessibilityRole="button"
                accessibilityLabel="remove option"
              >
                <Ionicons name="close-circle" size={22} color="#A8A8A8" />
              </Pressable>
            ) : null}
          </View>
        ))}
        {options.length < 6 ? (
          <Pressable
            onPress={onOptionAdd}
            className="flex-row items-center gap-2 py-2"
            accessibilityRole="button"
          >
            <Ionicons name="add-circle-outline" size={20} color="#FF6B5B" />
            <Text className="text-base text-coral-500">Add option</Text>
          </Pressable>
        ) : null}
      </View>

      <Divider />

      <View className="flex-row items-center justify-between">
        <View className="flex-1 gap-0.5">
          <Text className="text-base font-medium text-neutral-800">Allow multiple choices</Text>
          <Text className="text-sm text-neutral-400">
            Group members can select more than one
          </Text>
        </View>
        <Switch
          value={allowMulti}
          onValueChange={onAllowMultiChange}
          trackColor={{ false: '#E8E8E8', true: '#FF6B5B' }}
          thumbColor="white"
        />
      </View>
    </>
  );
}
