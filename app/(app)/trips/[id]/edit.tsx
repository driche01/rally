import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input } from '@/components/ui';
import { PreciseGroupSizeModal } from '@/components/PreciseGroupSizeModal';
import { useTrip, useUpdateTrip } from '@/hooks/useTrips';
import type { GroupSizeBucket } from '@/types/database';

const SEASONS = ['Winter', 'Spring', 'Summer', 'Fall'] as const;

const SEASON_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  Winter: 'snow-outline',
  Spring: 'flower-outline',
  Summer: 'sunny-outline',
  Fall: 'leaf-outline',
};

const GROUP_SIZE_OPTIONS: { value: GroupSizeBucket; label: string }[] = [
  { value: '0-4', label: '0–4' },
  { value: '5-8', label: '5–8' },
  { value: '9-12', label: '9–12' },
  { value: '13-20', label: '13–20' },
  { value: '20+', label: '20+' },
];

export default function EditTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: trip, isLoading } = useTrip(id);
  const updateTrip = useUpdateTrip();

  const [name, setName] = useState('');
  const [groupSize, setGroupSize] = useState<GroupSizeBucket | null>(null);
  const [precisePeople, setPrecisePeople] = useState<number | null>(null);
  const [selectedSeasons, setSelectedSeasons] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ name?: string; groupSize?: string }>({});
  const [initialized, setInitialized] = useState(false);
  const [preciseModalVisible, setPreciseModalVisible] = useState(false);

  // Populate form once trip data is loaded
  useEffect(() => {
    if (trip && !initialized) {
      setName(trip.name);
      setGroupSize(trip.group_size_bucket);
      setPrecisePeople(trip.group_size_precise ?? null);
      if (trip.travel_window) {
        const stored = trip.travel_window
          .split(', ')
          .filter((s) => SEASONS.includes(s as (typeof SEASONS)[number]));
        setSelectedSeasons(stored);
      }
      setInitialized(true);
    }
  }, [trip, initialized]);

  function toggleSeason(season: string) {
    setSelectedSeasons((prev) =>
      prev.includes(season) ? prev.filter((s) => s !== season) : [...prev, season]
    );
  }

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Trip name is required';
    if (!groupSize) errs.groupSize = 'Select a group size';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate() || !groupSize) return;
    try {
      await updateTrip.mutateAsync({
        id,
        name: name.trim(),
        group_size_bucket: groupSize,
        group_size_precise: precisePeople,
        travel_window: selectedSeasons.length > 0 ? selectedSeasons.join(', ') : undefined,
      });
      router.back();
    } catch (err) {
      console.error('[edit] updateTrip failed:', err);
      setErrors({ name: 'Could not save changes. Try again.' });
    }
  }

  if (isLoading || !initialized) {
    return (
      <View
        className="flex-1 items-center justify-center bg-neutral-50"
        style={{ paddingTop: insets.top }}
      >
        <ActivityIndicator size="large" color="#FF6B5B" />
      </View>
    );
  }

  return (
    <>
      <KeyboardAvoidingView
        className="flex-1 bg-neutral-50"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View
          className="flex-row items-center justify-between px-6 pb-4"
          style={{ paddingTop: insets.top + 16 }}
        >
          <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
            <Text className="text-base text-coral-500">Cancel</Text>
          </TouchableOpacity>
          <Text className="text-lg font-semibold text-neutral-800">Edit rally</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-6 pt-4">
            {/* Trip name */}
            <Input
              label="Trip name"
              placeholder="e.g. Cabo 2026, Jake's Birthday, Ski Weekend"
              value={name}
              onChangeText={(t) => {
                if (t.length <= 60) setName(t);
              }}
              maxLength={60}
              error={errors.name}
              hint={`${name.length}/60`}
              autoFocus={false}
            />

            {/* Group size */}
            <View className="gap-2">
              <Text className="text-sm font-medium text-neutral-700">Rough group size</Text>
              <View className="flex-row flex-wrap gap-2">
                {GROUP_SIZE_OPTIONS.map((opt) => {
                  const selected = groupSize === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => {
                        if (selected) {
                          // Second tap on the already-selected tile → enter exact number
                          setPreciseModalVisible(true);
                        } else {
                          setGroupSize(opt.value);
                          // Clear precise when switching buckets
                          setPrecisePeople(null);
                          setErrors((e) => ({ ...e, groupSize: undefined }));
                        }
                      }}
                      className={[
                        'flex-1 items-center justify-center rounded-2xl border py-4 min-h-[56px]',
                        selected
                          ? 'border-coral-500 bg-coral-50'
                          : 'border-neutral-200 bg-white',
                      ].join(' ')}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${opt.label} people`}
                    >
                      {selected && precisePeople != null ? (
                        // Show the precise number inside the selected tile
                        <View className="items-center">
                          <Text className="text-base font-semibold text-coral-600">
                            {precisePeople}
                          </Text>
                          <Text className="text-xs text-center text-coral-500">tap to edit</Text>
                        </View>
                      ) : (
                        <View className="items-center">
                          <Text
                            className={[
                              'text-base font-semibold',
                              selected ? 'text-coral-600' : 'text-neutral-700',
                            ].join(' ')}
                          >
                            {opt.label}
                          </Text>
                          <Text
                            className={[
                              'text-xs text-center',
                              selected ? 'text-coral-500' : 'text-neutral-400',
                            ].join(' ')}
                          >
                            {selected ? 'tap to specify exact' : 'people'}
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
              {errors.groupSize ? (
                <Text className="text-sm text-red-500">{errors.groupSize}</Text>
              ) : null}
            </View>

            {/* Travel window */}
            <View className="gap-2">
              <View>
                <Text className="text-sm font-medium text-neutral-700">
                  Rough travel window{' '}
                  <Text className="font-normal text-neutral-400">(optional)</Text>
                </Text>
                <Text className="mt-0.5 text-xs text-neutral-400">
                  Helps give context to date polls
                </Text>
              </View>
              <View className="flex-row gap-2">
                {SEASONS.map((season) => {
                  const selected = selectedSeasons.includes(season);
                  return (
                    <Pressable
                      key={season}
                      onPress={() => toggleSeason(season)}
                      className={[
                        'flex-1 flex-row items-center justify-center gap-1.5 rounded-full border py-2.5',
                        selected ? 'border-coral-500 bg-coral-500' : 'border-neutral-200 bg-white',
                      ].join(' ')}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={season}
                    >
                      <Ionicons
                        name={SEASON_ICON[season] ?? 'sunny-outline'}
                        size={14}
                        color={selected ? 'white' : '#525252'}
                      />
                      <Text
                        className={[
                          'text-sm font-medium',
                          selected ? 'text-white' : 'text-neutral-600',
                        ].join(' ')}
                      >
                        {season}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Button
              onPress={handleSave}
              loading={updateTrip.isPending}
              fullWidth
              className="mt-2"
            >
              Save changes
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <PreciseGroupSizeModal
        visible={preciseModalVisible}
        current={precisePeople}
        onSave={(n) => {
          setPrecisePeople(n);
          setPreciseModalVisible(false);
        }}
        onClose={() => setPreciseModalVisible(false)}
      />
    </>
  );
}
