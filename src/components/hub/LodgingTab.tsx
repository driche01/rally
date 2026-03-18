/**
 * LodgingTab — F7 Lodging Search + Deep-Link Handoff
 * Search panel, property add, and property card list.
 */
import { useState, useMemo } from 'react';
import {
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  Platform,
} from 'react-native';
import { PlacesAutocompleteInput } from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTrip } from '@/hooks/useTrips';
import {
  useLodgingOptions,
  useCreateLodgingOption,
  useUpdateLodgingOption,
  useDeleteLodgingOption,
  useConfirmLodgingBooking,
} from '@/hooks/useLodging';
import {
  buildAirbnbUrl,
  buildVrboUrl,
  buildBookingUrl,
  parseLodgingUrl,
  formatCents,
  type LodgingSearchParams,
} from '@/lib/api/lodging';
import type { LodgingOptionWithVotes, LodgingPlatform } from '@/types/database';
import { GROUP_SIZE_MIDPOINTS } from '@/types/database';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_PROPERTIES = 5;

const PLATFORM_COLORS: Record<LodgingPlatform, { bg: string; text: string; label: string }> = {
  airbnb: { bg: '#FFE4E1', text: '#E11D48', label: 'Airbnb' },
  vrbo: { bg: '#E0ECFF', text: '#2563EB', label: 'VRBO' },
  booking: { bg: '#E0E8F0', text: '#1E3A5F', label: 'Booking' },
  manual: { bg: '#F3F4F6', text: '#6B7280', label: 'Manual' },
};

const MIN_BEDROOMS_OPTIONS = [1, 2, 3, 4, 5];

// ─── Booking confirmation sheet ───────────────────────────────────────────────

interface BookingSheetState {
  visible: boolean;
  optionId: string;
  confirmation: string;
  checkInTime: string;
  checkOutTime: string;
  totalCost: string;
}

const DEFAULT_BOOKING_SHEET: BookingSheetState = {
  visible: false,
  optionId: '',
  confirmation: '',
  checkInTime: '',
  checkOutTime: '',
  totalCost: '',
};

function BookingSheet({
  state,
  onClose,
  onSave,
  saving,
}: {
  state: BookingSheetState;
  onClose: () => void;
  onSave: (s: BookingSheetState) => void;
  saving: boolean;
}) {
  const [local, setLocal] = useState(state);

  useMemo(() => {
    setLocal(state);
  }, [state.visible]);

  const set = <K extends keyof BookingSheetState>(k: K, v: BookingSheetState[K]) =>
    setLocal((p) => ({ ...p, [k]: v }));

  const canSave = true; // all fields optional

  return (
    <Modal
      visible={state.visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable onPress={() => {}} style={{ backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 16 }}>
            <View style={{ alignItems: 'center', marginBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#E5E5E5' }} />
            </View>

            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1C1C1C' }}>Confirm booking</Text>

            <View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Confirmation #</Text>
              <TextInput
                value={local.confirmation}
                onChangeText={(v) => set('confirmation', v)}
                placeholder="e.g. ABC123"
                placeholderTextColor="#A3A3A3"
                style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C' }}
                autoCapitalize="characters"
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Check-in time</Text>
                <TextInput
                  value={local.checkInTime}
                  onChangeText={(v) => set('checkInTime', v)}
                  placeholder="e.g. 3:00 PM"
                  placeholderTextColor="#A3A3A3"
                  style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C' }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Check-out time</Text>
                <TextInput
                  value={local.checkOutTime}
                  onChangeText={(v) => set('checkOutTime', v)}
                  placeholder="e.g. 11:00 AM"
                  placeholderTextColor="#A3A3A3"
                  style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C' }}
                />
              </View>
            </View>

            <View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total cost</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14 }}>
                <Text style={{ fontSize: 15, color: '#737373', marginRight: 4 }}>$</Text>
                <TextInput
                  value={local.totalCost}
                  onChangeText={(v) => set('totalCost', v.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  placeholderTextColor="#A3A3A3"
                  keyboardType="decimal-pad"
                  style={{ flex: 1, paddingVertical: 12, fontSize: 15, color: '#1C1C1C' }}
                />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={onClose}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: '#E5E5E5', alignItems: 'center' }}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#525252' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => onSave(local)}
                disabled={saving}
                style={{ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: '#FF6B5B', alignItems: 'center', justifyContent: 'center' }}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text style={{ fontSize: 15, fontWeight: '600', color: 'white' }}>Mark as booked</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ─── Manual entry sheet ───────────────────────────────────────────────────────

const PLATFORMS: { value: LodgingPlatform; label: string }[] = [
  { value: 'airbnb', label: 'Airbnb' },
  { value: 'vrbo', label: 'VRBO' },
  { value: 'booking', label: 'Booking.com' },
  { value: 'manual', label: 'Manual' },
];

interface ManualSheetState {
  visible: boolean;
  title: string;
  platform: LodgingPlatform;
  url: string;
  checkIn: string;
  checkOut: string;
  notes: string;
  totalCost: string;
}

const DEFAULT_MANUAL_SHEET: ManualSheetState = {
  visible: false,
  title: '',
  platform: 'manual',
  url: '',
  checkIn: '',
  checkOut: '',
  notes: '',
  totalCost: '',
};

function ManualEntrySheet({
  state,
  onClose,
  onSave,
  saving,
}: {
  state: ManualSheetState;
  onClose: () => void;
  onSave: (s: ManualSheetState) => void;
  saving: boolean;
}) {
  const [local, setLocal] = useState(state);

  useMemo(() => {
    setLocal(state);
  }, [state.visible]);

  const set = <K extends keyof ManualSheetState>(k: K, v: ManualSheetState[K]) =>
    setLocal((p) => ({ ...p, [k]: v }));

  const canSave = local.title.trim().length > 0;

  return (
    <Modal
      visible={state.visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            style={{ backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' }}
            contentContainerStyle={{ padding: 24, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable onPress={() => {}}>
              <View style={{ alignItems: 'center', marginBottom: 4 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#E5E5E5' }} />
              </View>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#1C1C1C', marginBottom: 16 }}>Add property</Text>

              {/* Platform */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Platform</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {PLATFORMS.map((p) => (
                    <Pressable
                      key={p.value}
                      onPress={() => set('platform', p.value)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        borderRadius: 20,
                        borderWidth: 1.5,
                        borderColor: local.platform === p.value ? '#FF6B5B' : '#E5E5E5',
                        backgroundColor: local.platform === p.value ? '#FFF1F0' : 'white',
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: local.platform === p.value ? '#FF6B5B' : '#737373' }}>{p.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              {/* Title */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Name *</Text>
              <TextInput
                value={local.title}
                onChangeText={(v) => set('title', v)}
                placeholder="e.g. Cozy Cabin in the Woods"
                placeholderTextColor="#A3A3A3"
                style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C', marginBottom: 16 }}
                autoFocus
              />

              {/* URL */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Listing URL</Text>
              <TextInput
                value={local.url}
                onChangeText={(v) => set('url', v)}
                placeholder="https://…"
                placeholderTextColor="#A3A3A3"
                style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C', marginBottom: 16 }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              {/* Dates */}
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Check-in</Text>
                  <TextInput
                    value={local.checkIn}
                    onChangeText={(v) => set('checkIn', v)}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#A3A3A3"
                    style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C' }}
                    maxLength={10}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Check-out</Text>
                  <TextInput
                    value={local.checkOut}
                    onChangeText={(v) => set('checkOut', v)}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#A3A3A3"
                    style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C' }}
                    maxLength={10}
                  />
                </View>
              </View>

              {/* Total cost */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total cost</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, marginBottom: 16 }}>
                <Text style={{ fontSize: 15, color: '#737373', marginRight: 4 }}>$</Text>
                <TextInput
                  value={local.totalCost}
                  onChangeText={(v) => set('totalCost', v.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  placeholderTextColor="#A3A3A3"
                  keyboardType="decimal-pad"
                  style={{ flex: 1, paddingVertical: 12, fontSize: 15, color: '#1C1C1C' }}
                />
              </View>

              {/* Notes */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Notes</Text>
              <TextInput
                value={local.notes}
                onChangeText={(v) => set('notes', v)}
                placeholder="Any details…"
                placeholderTextColor="#A3A3A3"
                multiline
                numberOfLines={2}
                style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C', minHeight: 72, textAlignVertical: 'top', marginBottom: 16 }}
              />

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={onClose}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: '#E5E5E5', alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#525252' }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => canSave && onSave(local)}
                  disabled={!canSave || saving}
                  style={{ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: canSave ? '#FF6B5B' : '#FCA99F', alignItems: 'center', justifyContent: 'center' }}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text style={{ fontSize: 15, fontWeight: '600', color: 'white' }}>Add property</Text>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ─── Property Card ─────────────────────────────────────────────────────────

function PropertyCard({
  option,
  onBook,
  onDelete,
  onMarkSettled,
}: {
  option: LodgingOptionWithVotes;
  onBook: () => void;
  onDelete: () => void;
  onMarkSettled: () => void;
}) {
  const platform = PLATFORM_COLORS[option.platform];
  const isBooked = option.status === 'booked';

  const dateRange =
    option.check_in_date && option.check_out_date
      ? `${option.check_in_date} → ${option.check_out_date}`
      : option.check_in_date
      ? `Check-in ${option.check_in_date}`
      : null;

  function handleLongPress() {
    const actions: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: 'Cancel', style: 'cancel' },
    ];
    if (!isBooked) {
      actions.push({ text: 'I booked this', onPress: onBook });
    }
    actions.push({
      text: 'Delete',
      style: 'destructive',
      onPress: () =>
        Alert.alert('Delete property?', 'This cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: onDelete },
        ]),
    });
    Alert.alert(option.title, undefined, actions);
  }

  return (
    <Pressable
      onLongPress={handleLongPress}
      className="mb-3 overflow-hidden rounded-2xl bg-white"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.07,
        shadowRadius: 8,
        elevation: 2,
      }}
    >
      {/* Booked banner */}
      {isBooked ? (
        <View className="bg-coral-500 px-4 py-2">
          <Text className="text-xs font-semibold text-white">✓ Booked</Text>
        </View>
      ) : null}

      <View className="p-4 gap-2">
        {/* Header row */}
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 gap-1">
            <Text className="text-sm font-semibold text-neutral-800" numberOfLines={2}>
              {option.title}
            </Text>
            {option.notes ? (
              <Text className="text-xs text-neutral-400" numberOfLines={1}>{option.notes}</Text>
            ) : null}
          </View>
          <View className="flex-row items-center gap-2">
            {/* Platform badge */}
            <View style={{ backgroundColor: platform.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: platform.text }}>{platform.label}</Text>
            </View>
            {/* Status */}
            {option.status === 'voted' ? (
              <View className="rounded-xl bg-blue-50 px-2 py-0.5">
                <Text className="text-xs font-medium text-blue-600">Voted</Text>
              </View>
            ) : option.status === 'booked' ? (
              <View className="rounded-xl bg-coral-50 px-2 py-0.5">
                <Text className="text-xs font-medium text-coral-600">Booked</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Details */}
        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          {dateRange ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name="calendar-outline" size={12} color="#A3A3A3" />
              <Text className="text-xs text-neutral-400">{dateRange}</Text>
            </View>
          ) : null}
          {option.total_cost_cents != null ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name="cash-outline" size={12} color="#A3A3A3" />
              <Text className="text-xs font-medium text-neutral-600">
                {formatCents(option.total_cost_cents)}
              </Text>
            </View>
          ) : null}
          {option.voteCount > 0 ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name="thumbs-up-outline" size={12} color="#A3A3A3" />
              <Text className="text-xs text-neutral-400">{option.voteCount} votes</Text>
            </View>
          ) : null}
        </View>

        {/* Actions */}
        <View className="flex-row items-center gap-2 pt-1">
          {option.url ? (
            <Pressable
              onPress={() => Linking.openURL(option.url!)}
              className="flex-row items-center gap-1 rounded-xl border border-neutral-200 px-3 py-1.5"
            >
              <Ionicons name="open-outline" size={12} color="#737373" />
              <Text className="text-xs font-medium text-neutral-600">View listing</Text>
            </Pressable>
          ) : null}
          {!isBooked ? (
            <Pressable
              onPress={onBook}
              className="flex-row items-center gap-1 rounded-xl bg-coral-50 px-3 py-1.5"
            >
              <Ionicons name="checkmark-circle-outline" size={12} color="#FF6B5B" />
              <Text className="text-xs font-medium text-coral-600">I booked this</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function LodgingTab({ tripId, isPlanner = true }: { tripId: string; isPlanner?: boolean }) {
  const insets = useSafeAreaInsets();

  const { data: trip } = useTrip(tripId);
  const { data: options = [] } = useLodgingOptions(tripId);
  const createOption = useCreateLodgingOption(tripId);
  const updateOption = useUpdateLodgingOption(tripId);
  const deleteOption = useDeleteLodgingOption(tripId);
  const confirmBooking = useConfirmLodgingBooking(tripId);

  // Search state
  const [searchExpanded, setSearchExpanded] = useState(true);
  const guestDefault =
    trip?.group_size_precise ??
    GROUP_SIZE_MIDPOINTS[trip?.group_size_bucket ?? '5-8'];

  const [destination, setDestination] = useState(trip?.destination ?? '');
  const [destinationAddress, setDestinationAddress] = useState(trip?.destination_address ?? '');
  const [checkIn, setCheckIn] = useState(trip?.start_date ?? '');
  const [checkOut, setCheckOut] = useState(trip?.end_date ?? '');
  const [guests, setGuests] = useState(guestDefault);
  const [minBedrooms, setMinBedrooms] = useState(1);

  // URL paste
  const [pasteUrl, setPasteUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [urlParsed, setUrlParsed] = useState<ReturnType<typeof parseLodgingUrl> | null>(null);
  const [urlTitle, setUrlTitle] = useState('');
  const [urlNotes, setUrlNotes] = useState('');

  // Sheets
  const [bookingSheet, setBookingSheet] = useState<BookingSheetState>(DEFAULT_BOOKING_SHEET);
  const [manualSheet, setManualSheet] = useState<ManualSheetState>(DEFAULT_MANUAL_SHEET);

  const atLimit = options.length >= MAX_PROPERTIES;

  // Sync defaults when trip loads
  useMemo(() => {
    const defaultGuests =
      trip?.group_size_precise ??
      GROUP_SIZE_MIDPOINTS[trip?.group_size_bucket ?? '5-8'];
    setGuests(defaultGuests);
    if (trip?.start_date) setCheckIn(trip.start_date);
    if (trip?.end_date) setCheckOut(trip.end_date);
    if (trip?.destination) setDestination(trip.destination);
    if (trip?.destination_address) setDestinationAddress(trip.destination_address);
  }, [trip?.id]);

  const searchParams: LodgingSearchParams = {
    destination: destinationAddress || destination || trip?.name || 'your destination',
    checkIn: checkIn || '2025-01-01',
    checkOut: checkOut || '2025-01-07',
    guests,
    minBedrooms,
  };

  function handleAddFromUrl() {
    setUrlError('');
    const result = parseLodgingUrl(pasteUrl);
    if (!result) {
      setUrlError("Couldn't recognise that URL — try Airbnb, VRBO, or Booking.com");
      setUrlParsed(null);
      return;
    }
    setUrlParsed(result);
    if (result.titleSlug) setUrlTitle(result.titleSlug);
  }

  function handleConfirmUrlAdd() {
    if (!urlParsed) return;
    createOption.mutate(
      {
        trip_id: tripId,
        platform: urlParsed.platform,
        title: urlTitle.trim() || urlParsed.platform,
        url: urlParsed.cleanUrl,
        notes: urlNotes.trim() || null,
        position: options.length,
      },
      {
        onSuccess: () => {
          setPasteUrl('');
          setUrlParsed(null);
          setUrlTitle('');
          setUrlNotes('');
          setUrlError('');
        },
        onError: () => Alert.alert('Error', 'Could not add property. Please try again.'),
      }
    );
  }

  function handleManualSave(state: ManualSheetState) {
    const costCents =
      state.totalCost
        ? Math.round(parseFloat(state.totalCost) * 100)
        : null;
    createOption.mutate(
      {
        trip_id: tripId,
        platform: state.platform,
        title: state.title.trim(),
        url: state.url.trim() || null,
        notes: state.notes.trim() || null,
        check_in_date: state.checkIn || null,
        check_out_date: state.checkOut || null,
        total_cost_cents: costCents,
        position: options.length,
      },
      {
        onSuccess: () => setManualSheet(DEFAULT_MANUAL_SHEET),
        onError: () => Alert.alert('Error', 'Could not add property. Please try again.'),
      }
    );
  }

  function handleBookingSave(state: BookingSheetState) {
    const costCents =
      state.totalCost
        ? Math.round(parseFloat(state.totalCost) * 100)
        : undefined;
    confirmBooking.mutate(
      {
        optionId: state.optionId,
        details: {
          booking_confirmation: state.confirmation || undefined,
          check_in_time: state.checkInTime || undefined,
          check_out_time: state.checkOutTime || undefined,
          total_cost_cents: costCents,
        },
      },
      {
        onSuccess: () => setBookingSheet(DEFAULT_BOOKING_SHEET),
        onError: () => Alert.alert('Error', 'Could not confirm booking. Please try again.'),
      }
    );
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between pt-4 pb-3">
          <Text className="text-base font-bold text-neutral-800">Lodging</Text>
          {atLimit ? (
            <View className="rounded-xl bg-neutral-100 px-3 py-1">
              <Text className="text-xs font-medium text-neutral-500">Limit reached (5/5)</Text>
            </View>
          ) : null}
        </View>

        {/* ── Section A: Search panel ── */}
        <View
          className="mb-4 overflow-hidden rounded-2xl bg-white"
          style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }}
        >
          <Pressable
            onPress={() => setSearchExpanded((p) => !p)}
            className="flex-row items-center justify-between px-4 py-3"
          >
            <View className="flex-row items-center gap-2">
              <Ionicons name="search-outline" size={16} color="#737373" />
              <Text className="text-sm font-semibold text-neutral-700">Search properties</Text>
            </View>
            <Ionicons
              name={searchExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color="#A3A3A3"
            />
          </Pressable>

          {searchExpanded ? (
            <View className="gap-3 px-4 pb-4">
              {/* Destination */}
              <View>
                <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">Destination</Text>
                <PlacesAutocompleteInput
                  value={destination}
                  onChangeText={(text) => {
                    setDestination(text);
                    // Clear saved address if user manually edits
                    setDestinationAddress('');
                  }}
                  onSelectPlace={(mainText, fullAddress) => {
                    setDestination(mainText);
                    setDestinationAddress(fullAddress);
                  }}
                  placeholder={trip?.name ?? 'Where are you going?'}
                />
              </View>

              {/* Dates */}
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">Check-in</Text>
                  <TextInput
                    value={checkIn}
                    onChangeText={setCheckIn}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#A3A3A3"
                    className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-800"
                    maxLength={10}
                  />
                </View>
                <View className="flex-1">
                  <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">Check-out</Text>
                  <TextInput
                    value={checkOut}
                    onChangeText={setCheckOut}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#A3A3A3"
                    className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-800"
                    maxLength={10}
                  />
                </View>
              </View>

              {/* Guests */}
              <View>
                <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">Guests</Text>
                <View className="flex-row items-center gap-3">
                  <Pressable
                    onPress={() => setGuests((g) => Math.max(1, g - 1))}
                    className="h-9 w-9 items-center justify-center rounded-xl border border-neutral-200"
                  >
                    <Ionicons name="remove" size={16} color="#737373" />
                  </Pressable>
                  <Text className="min-w-[24px] text-center text-base font-semibold text-neutral-800">{guests}</Text>
                  <Pressable
                    onPress={() => setGuests((g) => g + 1)}
                    className="h-9 w-9 items-center justify-center rounded-xl border border-neutral-200"
                  >
                    <Ionicons name="add" size={16} color="#737373" />
                  </Pressable>
                </View>
              </View>

              {/* Min bedrooms */}
              <View>
                <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">Min bedrooms</Text>
                <View className="flex-row gap-2">
                  {MIN_BEDROOMS_OPTIONS.map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => setMinBedrooms(n)}
                      className={[
                        'h-9 min-w-[36px] items-center justify-center rounded-xl border px-2',
                        minBedrooms === n
                          ? 'border-coral-500 bg-coral-50'
                          : 'border-neutral-200 bg-white',
                      ].join(' ')}
                    >
                      <Text
                        className={`text-sm font-semibold ${minBedrooms === n ? 'text-coral-600' : 'text-neutral-600'}`}
                      >
                        {n === 5 ? '5+' : String(n)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Platform buttons */}
              <View className="flex-row gap-2 pt-1">
                {[
                  { label: 'Airbnb', url: buildAirbnbUrl(searchParams), color: '#E11D48', bg: '#FFE4E1' },
                  { label: 'VRBO', url: buildVrboUrl(searchParams), color: '#2563EB', bg: '#E0ECFF' },
                  { label: 'Booking.com', url: buildBookingUrl(searchParams), color: '#1E3A5F', bg: '#E0E8F0' },
                ].map((p) => (
                  <Pressable
                    key={p.label}
                    onPress={() => Linking.openURL(p.url)}
                    className="flex-1 items-center justify-center rounded-xl py-2.5"
                    style={{ backgroundColor: p.bg }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: p.color }}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>

        {/* ── Section B: Add a property ── */}
        {!atLimit ? (
          <View
            className="mb-4 rounded-2xl bg-white p-4"
            style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }}
          >
            <Text className="mb-3 text-sm font-semibold text-neutral-700">Add a property</Text>

            {/* URL paste row */}
            <View className="mb-2 flex-row items-center gap-2">
              <TextInput
                value={pasteUrl}
                onChangeText={(v) => { setPasteUrl(v); setUrlError(''); setUrlParsed(null); }}
                placeholder="Paste listing URL…"
                placeholderTextColor="#A3A3A3"
                className="flex-1 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-800"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Pressable
                onPress={handleAddFromUrl}
                disabled={!pasteUrl.trim()}
                className={`rounded-xl px-4 py-3 ${pasteUrl.trim() ? 'bg-coral-500' : 'bg-neutral-200'}`}
              >
                <Text className={`text-sm font-semibold ${pasteUrl.trim() ? 'text-white' : 'text-neutral-400'}`}>Add</Text>
              </Pressable>
            </View>

            {urlError ? (
              <Text className="mb-2 text-xs text-red-500">{urlError}</Text>
            ) : null}

            {/* Mini form after URL parsed */}
            {urlParsed && !urlError ? (
              <View className="mb-3 gap-2 rounded-xl bg-neutral-50 p-3">
                <View className="flex-row items-center gap-2">
                  <View style={{ backgroundColor: PLATFORM_COLORS[urlParsed.platform].bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: PLATFORM_COLORS[urlParsed.platform].text }}>{PLATFORM_COLORS[urlParsed.platform].label}</Text>
                  </View>
                  <Text className="text-xs text-neutral-400" numberOfLines={1}>{urlParsed.cleanUrl}</Text>
                </View>
                <TextInput
                  value={urlTitle}
                  onChangeText={setUrlTitle}
                  placeholder="Property name"
                  placeholderTextColor="#A3A3A3"
                  className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800"
                  autoFocus
                />
                <TextInput
                  value={urlNotes}
                  onChangeText={setUrlNotes}
                  placeholder="Notes (optional)"
                  placeholderTextColor="#A3A3A3"
                  className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800"
                />
                <Pressable
                  onPress={handleConfirmUrlAdd}
                  disabled={createOption.isPending}
                  className="items-center rounded-xl bg-coral-500 py-2.5"
                >
                  {createOption.isPending ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text className="text-sm font-semibold text-white">Add property</Text>
                  )}
                </Pressable>
              </View>
            ) : null}

            {/* Manual link */}
            <Pressable
              onPress={() => setManualSheet({ ...DEFAULT_MANUAL_SHEET, visible: true })}
              className="flex-row items-center gap-1 self-start"
            >
              <Ionicons name="add-circle-outline" size={14} color="#FF6B5B" />
              <Text className="text-xs font-medium text-coral-500">Or add manually</Text>
            </Pressable>
          </View>
        ) : null}

        {/* ── Section C: Property cards ── */}
        {options.length === 0 ? (
          <View className="mt-4 items-center gap-2 py-8">
            <Ionicons name="home-outline" size={32} color="#D4D4D4" />
            <Text className="text-sm font-semibold text-neutral-400">No properties yet</Text>
            <Text className="text-center text-xs text-neutral-400">
              Paste a listing URL or add manually above.
            </Text>
          </View>
        ) : (
          options.map((option) => (
            <PropertyCard
              key={option.id}
              option={option}
              onBook={() =>
                setBookingSheet({
                  ...DEFAULT_BOOKING_SHEET,
                  visible: true,
                  optionId: option.id,
                  checkInTime: option.check_in_time ?? '',
                  checkOutTime: option.check_out_time ?? '',
                  totalCost: option.total_cost_cents
                    ? (option.total_cost_cents / 100).toFixed(2)
                    : '',
                })
              }
              onDelete={() =>
                deleteOption.mutate(option.id, {
                  onError: () => Alert.alert('Error', 'Could not delete. Please try again.'),
                })
              }
              onMarkSettled={() => {}}
            />
          ))
        )}
      </ScrollView>

      {/* Booking confirmation sheet */}
      <BookingSheet
        state={bookingSheet}
        onClose={() => setBookingSheet(DEFAULT_BOOKING_SHEET)}
        onSave={handleBookingSave}
        saving={confirmBooking.isPending}
      />

      {/* Manual entry sheet */}
      <ManualEntrySheet
        state={manualSheet}
        onClose={() => setManualSheet(DEFAULT_MANUAL_SHEET)}
        onSave={handleManualSave}
        saving={createOption.isPending}
      />
    </View>
  );
}
