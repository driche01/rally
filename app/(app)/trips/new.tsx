import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, PlacesAutocompleteInput } from '@/components/ui';
import { DateRangePicker } from '@/components/DateRangePicker';
import { useCreateTrip } from '@/hooks/useTrips';
import { capture, Events } from '@/lib/analytics';
import { requestNotificationPermission } from '@/lib/notifications';
import type { GroupSizeBucket } from '@/types/database';

const SEASON_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  Winter: 'snow-outline',
  Spring: 'flower-outline',
  Summer: 'sunny-outline',
  Fall: 'leaf-outline',
};

const EXACT_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const TRIP_TYPES = [
  'Party', 'Relaxation', 'Culture', 'Food', 'Adventure',
  'Sports', 'Beach', 'Road trip', 'City break', 'Ski',
];

const BUDGET_OPTIONS = ['Under $500', '$500–$1k', '$1k–$2k', '$2k–$5k', '$5k+'];

function bucketFromSize(n: number): GroupSizeBucket {
  if (n <= 4) return '0-4';
  if (n <= 8) return '5-8';
  if (n <= 12) return '9-12';
  if (n <= 20) return '13-20';
  return '20+';
}

export default function NewTripScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const createTrip = useCreateTrip();

  const [name, setName] = useState('');
  const [exactSize, setExactSize] = useState<number | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [selectedSeasons, setSelectedSeasons] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [destination, setDestination] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [budget, setBudget] = useState<string | null>(null);
  const [tripTypes, setTripTypes] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ name?: string; groupSize?: string; dates?: string }>({});

  function toggleSeason(season: string) {
    setSelectedSeasons((prev) =>
      prev.includes(season) ? prev.filter((s) => s !== season) : [...prev, season]
    );
  }

  function toggleTripType(type: string) {
    setTripTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Trip name is required';
    if (!exactSize && !isCustom) errs.groupSize = 'Select a group size';
    if (isCustom) {
      const n = parseInt(customInput, 10);
      if (!customInput || isNaN(n) || n < 1) errs.groupSize = 'Enter a valid number';
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      Alert.alert('Missing info', Object.values(errs)[0] as string);
    }
    return Object.keys(errs).length === 0;
  }

  function resolvedSize(): { bucket: GroupSizeBucket; precise: number | null } {
    if (isCustom) {
      const n = parseInt(customInput, 10);
      return { bucket: bucketFromSize(n), precise: n };
    }
    if (exactSize != null) {
      return { bucket: bucketFromSize(exactSize), precise: exactSize };
    }
    return { bucket: '0-4', precise: null };
  }

  async function handleCreate() {
    if (!validate()) return;
    const { bucket, precise } = resolvedSize();
    try {
      const trip = await createTrip.mutateAsync({
        name: name.trim(),
        group_size_bucket: bucket,
        group_size_precise: precise,
        travel_window: selectedSeasons.length > 0 ? selectedSeasons.join(', ') : undefined,
        start_date: startDate,
        end_date: endDate,
        budget_per_person: budget ?? null,
        trip_type: tripTypes.length > 0 ? tripTypes.join(',') : null,
        destination: destination.trim() || null,
        destination_address: destinationAddress.trim() || null,
      });
      capture(Events.TRIP_CREATED, { group_size_bucket: bucket });
      router.replace(`/(app)/trips/${trip.id}`);
      setTimeout(() => {
        requestNotificationPermission().catch(() => {});
      }, 1500);
    } catch {
      Alert.alert('Error', 'Could not create trip. Please try again.');
    }
  }

  return (
    <>
    <DateRangePicker
      visible={datePickerVisible}
      startDate={startDate}
      endDate={endDate}
      onConfirm={(s, e) => { setStartDate(s); setEndDate(e); }}
      onClose={() => setDatePickerVisible(false)}
    />
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
        <Text className="text-lg font-semibold text-[#262626]">New rally</Text>
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
            onChangeText={(t) => { if (t.length <= 60) setName(t); }}
            maxLength={60}
            error={errors.name}
            hint={`${name.length}/60`}
            autoFocus
          />

          {/* Group size — exact pills */}
          <View className="gap-2">
            <Text className="text-sm font-medium text-[#404040]">How many people?</Text>
            <View className="flex-row flex-wrap gap-2">
              {EXACT_SIZES.map((n) => {
                const sel = exactSize === n && !isCustom;
                return (
                  <Pressable
                    key={n}
                    onPress={() => { setExactSize(n); setIsCustom(false); setErrors((e) => ({ ...e, groupSize: undefined })); }}
                    className={`w-[52px] h-[52px] items-center justify-center rounded-xl border-[1.5px] ${sel ? 'border-coral-500 bg-coral-50' : 'border-neutral-200 bg-white'}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sel }}
                    accessibilityLabel={`${n} people`}
                  >
                    <Text className={`text-base font-semibold ${sel ? 'text-coral-500' : 'text-[#404040]'}`}>{n}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => { setIsCustom(true); setExactSize(null); setErrors((e) => ({ ...e, groupSize: undefined })); }}
                className={`h-[52px] px-3.5 items-center justify-center rounded-xl border-[1.5px] ${isCustom ? 'border-coral-500 bg-coral-50' : 'border-neutral-200 bg-white'}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: isCustom }}
                accessibilityLabel="Custom number"
              >
                <Text className={`text-base font-semibold ${isCustom ? 'text-coral-500' : 'text-[#404040]'}`}>Custom</Text>
              </Pressable>
            </View>
            {isCustom && (
              <View className="flex-row items-center gap-2 mt-1">
                <TextInput
                  className="h-11 w-[100px] border-[1.5px] border-neutral-200 rounded-[10px] px-3 text-base text-[#262626] bg-white"
                  placeholder="e.g. 25"
                  keyboardType="number-pad"
                  value={customInput}
                  onChangeText={(t) => setCustomInput(t.replace(/[^0-9]/g, ''))}
                  maxLength={3}
                  placeholderTextColor="#a3a3a3"
                />
                <Text className="text-sm text-[#737373]">people</Text>
              </View>
            )}
            {errors.groupSize ? <Text className="text-[13px] text-red-500">{errors.groupSize}</Text> : null}
          </View>

          {/* Trip type (optional, multi-select) */}
          <View className="gap-2">
            <Text className="text-sm font-medium text-[#404040]">
              Trip type{' '}
              <Text className="font-normal text-[#a3a3a3]">(optional, pick all that apply)</Text>
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {TRIP_TYPES.map((type) => {
                const sel = tripTypes.includes(type);
                return (
                  <Pressable
                    key={type}
                    onPress={() => toggleTripType(type)}
                    className={`px-3.5 py-2 rounded-full border-[1.5px] ${sel ? 'border-coral-500 bg-coral-50' : 'border-neutral-200 bg-white'}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: sel }}
                    accessibilityLabel={type}
                  >
                    <Text className={`text-sm font-medium ${sel ? 'text-coral-500' : 'text-[#525252]'}`}>{type}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Travel window (optional) */}
          <View className="gap-2">
            <Text className="text-sm font-medium text-[#404040]">
              Travel window{' '}
              <Text className="font-normal text-[#a3a3a3]">(optional)</Text>
            </Text>
            <Text className="text-xs text-[#a3a3a3] -mt-1">Helps give context to date polls</Text>
            <View className="flex-row gap-2">
              {['Winter', 'Spring', 'Summer', 'Fall'].map((season) => {
                const sel = selectedSeasons.includes(season);
                return (
                  <Pressable
                    key={season}
                    onPress={() => toggleSeason(season)}
                    className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-full border-[1.5px] py-2.5 ${sel ? 'border-coral-500 bg-coral-500' : 'border-neutral-200 bg-white'}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: sel }}
                    accessibilityLabel={season}
                  >
                    <Ionicons
                      name={SEASON_ICON[season] ?? 'sunny-outline'}
                      size={14}
                      color={sel ? 'white' : '#525252'}
                    />
                    <Text className={`text-[13px] font-medium ${sel ? 'text-white' : 'text-[#525252]'}`}>{season}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Destination (optional) */}
          <View className="gap-2">
            <Text className="text-sm font-medium text-[#404040]">
              Destination <Text className="font-normal text-[#a3a3a3]">(optional)</Text>
            </Text>
            <PlacesAutocompleteInput
              value={destination}
              onChangeText={(v) => { setDestination(v); setDestinationAddress(''); }}
              onSelectPlace={(name, address) => { setDestination(name); setDestinationAddress(address); }}
              placeholder="e.g. Cancun, Bali, Tokyo…"
              leadingIcon
            />
          </View>

          {/* Trip dates (optional) */}
          <View className="gap-2">
            <Text className="text-sm font-medium text-[#404040]">
              Trip dates{' '}
              <Text className="font-normal text-[#a3a3a3]">(optional)</Text>
            </Text>
            <TouchableOpacity
              className="flex-row items-center gap-2.5 border-[1.5px] border-neutral-200 rounded-xl bg-white px-3.5 py-[13px]"
              onPress={() => setDatePickerVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="calendar-outline" size={18} color="#737373" />
              {startDate ? (
                <View className="flex-1 flex-row items-center gap-1.5">
                  <Text className="text-sm font-medium text-[#262626]">{startDate}</Text>
                  <Text className="text-[13px] text-[#a3a3a3]">→</Text>
                  <Text className="text-sm font-medium text-[#262626]">{endDate ?? 'No end date'}</Text>
                </View>
              ) : (
                <Text className="flex-1 text-sm text-[#a3a3a3]">Add trip dates</Text>
              )}
              {startDate && (
                <TouchableOpacity
                  hitSlop={8}
                  onPress={(e) => { e.stopPropagation(); setStartDate(null); setEndDate(null); }}
                >
                  <Ionicons name="close-circle" size={18} color="#a3a3a3" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          {/* Budget per person (optional) */}
          <View className="gap-2">
            <Text className="text-sm font-medium text-[#404040]">
              Budget per person{' '}
              <Text className="font-normal text-[#a3a3a3]">(optional)</Text>
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {BUDGET_OPTIONS.map((opt) => {
                const sel = budget === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => setBudget(sel ? null : opt)}
                    className={`px-3.5 py-2 rounded-full border-[1.5px] ${sel ? 'border-coral-500 bg-coral-50' : 'border-neutral-200 bg-white'}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sel }}
                    accessibilityLabel={opt}
                  >
                    <Text className={`text-sm font-medium ${sel ? 'text-coral-500' : 'text-[#525252]'}`}>{opt}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Button onPress={handleCreate} loading={createTrip.isPending} fullWidth>
            Create rally
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    </>
  );
}
