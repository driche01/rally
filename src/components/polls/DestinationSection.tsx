import { Ionicons } from '@expo/vector-icons';
import { Pressable, Switch, Text, View } from 'react-native';
import { Divider, Input, PlacesAutocompleteInput } from '@/components/ui';

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
  accentColor?: string;
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
  accentColor = '#D85A30',
}: DestinationSectionProps) {
  return (
    <>
      <Input
        label="Question"
        value={title}
        onChangeText={onTitleChange}
        placeholder="Where are we headed?"
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
              <PlacesAutocompleteInput
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
            <Ionicons name="add-circle-outline" size={20} color={accentColor} />
            <Text className="text-base" style={{ color: accentColor }}>Add option</Text>
          </Pressable>
        ) : null}
      </View>

      <Divider />

      <View className="flex-row items-center justify-between">
        <View className="flex-1 gap-0.5">
          <Text className="text-base font-medium text-neutral-800">Allow multiple picks</Text>
          <Text className="text-sm text-neutral-400">
            The crew can pick more than one
          </Text>
        </View>
        <Switch
          value={allowMulti}
          onValueChange={onAllowMultiChange}
          trackColor={{ false: '#E8E8E8', true: accentColor }}
          thumbColor="white"
        />
      </View>
    </>
  );
}
