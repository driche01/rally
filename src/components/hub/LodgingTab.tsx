/**
 * LodgingTab — F7 Lodging Search + Deep-Link Handoff
 * Search panel, property add, and property card list.
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
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
import { useGetLodgingSuggestions } from '@/hooks/useAiSuggestions';
import type { LodgingSuggestion } from '@/lib/api/aiSuggestions';
import { useCreateBlock, useDeleteBlocksByType } from '@/hooks/useItinerary';
import type { LodgingOptionWithVotes, LodgingPlatform } from '@/types/database';
import { GROUP_SIZE_MIDPOINTS } from '@/types/database';
import { Button } from '@/components/ui';

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
  isEditing: boolean;
  confirmation: string;
  checkInTime: string;
  checkOutTime: string;
  totalCost: string;
}

const DEFAULT_BOOKING_SHEET: BookingSheetState = {
  visible: false,
  optionId: '',
  isEditing: false,
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
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#D9CCB6' }} />
            </View>

            <Text style={{ fontSize: 17, fontWeight: '700', color: '#163026' }}>{local.isEditing ? 'Edit booking' : 'Mark as booked'}</Text>

            <View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Confirmation #</Text>
              <TextInput
                value={local.confirmation}
                onChangeText={(v) => set('confirmation', v)}
                placeholder="e.g. ABC123"
                placeholderTextColor="#A3A3A3"
                style={{ borderWidth: 1.5, borderColor: '#D9CCB6', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#163026' }}
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
                  style={{ borderWidth: 1.5, borderColor: '#D9CCB6', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#163026' }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Check-out time</Text>
                <TextInput
                  value={local.checkOutTime}
                  onChangeText={(v) => set('checkOutTime', v)}
                  placeholder="e.g. 11:00 AM"
                  placeholderTextColor="#A3A3A3"
                  style={{ borderWidth: 1.5, borderColor: '#D9CCB6', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#163026' }}
                />
              </View>
            </View>

            <View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total cost</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#D9CCB6', borderRadius: 12, paddingHorizontal: 14 }}>
                <Text style={{ fontSize: 15, color: '#737373', marginRight: 4 }}>$</Text>
                <TextInput
                  value={local.totalCost}
                  onChangeText={(v) => set('totalCost', v.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  placeholderTextColor="#A3A3A3"
                  keyboardType="decimal-pad"
                  style={{ flex: 1, paddingVertical: 12, fontSize: 15, color: '#163026' }}
                />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button variant="secondary" onPress={onClose} fullWidth>
                  Cancel
                </Button>
              </View>
              <View style={{ flex: 2 }}>
                <Button
                  variant="primary"
                  onPress={() => onSave(local)}
                  loading={saving}
                  disabled={saving}
                  fullWidth
                >
                  Mark as booked
                </Button>
              </View>
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
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#D9CCB6' }} />
              </View>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#163026', marginBottom: 16 }}>Add property</Text>

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
                        borderColor: local.platform === p.value ? '#0F3F2E' : '#D9CCB6',
                        backgroundColor: local.platform === p.value ? '#FFF1F0' : 'white',
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: local.platform === p.value ? '#0F3F2E' : '#737373' }}>{p.label}</Text>
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
                style={{ borderWidth: 1.5, borderColor: '#D9CCB6', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#163026', marginBottom: 16 }}
                autoFocus
              />

              {/* URL */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Listing URL</Text>
              <TextInput
                value={local.url}
                onChangeText={(v) => set('url', v)}
                placeholder="https://…"
                placeholderTextColor="#A3A3A3"
                style={{ borderWidth: 1.5, borderColor: '#D9CCB6', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#163026', marginBottom: 16 }}
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
                    style={{ borderWidth: 1.5, borderColor: '#D9CCB6', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#163026' }}
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
                    style={{ borderWidth: 1.5, borderColor: '#D9CCB6', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#163026' }}
                    maxLength={10}
                  />
                </View>
              </View>

              {/* Total cost */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total cost</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#D9CCB6', borderRadius: 12, paddingHorizontal: 14, marginBottom: 16 }}>
                <Text style={{ fontSize: 15, color: '#737373', marginRight: 4 }}>$</Text>
                <TextInput
                  value={local.totalCost}
                  onChangeText={(v) => set('totalCost', v.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  placeholderTextColor="#A3A3A3"
                  keyboardType="decimal-pad"
                  style={{ flex: 1, paddingVertical: 12, fontSize: 15, color: '#163026' }}
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
                style={{ borderWidth: 1.5, borderColor: '#D9CCB6', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#163026', minHeight: 72, textAlignVertical: 'top', marginBottom: 16 }}
              />

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button variant="secondary" onPress={onClose} fullWidth>
                    Cancel
                  </Button>
                </View>
                <View style={{ flex: 2 }}>
                  <Button
                    variant="primary"
                    onPress={() => canSave && onSave(local)}
                    loading={saving}
                    disabled={!canSave || saving}
                    fullWidth
                  >
                    Add property
                  </Button>
                </View>
              </View>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ─── Lodging share helper ──────────────────────────────────────────────────

function buildLodgingShareText(option: LodgingOptionWithVotes): string {
  const platform = PLATFORM_COLORS[option.platform];
  const parts: string[] = [`🏠 ${option.title} (${platform.label})`];
  if (option.url) parts.push(`🔗 ${option.url}`);
  if (option.check_in_date && option.check_out_date) {
    parts.push(`📅 ${option.check_in_date} → ${option.check_out_date}`);
  }
  if (option.check_in_time || option.check_out_time) {
    const times: string[] = [];
    if (option.check_in_time) times.push(`Check-in: ${option.check_in_time}`);
    if (option.check_out_time) times.push(`Check-out: ${option.check_out_time}`);
    parts.push(times.join(' · '));
  }
  if (option.booking_confirmation) {
    parts.push(`Confirmation: ${option.booking_confirmation}`);
  }
  if (option.total_cost_cents) {
    parts.push(`Total: ${formatCents(option.total_cost_cents)}`);
  }
  if (option.notes) parts.push(option.notes);
  return parts.join('\n');
}

// ─── Swipe delete action ──────────────────────────────────────────────────────

function SwipeDeleteAction({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 76,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FF3B30',
        borderRadius: 16,
        marginLeft: 8,
        marginBottom: 12,
      }}
      accessibilityLabel="Delete property"
    >
      <Ionicons name="trash-outline" size={20} color="#fff" />
      <Text style={{ fontSize: 11, color: '#fff', marginTop: 3, fontWeight: '600' }}>Delete</Text>
    </Pressable>
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
  const swipeRef = useRef<Swipeable>(null);
  const platform = PLATFORM_COLORS[option.platform];
  const isBooked = option.status === 'booked';

  const dateRange =
    option.check_in_date && option.check_out_date
      ? `${option.check_in_date} → ${option.check_out_date}`
      : option.check_in_date
      ? `Check-in ${option.check_in_date}`
      : null;

  function handleSwipeDelete() {
    swipeRef.current?.close();
    Alert.alert('Delete property?', option.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  }

  function handleLongPress() {
    Alert.alert(option.title, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Delete property?', 'This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: onDelete },
          ]),
      },
    ]);
  }

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={() => <SwipeDeleteAction onPress={handleSwipeDelete} />}
      overshootRight={false}
    >
    <Pressable
      onPress={onBook}
      onLongPress={handleLongPress}
      className="mb-3 overflow-hidden rounded-2xl bg-card"
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
        <View className="flex-row items-center justify-between bg-green px-4 py-2">
          <Text className="text-xs font-semibold text-white">✓ Booked</Text>
          <Pressable
            onPress={async () => {
              try { await Share.share({ message: buildLodgingShareText(option) }); } catch {}
            }}
            className="flex-row items-center gap-1"
            accessibilityRole="button"
            accessibilityLabel="Share booking details"
          >
            <Ionicons name="share-outline" size={13} color="rgba(255,255,255,0.85)" />
            <Text className="text-xs font-medium text-white opacity-90">Share</Text>
          </Pressable>
        </View>
      ) : null}

      <View className="p-4 gap-2">
        {/* Header row */}
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 gap-1">
            <Text className="text-sm font-semibold text-ink" numberOfLines={2}>
              {option.title}
            </Text>
            {option.notes ? (
              <Text className="text-xs text-muted" numberOfLines={1}>{option.notes}</Text>
            ) : null}
          </View>
          <View className="flex-row items-center gap-2">
            {/* Platform badge */}
            <View style={{ backgroundColor: platform.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: platform.text }}>{platform.label}</Text>
            </View>
            {/* Status */}
            {option.status === 'voted' ? (
              <View className="rounded-xl bg-gold/40 px-2 py-0.5">
                <Text className="text-xs font-medium text-ink">Voted</Text>
              </View>
            ) : option.status === 'booked' ? (
              <View className="rounded-xl bg-green-soft px-2 py-0.5">
                <Text className="text-xs font-medium text-green-dark">Booked</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Details */}
        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          {dateRange ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name="calendar-outline" size={12} color="#A3A3A3" />
              <Text className="text-xs text-muted">{dateRange}</Text>
            </View>
          ) : null}
          {option.total_cost_cents != null ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name="cash-outline" size={12} color="#A3A3A3" />
              <Text className="text-xs font-medium text-muted">
                {formatCents(option.total_cost_cents)}
              </Text>
            </View>
          ) : null}
          {option.voteCount > 0 ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name="thumbs-up-outline" size={12} color="#A3A3A3" />
              <Text className="text-xs text-muted">{option.voteCount} votes</Text>
            </View>
          ) : null}
        </View>

        {/* Actions */}
        <View className="flex-row items-center gap-2 pt-1">
          {option.url ? (
            <Pressable
              onPress={() => Linking.openURL(option.url!)}
              className="flex-row items-center gap-1 rounded-xl border border-line px-3 py-1.5"
            >
              <Ionicons name="open-outline" size={12} color="#737373" />
              <Text className="text-xs font-medium text-muted">View listing</Text>
            </Pressable>
          ) : null}
          {!isBooked ? (
            <Pressable
              onPress={onBook}
              className="flex-row items-center gap-1 rounded-xl bg-green-soft px-3 py-1.5"
            >
              <Ionicons name="checkmark-circle-outline" size={12} color="#0F3F2E" />
              <Text className="text-xs font-medium text-green-dark">Mark as booked</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
    </Swipeable>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

// ─── AI Lodging Suggestion Card ───────────────────────────────────────────────

function LodgingAiSuggestionCard({
  tripId,
  onSelect,
}: {
  tripId: string;
  onSelect: (s: LodgingSuggestion) => void;
}) {
  const getSuggestions = useGetLodgingSuggestions(tripId);
  const [expanded, setExpanded] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const suggestions = getSuggestions.data ?? [];

  function handleGenerate() {
    if (suggestions.length > 0) {
      setExpanded((p) => !p);
      return;
    }
    getSuggestions.mutate(undefined, {
      onSuccess: () => setExpanded(true),
      onError: () => Alert.alert('Error', 'Could not get AI suggestions. Please try again.'),
    });
  }

  // No suggestions yet — show itinerary-style generate card
  if (suggestions.length === 0) {
    return (
      <View style={{ backgroundColor: '#EEF3F8', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#D8E4EE', gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="sparkles-outline" size={18} color="#1A4060" />
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#1A4060' }}>AI lodging suggestions</Text>
        </View>
        <Text style={{ fontSize: 13, color: '#4A6E8A', lineHeight: 18 }}>
          Rally will suggest 3 options based on your destination, dates, group size, and member preferences.
        </Text>
        <Pressable
          onPress={handleGenerate}
          disabled={getSuggestions.isPending}
          style={{ backgroundColor: '#1A4060', borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}
          accessibilityRole="button"
        >
          {getSuggestions.isPending ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFCF6' }}>Get suggestions</Text>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <View
      className="mb-4 overflow-hidden rounded-2xl bg-card"
      style={{ borderWidth: 1, borderColor: '#D8E4EE', shadowColor: '#1A4060', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 }}
    >
      <Pressable
        onPress={handleGenerate}
        className="flex-row items-center justify-between px-4 py-3"
        accessibilityRole="button"
      >
        <View className="flex-row items-center gap-2">
          <Ionicons name="sparkles-outline" size={15} color="#1A4060" />
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#1A4060' }}>AI lodging suggestions</Text>
        </View>
        {getSuggestions.isPending ? (
          <ActivityIndicator size="small" color="#1A4060" />
        ) : (
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={15}
            color="#A3A3A3"
          />
        )}
      </Pressable>

      {expanded && suggestions.length > 0 ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
          {suggestions.map((s: LodgingSuggestion) => (
            <Pressable
              key={s.index}
              onPress={() => setSelectedIndex(selectedIndex === s.index ? null : s.index)}
              style={{
                borderRadius: 12,
                borderWidth: selectedIndex === s.index ? 2 : 1,
                borderColor: selectedIndex === s.index ? '#1A4060' : '#D9CCB6',
                padding: 12,
                gap: 8,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#163026' }}>{s.label}</Text>
                  <Text style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{s.propertyType} · {s.idealFor}</Text>
                </View>
                {selectedIndex === s.index ? (
                  <View style={{ backgroundColor: '#1A4060', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: 'white' }}>Selected</Text>
                  </View>
                ) : s.estimatedNightlyRate ? (
                  <Text style={{ fontSize: 11, fontWeight: '500', color: '#888' }}>{s.estimatedNightlyRate}</Text>
                ) : null}
              </View>
              <Text style={{ fontSize: 12, color: '#555', lineHeight: 17 }}>{s.description}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {s.airbnbUrl ? (
                  <Pressable
                    onPress={() => Linking.openURL(s.airbnbUrl!)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FEF2F2', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#DC2626' }}>Airbnb</Text>
                    <Ionicons name="open-outline" size={10} color="#DC2626" />
                  </Pressable>
                ) : null}
                {s.vrboUrl ? (
                  <Pressable
                    onPress={() => Linking.openURL(s.vrboUrl!)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EFF6FF', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#2563EB' }}>VRBO</Text>
                    <Ionicons name="open-outline" size={10} color="#2563EB" />
                  </Pressable>
                ) : null}
                {s.bookingUrl ? (
                  <Pressable
                    onPress={() => Linking.openURL(s.bookingUrl!)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F8FAFC', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#475569' }}>Booking.com</Text>
                    <Ionicons name="open-outline" size={10} color="#475569" />
                  </Pressable>
                ) : null}
              </View>
            </Pressable>
          ))}
          {selectedIndex !== null ? (
            <Pressable
              onPress={() => {
                const s = suggestions.find((s: LodgingSuggestion) => s.index === selectedIndex);
                if (s) { onSelect(s); setExpanded(false); setSelectedIndex(null); }
              }}
              style={{ backgroundColor: '#1A4060', borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 4 }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: 'white' }}>
                Add "{suggestions.find((s: LodgingSuggestion) => s.index === selectedIndex)?.label}" to lodging
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function LodgingTab({ tripId, isPlanner = true }: { tripId: string; isPlanner?: boolean }) {
  const insets = useSafeAreaInsets();

  const { data: trip } = useTrip(tripId);
  const { data: options = [], isSuccess: optionsLoaded } = useLodgingOptions(tripId);
  const createOption = useCreateLodgingOption(tripId);
  const updateOption = useUpdateLodgingOption(tripId);
  const deleteOption = useDeleteLodgingOption(tripId);
  const confirmBooking = useConfirmLodgingBooking(tripId);
  const createBlock = useCreateBlock(tripId);
  const deleteBlocksByType = useDeleteBlocksByType(tripId);

  // Search / add state — start expanded when no options yet, collapse once options load
  const [searchExpanded, setSearchExpanded] = useState(true);
  const [addSectionExpanded, setAddSectionExpanded] = useState(true);
  const searchInitialized = useRef(false);
  useEffect(() => {
    if (optionsLoaded && !searchInitialized.current) {
      searchInitialized.current = true;
      if (options.length > 0) {
        setSearchExpanded(false);
        setAddSectionExpanded(false);
      }
    }
  }, [optionsLoaded, options.length]);
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
    const title = state.title.trim();
    createOption.mutate(
      {
        trip_id: tripId,
        platform: state.platform,
        title,
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
    const bookedOption = options.find((o) => o.id === state.optionId);
    const bookedTitle = bookedOption?.title ?? 'Accommodation';
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
        onSuccess: () => {
          setBookingSheet(DEFAULT_BOOKING_SHEET);
          deleteBlocksByType.mutate('accommodation', {
            onSuccess: () => {
              if (!trip?.start_date) return;
              const start = new Date(trip.start_date + 'T12:00:00');
              const end = trip.end_date ? new Date(trip.end_date + 'T12:00:00') : start;
              const cur = new Date(start);
              while (cur <= end) {
                const dateStr = cur.toISOString().slice(0, 10);
                const isFirst = dateStr === trip.start_date;
                const isLast = dateStr === (trip.end_date ?? trip.start_date);
                const blockTitle = isFirst
                  ? `Check in: ${bookedTitle}`
                  : isLast
                  ? `Check out: ${bookedTitle}`
                  : bookedTitle;
                createBlock.mutate({
                  trip_id: tripId,
                  day_date: dateStr,
                  type: 'accommodation',
                  title: blockTitle,
                  lodging_option_id: state.optionId,
                  position: 0,
                });
                cur.setDate(cur.getDate() + 1);
              }
            },
          });
        },
        onError: () => Alert.alert('Error', 'Could not confirm booking. Please try again.'),
      }
    );
  }

  return (
    <View className="flex-1 bg-cream">
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between pt-4 pb-3">
          <Text className="text-base font-bold text-ink">Lodging</Text>
          {atLimit ? (
            <View className="rounded-xl bg-cream-warm px-3 py-1">
              <Text className="text-xs font-medium text-muted">Limit reached (5/5)</Text>
            </View>
          ) : null}
        </View>

        {/* ── AI Suggestions ── */}
        {isPlanner ? (
          <LodgingAiSuggestionCard
            tripId={tripId}
            onSelect={(s) => {
              setSearchExpanded(false);
              setAddSectionExpanded(false);
              createOption.mutate({
                trip_id: tripId,
                platform: 'manual',
                title: s.label,
                url: s.airbnbUrl ?? s.vrboUrl ?? s.bookingUrl ?? undefined,
                notes: [
                  s.description,
                  `Type: ${s.propertyType}`,
                  `Ideal for: ${s.idealFor}`,
                  s.estimatedNightlyRate ? `Estimated: ${s.estimatedNightlyRate}` : null,
                ].filter(Boolean).join('\n'),
                check_in_date: trip?.start_date ?? null,
                check_out_date: trip?.end_date ?? null,
              });
            }}
          />
        ) : null}

        {/* ── Section C: Property cards ── */}
        {options.length > 0 ? (
          options.map((option) => (
            <PropertyCard
              key={option.id}
              option={option}
              onBook={() =>
                setBookingSheet({
                  ...DEFAULT_BOOKING_SHEET,
                  visible: true,
                  optionId: option.id,
                  isEditing: option.status === 'booked',
                  confirmation: option.booking_confirmation ?? '',
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
        ) : null}

        {/* ── Section A: Search panel ── */}
        <View
          className="mb-4 overflow-hidden rounded-2xl bg-card"
          style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }}
        >
          <Pressable
            onPress={() => setSearchExpanded((p) => !p)}
            className="flex-row items-center justify-between px-4 py-3"
          >
            <View className="flex-row items-center gap-2">
              <Ionicons name="search-outline" size={16} color="#737373" />
              <Text className="text-sm font-semibold text-ink">Search for lodging</Text>
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
                <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Destination</Text>
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
                  <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Check-in</Text>
                  <TextInput
                    value={checkIn}
                    onChangeText={setCheckIn}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#A3A3A3"
                    className="rounded-xl border border-line bg-cream px-4 py-3 text-sm text-ink"
                    maxLength={10}
                  />
                </View>
                <View className="flex-1">
                  <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Check-out</Text>
                  <TextInput
                    value={checkOut}
                    onChangeText={setCheckOut}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#A3A3A3"
                    className="rounded-xl border border-line bg-cream px-4 py-3 text-sm text-ink"
                    maxLength={10}
                  />
                </View>
              </View>

              {/* Guests */}
              <View>
                <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Guests</Text>
                <View className="flex-row items-center gap-3">
                  <Pressable
                    onPress={() => setGuests((g) => Math.max(1, g - 1))}
                    className="h-9 w-9 items-center justify-center rounded-xl border border-line"
                  >
                    <Ionicons name="remove" size={16} color="#737373" />
                  </Pressable>
                  <Text className="min-w-[24px] text-center text-base font-semibold text-ink">{guests}</Text>
                  <Pressable
                    onPress={() => setGuests((g) => g + 1)}
                    className="h-9 w-9 items-center justify-center rounded-xl border border-line"
                  >
                    <Ionicons name="add" size={16} color="#737373" />
                  </Pressable>
                </View>
              </View>

              {/* Min bedrooms */}
              <View>
                <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Min bedrooms</Text>
                <View className="flex-row gap-2">
                  {MIN_BEDROOMS_OPTIONS.map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => setMinBedrooms(n)}
                      className={[
                        'h-9 min-w-[36px] items-center justify-center rounded-xl border px-2',
                        minBedrooms === n
                          ? 'border-green bg-green-soft'
                          : 'border-line bg-card',
                      ].join(' ')}
                    >
                      <Text
                        className={`text-sm font-semibold ${minBedrooms === n ? 'text-green-dark' : 'text-muted'}`}
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
            className="mb-4 overflow-hidden rounded-2xl bg-card"
            style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }}
          >
            <Pressable
              onPress={() => setAddSectionExpanded((p) => !p)}
              className="flex-row items-center justify-between px-4 py-3"
            >
              <View className="flex-row items-center gap-2">
                <Ionicons name="add-circle-outline" size={16} color="#737373" />
                <Text className="text-sm font-semibold text-ink">Add lodging</Text>
              </View>
              <Ionicons
                name={addSectionExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color="#A3A3A3"
              />
            </Pressable>
            {addSectionExpanded ? (
            <View className="px-4 pb-4">

            {/* URL paste row */}
            <View className="mb-2 flex-row items-center gap-2">
              <TextInput
                value={pasteUrl}
                onChangeText={(v) => { setPasteUrl(v); setUrlError(''); setUrlParsed(null); }}
                placeholder="Paste listing URL…"
                placeholderTextColor="#A3A3A3"
                className="flex-1 rounded-xl border border-line bg-cream px-4 py-3 text-sm text-ink"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Button
                variant="primary"
                onPress={handleAddFromUrl}
                disabled={!pasteUrl.trim()}
              >
                Add
              </Button>
            </View>

            {urlError ? (
              <Text className="mb-2 text-xs text-red-500">{urlError}</Text>
            ) : null}

            {/* Mini form after URL parsed */}
            {urlParsed && !urlError ? (
              <View className="mb-3 gap-2 rounded-xl bg-cream p-3">
                <View className="flex-row items-center gap-2">
                  <View style={{ backgroundColor: PLATFORM_COLORS[urlParsed.platform].bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: PLATFORM_COLORS[urlParsed.platform].text }}>{PLATFORM_COLORS[urlParsed.platform].label}</Text>
                  </View>
                  <Text className="text-xs text-muted" numberOfLines={1}>{urlParsed.cleanUrl}</Text>
                </View>
                <TextInput
                  value={urlTitle}
                  onChangeText={setUrlTitle}
                  placeholder="Property name"
                  placeholderTextColor="#A3A3A3"
                  className="rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink"
                  autoFocus
                />
                <TextInput
                  value={urlNotes}
                  onChangeText={setUrlNotes}
                  placeholder="Notes (optional)"
                  placeholderTextColor="#A3A3A3"
                  className="rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink"
                />
                <Button
                  variant="primary"
                  onPress={handleConfirmUrlAdd}
                  loading={createOption.isPending}
                  disabled={createOption.isPending}
                  fullWidth
                >
                  Add property
                </Button>
              </View>
            ) : null}

            {/* Manual link */}
            <Pressable
              onPress={() => setManualSheet({ ...DEFAULT_MANUAL_SHEET, visible: true })}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 10,
                borderRadius: 12,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: '#D9CCB6',
                marginTop: 8,
              }}
            >
              <Ionicons name="add-circle-outline" size={14} color="#D4D4D4" />
              <Text style={{ fontSize: 12, color: '#D0D0D0' }}>Or add manually</Text>
            </Pressable>
          </View>
            ) : null}
          </View>
        ) : null}

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
