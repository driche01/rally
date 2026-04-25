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
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, PlacesAutocompleteInput } from '@/components/ui';
import { DateRangePicker } from '@/components/DateRangePicker';
import { useTrip, useUpdateTrip } from '@/hooks/useTrips';
import type { GroupSizeBucket } from '@/types/database';

const EXACT_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const TRIP_TYPES = [
  'Bachelorette / bachelor',
  'Birthday trip',
  'Friend group getaway',
  'Family trip',
  'Alumni / reunion',
  'Other',
];

const BUDGET_OPTIONS = ['Under $500', '$500–$1k', '$1k–$2.5k', 'Above $2.5k'];

function bucketFromSize(n: number): GroupSizeBucket {
  if (n <= 4) return '0-4';
  if (n <= 8) return '5-8';
  if (n <= 12) return '9-12';
  if (n <= 20) return '13-20';
  return '20+';
}

export default function EditTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: trip, isLoading } = useTrip(id);
  const updateTrip = useUpdateTrip();

  const [name, setName] = useState('');
  const [exactSize, setExactSize] = useState<number | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [destination, setDestination] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [budget, setBudget] = useState<string | null>(null);
  const [tripType, setTripType] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ name?: string; groupSize?: string; tripType?: string }>({});
  const [initialized, setInitialized] = useState(false);

  // Populate form once trip data is loaded
  useEffect(() => {
    if (trip && !initialized) {
      setName(trip.name);

      // Restore group size selection
      const precise = trip.group_size_precise;
      if (precise != null && precise <= 10) {
        setExactSize(precise);
        setIsCustom(false);
      } else if (precise != null && precise > 10) {
        setIsCustom(true);
        setCustomInput(String(precise));
      } else {
        setExactSize(null);
        setIsCustom(false);
      }

      setDestination(trip.destination ?? '');
      setDestinationAddress(trip.destination_address ?? '');
      setStartDate(trip.start_date ?? null);
      setEndDate(trip.end_date ?? null);
      setBudget(trip.budget_per_person ?? null);

      setTripType(trip.trip_type ?? null);

      setInitialized(true);
    }
  }, [trip, initialized]);

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Trip name is required';
    if (!exactSize && !isCustom) errs.groupSize = 'Select a group size';
    if (isCustom) {
      const n = parseInt(customInput, 10);
      if (!customInput || isNaN(n) || n < 1) errs.groupSize = 'Enter a valid number';
    }
    if (!tripType) errs.tripType = 'Select a trip type';
    setErrors(errs);
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
    return { bucket: trip?.group_size_bucket ?? '0-4', precise: null };
  }

  async function handleSave() {
    if (!validate()) return;
    const { bucket, precise } = resolvedSize();
    try {
      await updateTrip.mutateAsync({
        id,
        name: name.trim(),
        group_size_bucket: bucket,
        group_size_precise: precise,
        start_date: startDate,
        end_date: endDate,
        budget_per_person: budget ?? null,
        trip_type: tripType,
        destination: destination.trim() || null,
        destination_address: destinationAddress.trim() || null,
      });
      router.back();
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.warn('[edit] updateTrip failed:', msg);
      setErrors({ name: `Save failed: ${msg}` });
    }
  }

  if (isLoading || !initialized) {
    return (
      <View className="flex-1 items-center justify-center" style={{ paddingTop: insets.top }}>
        <ActivityIndicator size="large" color="#0F3F2E" />
      </View>
    );
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
      className="flex-1 bg-cream"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View
        className="flex-row items-center justify-between px-6 pb-4"
        style={{ paddingTop: insets.top + 16 }}
      >
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text className="text-base text-green">Cancel</Text>
        </TouchableOpacity>
        <Text className="text-lg font-semibold text-[#262626]">Edit rally</Text>
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
            autoFocus={false}
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
                    className={`w-[40px] h-[40px] items-center justify-center rounded-xl border-[1.5px] ${sel ? 'border-green bg-green-soft' : 'border-line bg-card'}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sel }}
                    accessibilityLabel={`${n} people`}
                  >
                    <Text className={`text-base font-semibold ${sel ? 'text-green' : 'text-[#404040]'}`}>{n}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => { setIsCustom(true); setExactSize(null); setErrors((e) => ({ ...e, groupSize: undefined })); }}
                className={`h-[40px] px-3.5 items-center justify-center rounded-xl border-[1.5px] ${isCustom ? 'border-green bg-green-soft' : 'border-line bg-card'}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: isCustom }}
                accessibilityLabel="Custom number"
              >
                <Text className={`text-base font-semibold ${isCustom ? 'text-green' : 'text-[#404040]'}`}>Custom</Text>
              </Pressable>
            </View>
            {isCustom && (
              <View className="flex-row items-center gap-2 mt-1">
                <TextInput
                  className="h-11 w-[100px] border-[1.5px] border-line rounded-[10px] px-3 text-base text-[#262626] bg-card"
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

          {/* Trip type (required, single-select) */}
          <View className="gap-2">
            <Text className="text-sm font-medium text-[#404040]">Trip type</Text>
            <View className="flex-row flex-wrap gap-2">
              {TRIP_TYPES.map((type) => {
                const sel = tripType === type;
                return (
                  <Pressable
                    key={type}
                    onPress={() => { setTripType(sel ? null : type); setErrors((e) => ({ ...e, tripType: undefined })); }}
                    className={`px-3.5 py-2 rounded-full border-[1.5px] ${sel ? 'border-green bg-green-soft' : 'border-line bg-card'}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sel }}
                    accessibilityLabel={type}
                  >
                    <Text className={`text-sm font-medium ${sel ? 'text-green' : 'text-[#525252]'}`}>{type}</Text>
                  </Pressable>
                );
              })}
            </View>
            {errors.tripType ? <Text className="text-[13px] text-red-500">{errors.tripType}</Text> : null}
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
              className="flex-row items-center gap-2.5 border-[1.5px] border-line rounded-xl bg-card px-3.5 py-[13px]"
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
                    className={`px-3.5 py-2 rounded-full border-[1.5px] ${sel ? 'border-green bg-green-soft' : 'border-line bg-card'}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sel }}
                    accessibilityLabel={opt}
                  >
                    <Text className={`text-sm font-medium ${sel ? 'text-green' : 'text-[#525252]'}`}>{opt}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Button onPress={handleSave} loading={updateTrip.isPending} fullWidth>
            Save changes
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    </>
  );
}
