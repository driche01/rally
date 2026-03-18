import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
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

const SEASONS = ['Winter', 'Spring', 'Summer', 'Fall'] as const;

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
  const [selectedSeasons, setSelectedSeasons] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [destination, setDestination] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [budget, setBudget] = useState<string | null>(null);
  const [tripTypes, setTripTypes] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ name?: string; groupSize?: string; dates?: string }>({});
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

      if (trip.travel_window) {
        const stored = trip.travel_window
          .split(', ')
          .filter((s) => SEASONS.includes(s as (typeof SEASONS)[number]));
        setSelectedSeasons(stored);
      }

      setDestination(trip.destination ?? '');
      setDestinationAddress(trip.destination_address ?? '');
      setStartDate(trip.start_date ?? null);
      setEndDate(trip.end_date ?? null);
      setBudget(trip.budget_per_person ?? null);

      if (trip.trip_type) {
        setTripTypes(trip.trip_type.split(',').map((t) => t.trim()));
      }

      setInitialized(true);
    }
  }, [trip, initialized]);

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
    // date validation handled by the picker itself
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
        travel_window: selectedSeasons.length > 0 ? selectedSeasons.join(', ') : undefined,
        start_date: startDate,
        end_date: endDate,
        budget_per_person: budget ?? null,
        trip_type: tripTypes.length > 0 ? tripTypes.join(',') : null,
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
      <View style={[styles.flex, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#D85A30" />
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
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit rally</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
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
          <View style={styles.section}>
            <Text style={styles.label}>How many people?</Text>
            <View style={styles.sizeGrid}>
              {EXACT_SIZES.map((n) => {
                const sel = exactSize === n && !isCustom;
                return (
                  <Pressable
                    key={n}
                    onPress={() => { setExactSize(n); setIsCustom(false); setErrors((e) => ({ ...e, groupSize: undefined })); }}
                    style={[styles.sizeBox, sel && styles.sizeBoxSel]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sel }}
                    accessibilityLabel={`${n} people`}
                  >
                    <Text style={[styles.sizeNum, sel && styles.sizeNumSel]}>{n}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => { setIsCustom(true); setExactSize(null); setErrors((e) => ({ ...e, groupSize: undefined })); }}
                style={[styles.sizeBox, styles.sizeBoxCustom, isCustom && styles.sizeBoxSel]}
                accessibilityRole="radio"
                accessibilityState={{ selected: isCustom }}
                accessibilityLabel="Custom number"
              >
                <Text style={[styles.sizeNum, isCustom && styles.sizeNumSel]}>Custom</Text>
              </Pressable>
            </View>
            {isCustom && (
              <View style={styles.customRow}>
                <TextInput
                  style={styles.customInput}
                  placeholder="e.g. 25"
                  keyboardType="number-pad"
                  value={customInput}
                  onChangeText={(t) => setCustomInput(t.replace(/[^0-9]/g, ''))}
                  maxLength={3}
                  placeholderTextColor="#a3a3a3"
                />
                <Text style={styles.customSuffix}>people</Text>
              </View>
            )}
            {errors.groupSize ? <Text style={styles.errorText}>{errors.groupSize}</Text> : null}
          </View>

          {/* Trip type (optional, multi-select) */}
          <View style={styles.section}>
            <Text style={styles.label}>
              Trip type{' '}
              <Text style={styles.optional}>(optional, pick all that apply)</Text>
            </Text>
            <View style={styles.pillWrap}>
              {TRIP_TYPES.map((type) => {
                const sel = tripTypes.includes(type);
                return (
                  <Pressable
                    key={type}
                    onPress={() => toggleTripType(type)}
                    style={[styles.pill, sel && styles.pillSel]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: sel }}
                    accessibilityLabel={type}
                  >
                    <Text style={[styles.pillText, sel && styles.pillTextSel]}>{type}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Travel window (optional) */}
          <View style={styles.section}>
            <Text style={styles.label}>
              Travel window{' '}
              <Text style={styles.optional}>(optional)</Text>
            </Text>
            <Text style={styles.hint}>Helps give context to date polls</Text>
            <View style={styles.seasonRow}>
              {SEASONS.map((season) => {
                const sel = selectedSeasons.includes(season);
                return (
                  <Pressable
                    key={season}
                    onPress={() => toggleSeason(season)}
                    style={[styles.seasonPill, sel && styles.seasonPillSel]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: sel }}
                    accessibilityLabel={season}
                  >
                    <Ionicons
                      name={SEASON_ICON[season] ?? 'sunny-outline'}
                      size={14}
                      color={sel ? 'white' : '#525252'}
                    />
                    <Text style={[styles.seasonText, sel && styles.seasonTextSel]}>{season}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Destination (optional) */}
          <View style={styles.section}>
            <Text style={styles.label}>
              Destination <Text style={styles.optional}>(optional)</Text>
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
          <View style={styles.section}>
            <Text style={styles.label}>
              Trip dates{' '}
              <Text style={styles.optional}>(optional)</Text>
            </Text>
            <TouchableOpacity
              style={styles.dateTrigger}
              onPress={() => setDatePickerVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="calendar-outline" size={18} color="#737373" />
              {startDate ? (
                <View style={styles.dateTriggerInner}>
                  <Text style={styles.dateTriggerValue}>{startDate}</Text>
                  <Text style={styles.dateTriggerSep}>→</Text>
                  <Text style={styles.dateTriggerValue}>{endDate ?? 'No end date'}</Text>
                </View>
              ) : (
                <Text style={styles.dateTriggerPlaceholder}>Add trip dates</Text>
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
          <View style={styles.section}>
            <Text style={styles.label}>
              Budget per person{' '}
              <Text style={styles.optional}>(optional)</Text>
            </Text>
            <View style={styles.pillWrap}>
              {BUDGET_OPTIONS.map((opt) => {
                const sel = budget === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => setBudget(sel ? null : opt)}
                    style={[styles.pill, sel && styles.pillSel]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sel }}
                    accessibilityLabel={opt}
                  >
                    <Text style={[styles.pillText, sel && styles.pillTextSel]}>{opt}</Text>
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

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fafafa' },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  cancelText: { fontSize: 16, color: '#D85A30' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#262626' },
  scroll: { paddingHorizontal: 24 },
  form: { gap: 24, paddingTop: 16 },
  section: { gap: 8 },
  label: { fontSize: 14, fontWeight: '500', color: '#404040' },
  optional: { fontWeight: '400', color: '#a3a3a3' },
  hint: { fontSize: 12, color: '#a3a3a3', marginTop: -4 },
  errorText: { fontSize: 13, color: '#ef4444' },

  // Size grid
  sizeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sizeBox: {
    width: 52, height: 52,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, borderWidth: 1.5,
    borderColor: '#e5e5e5', backgroundColor: '#fff',
  },
  sizeBoxSel: { borderColor: '#D85A30', backgroundColor: '#fff5f2' },
  sizeBoxCustom: { width: 'auto', paddingHorizontal: 14, height: 52 },
  sizeNum: { fontSize: 16, fontWeight: '600', color: '#404040' },
  sizeNumSel: { color: '#D85A30' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  customInput: {
    height: 44, width: 100, borderWidth: 1.5,
    borderColor: '#e5e5e5', borderRadius: 10,
    paddingHorizontal: 12, fontSize: 16, color: '#262626',
    backgroundColor: '#fff',
  },
  customSuffix: { fontSize: 14, color: '#737373' },

  // Generic pills
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1.5,
    borderColor: '#e5e5e5', backgroundColor: '#fff',
  },
  pillSel: { borderColor: '#D85A30', backgroundColor: '#fff5f2' },
  pillText: { fontSize: 14, fontWeight: '500', color: '#525252' },
  pillTextSel: { color: '#D85A30' },

  // Season pills
  seasonRow: { flexDirection: 'row', gap: 8 },
  seasonPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 999, borderWidth: 1.5,
    borderColor: '#e5e5e5', backgroundColor: '#fff',
    paddingVertical: 10,
  },
  seasonPillSel: { borderColor: '#D85A30', backgroundColor: '#D85A30' },
  seasonText: { fontSize: 13, fontWeight: '500', color: '#525252' },
  seasonTextSel: { color: '#fff' },

  // Date fields
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateField: { flex: 1, gap: 4 },
  dateFieldLabel: { fontSize: 12, color: '#737373', fontWeight: '500' },
  dateInput: {
    height: 44, borderWidth: 1.5,
    borderColor: '#e5e5e5', borderRadius: 10,
    paddingHorizontal: 12, fontSize: 15, color: '#262626',
    backgroundColor: '#fff',
  },
  dateSep: { fontSize: 16, color: '#a3a3a3', marginTop: 18 },

  // Date trigger
  dateTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderColor: '#e5e5e5', borderRadius: 12,
    backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 13,
  },
  dateTriggerInner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateTriggerValue: { fontSize: 14, fontWeight: '500', color: '#262626' },
  dateTriggerSep: { fontSize: 13, color: '#a3a3a3' },
  dateTriggerPlaceholder: { flex: 1, fontSize: 14, color: '#a3a3a3' },
});
