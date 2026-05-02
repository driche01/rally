/**
 * LodgingTab — F7 Lodging Search + Deep-Link Handoff
 * Search panel, property add, and property card list.
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { EmptyState, FormField, Input, Pill, Sheet, Spinner } from '@/components/ui';
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
import { parseLodgingUrl, formatCents } from '@/lib/api/lodging';
import {
  useGetLodgingSuggestions,
  useGroupLodgingPrefSummary,
  type LodgingSuggestionsKeyDeps,
} from '@/hooks/useAiSuggestions';
import type {
  LodgingSuggestion,
  LodgingSuggestionsResult,
  RecommendedPlatform,
} from '@/lib/api/aiSuggestions';
import { computeLodgingSignature } from '@/lib/lodgingSignature';
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
    <Sheet
      visible={state.visible}
      onClose={onClose}
      title={local.isEditing ? 'Edit booking' : 'Mark as booked'}
    >
      <FormField label="Confirmation #">
        <Input
          value={local.confirmation}
          onChangeText={(v) => set('confirmation', v)}
          placeholder="e.g. ABC123"
          autoCapitalize="characters"
        />
      </FormField>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <FormField label="Check-in time">
            <Input
              value={local.checkInTime}
              onChangeText={(v) => set('checkInTime', v)}
              placeholder="e.g. 3:00 PM"
            />
          </FormField>
        </View>
        <View style={{ flex: 1 }}>
          <FormField label="Check-out time">
            <Input
              value={local.checkOutTime}
              onChangeText={(v) => set('checkOutTime', v)}
              placeholder="e.g. 11:00 AM"
            />
          </FormField>
        </View>
      </View>

      <FormField label="Total cost">
        <Input
          value={local.totalCost}
          onChangeText={(v) => set('totalCost', v.replace(/[^0-9.]/g, ''))}
          placeholder="$ 0.00"
          keyboardType="decimal-pad"
        />
      </FormField>

      <Sheet.Actions>
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
      </Sheet.Actions>
    </Sheet>
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
    <Sheet visible={state.visible} onClose={onClose} title="Add property">
      {/* Platform */}
      <FormField label="Platform">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {PLATFORMS.map((p) => (
              <Pill
                key={p.value}
                onPress={() => set('platform', p.value)}
                selected={local.platform === p.value}
                size="sm"
              >
                {p.label}
              </Pill>
            ))}
          </View>
        </ScrollView>
      </FormField>

      {/* Title */}
      <FormField label="Name" required>
        <Input
          value={local.title}
          onChangeText={(v) => set('title', v)}
          placeholder="e.g. Cozy Cabin in the Woods"
          autoFocus
        />
      </FormField>

      {/* URL */}
      <FormField label="Listing URL">
        <Input
          value={local.url}
          onChangeText={(v) => set('url', v)}
          placeholder="https://…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
      </FormField>

      {/* Dates */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <FormField label="Check-in">
            <Input
              value={local.checkIn}
              onChangeText={(v) => set('checkIn', v)}
              placeholder="YYYY-MM-DD"
              maxLength={10}
            />
          </FormField>
        </View>
        <View style={{ flex: 1 }}>
          <FormField label="Check-out">
            <Input
              value={local.checkOut}
              onChangeText={(v) => set('checkOut', v)}
              placeholder="YYYY-MM-DD"
              maxLength={10}
            />
          </FormField>
        </View>
      </View>

      {/* Total cost */}
      <FormField label="Total cost">
        <Input
          value={local.totalCost}
          onChangeText={(v) => set('totalCost', v.replace(/[^0-9.]/g, ''))}
          placeholder="$ 0.00"
          keyboardType="decimal-pad"
        />
      </FormField>

      {/* Notes */}
      <FormField label="Notes">
        <Input
          value={local.notes}
          onChangeText={(v) => set('notes', v)}
          placeholder="Any details…"
          multiline
        />
      </FormField>

      <Sheet.Actions>
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
      </Sheet.Actions>
    </Sheet>
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
//
// Visual language mirrors `ItineraryTab`'s AI card so both Hub tabs read as
// the same product. Outer card uses the warm cream surface (#EFE3D0) and
// deep-green title (#0F3F2E). Suggestion rows use the same white-with-shadow
// `BlockCard` pattern from itinerary, with a leading 32×32 colored icon to
// give visual continuity. Platform pills keep their brand colors (Airbnb red,
// VRBO blue, Booking.com slate) — those identities matter when handing off.

const SHEET_BG          = '#EFE3D0'; // warm cream — itinerary AI card surface
const SHEET_BORDER      = '#DDE8D8'; // subtle green-gray hairline
const TITLE_GREEN       = '#0F3F2E'; // deep green — primary brand
const BODY_MUTED        = '#4A6E8A'; // muted body copy (matches itinerary)
const INK               = '#163026';
const ICON_BG_GREEN     = '#DFE8D2'; // bg-green-soft — rentals/homes
const ICON_BG_GOLD      = '#F1E2A8'; // bg-gold/40 — hotels (warm "rest")

const PLATFORM_STYLE: Record<'airbnb' | 'vrbo' | 'booking', { bg: string; text: string; label: string }> = {
  airbnb:  { bg: '#FEF2F2', text: '#DC2626', label: 'Airbnb' },
  vrbo:    { bg: '#EFF6FF', text: '#2563EB', label: 'VRBO' },
  booking: { bg: '#F8FAFC', text: '#475569', label: 'Booking.com' },
};

function recommendedLabel(p: RecommendedPlatform): string {
  if (p === 'airbnb')  return 'Airbnb / VRBO';
  if (p === 'vrbo')    return 'VRBO / Airbnb';
  if (p === 'booking') return 'Booking.com';
  return 'Across Airbnb, VRBO & Booking.com';
}

function recommendedReason(p: RecommendedPlatform): string {
  if (p === 'airbnb' || p === 'vrbo') return 'Your group leans toward sharing a house.';
  if (p === 'booking')                return 'Your group leans toward their own hotel rooms.';
  return 'Your group is mixed — showing options across all three.';
}

/** Map a free-form propertyType ("villa", "Boutique Hotel", "B&B") to a leading
 *  icon + tile color, matching the itinerary's BlockCard pattern. */
function propertyVisual(propertyType: string): { icon: React.ComponentProps<typeof Ionicons>['name']; bg: string } {
  const t = propertyType.toLowerCase();
  if (/(hotel|motel|hostel|b&b|bed.?and.?breakfast|inn)/i.test(t)) {
    return { icon: 'bed-outline', bg: ICON_BG_GOLD };
  }
  if (/(apartment|condo|loft|studio)/i.test(t)) {
    return { icon: 'business-outline', bg: ICON_BG_GREEN };
  }
  // Default: villas, cottages, cabins, entire homes, treehouses, etc.
  return { icon: 'home-outline', bg: ICON_BG_GREEN };
}

function LodgingAiSuggestionCard({
  tripId,
  trip,
  onSelect,
}: {
  tripId: string;
  trip: ReturnType<typeof useTrip>['data'];
  onSelect: (s: LodgingSuggestion) => void;
}) {
  // Destination + dates are the only inputs the suggestions actually need.
  // Once the destination/dates polls land, those fields populate on the trip,
  // so this is effectively "polls decided." Don't gate on budget/trip_type —
  // those aren't required for sensible recommendations and the trip may have
  // skipped those screens.
  const stageReady = !!trip?.destination && !!trip?.start_date && !!trip?.end_date;

  const { data: prefSummary } = useGroupLodgingPrefSummary(tripId);

  const groupSize = trip?.group_size_precise
    ?? GROUP_SIZE_MIDPOINTS[trip?.group_size_bucket ?? '5-8'];

  // Two pieces of state for the regenerate flow:
  //  - `noteDraft` is the controlled textarea value (changes on every keystroke).
  //  - `committedNote` flows into the query key — only updates on Regenerate
  //    tap so we don't fire one Gemini call per keystroke.
  const [noteDraft, setNoteDraft] = useState('');
  const [committedNote, setCommittedNote] = useState('');

  const deps: LodgingSuggestionsKeyDeps = {
    destination: trip?.destination ?? null,
    startDate: trip?.start_date ?? null,
    endDate: trip?.end_date ?? null,
    groupSize,
    budgetPerPerson: trip?.budget_per_person ?? null,
    estimatedFlightCostPerPerson: trip?.estimated_flight_cost_per_person ?? null,
    prefSummary: prefSummary ?? null,
    note: committedNote,
  };

  // ── Server cache check (stale-while-revalidate) ────────────────────────
  // The trip row carries the suggestion payload (populated by the
  // `trip_warm_lodging_cache` trigger as soon as details lock in). We
  // render whatever is on the row IMMEDIATELY — no waiting on prefSummary
  // or any other query — so opening the tab is as instant as itinerary.
  //
  // In the background, once prefSummary lands, we verify the signature.
  // If it matches, nothing happens. If it mismatches (e.g. a late
  // respondent flipped their lodging_pref), we kick the edge function
  // for a silent refresh; React Query swaps the new data in when ready.
  //
  // The trip-row cache is the canonical NO-NOTE result — when the planner
  // has committed a steering note we ignore it (the result we want is the
  // note-tuned one in react-query's in-memory cache).
  const hasCommittedNote = committedNote.trim().length > 0;
  const tripCachedPayload: LodgingSuggestionsResult | null =
    !hasCommittedNote && trip?.cached_lodging_suggestions
      ? (trip.cached_lodging_suggestions as LodgingSuggestionsResult)
      : null;

  const expectedSignature = stageReady && prefSummary
    ? computeLodgingSignature({
        destination: trip?.destination ?? null,
        startDate: trip?.start_date ?? null,
        endDate: trip?.end_date ?? null,
        groupSize,
        budgetPerPerson: trip?.budget_per_person ?? null,
        flightCostPerPerson: trip?.estimated_flight_cost_per_person ?? null,
        tripType: trip?.trip_type ?? null,
        prefSummary,
      })
    : null;
  const cacheIsStale =
    !hasCommittedNote &&
    expectedSignature != null &&
    trip?.cached_lodging_suggestions_signature !== expectedSignature;

  // Fire the edge function when:
  //  - the trip row has nothing cached at all (first-ever open), OR
  //  - we have cache + prefSummary and the signatures don't match (silent refresh), OR
  //  - the planner committed a steering note (cache is bypassed by design).
  const query = useGetLodgingSuggestions(tripId, deps, {
    enabled: stageReady && (!tripCachedPayload || cacheIsStale || hasCommittedNote),
  });

  // Prefer the just-fetched payload (when present) over the row cache so
  // a successful refresh visibly updates the card.
  const result: LodgingSuggestionsResult | null = query.data ?? tripCachedPayload ?? null;
  const suggestions = result?.suggestions ?? [];
  const recommended: RecommendedPlatform = result?.recommendedPlatform ?? 'mixed';

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  function handleRegenerate() {
    const next = noteDraft.trim();
    if (next === committedNote.trim()) {
      // Same note as last time — react-query won't auto-refetch on key
      // equality, so nudge it manually.
      void query.refetch();
    } else {
      setCommittedNote(next);
    }
    setSelectedIndex(null);
  }

  // Pre-stage state — the suggestions can't run yet because polls aren't decided.
  if (!stageReady) {
    return (
      <View style={{ backgroundColor: SHEET_BG, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: SHEET_BORDER, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="sparkles" size={18} color={TITLE_GREEN} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: TITLE_GREEN }}>Lodging suggestions</Text>
        </View>
        <Text style={{ fontSize: 13, color: BODY_MUTED, lineHeight: 18 }}>
          Once the destination and dates are locked in, Rally will recommend lodging tailored to your group's preferences and budget.
        </Text>
      </View>
    );
  }

  const recommendedPlatforms: ('airbnb' | 'vrbo' | 'booking')[] =
    recommended === 'mixed'   ? ['airbnb', 'vrbo', 'booking']
  : recommended === 'airbnb'  ? ['airbnb', 'vrbo']  // rentals → both rental marketplaces
  : recommended === 'vrbo'    ? ['vrbo', 'airbnb']
  : ['booking'];

  const isFirstFetch = (query.isLoading || query.isFetching) && suggestions.length === 0;
  const isRegenFetch = query.isFetching && suggestions.length > 0;

  return (
    <View style={{ marginBottom: 16, gap: 12 }}>
      {/* Cream tan sheet — controls only. Mirrors itinerary's AI card so
          both Hub tabs read as the same product. */}
      <View style={{ backgroundColor: SHEET_BG, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: SHEET_BORDER, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="sparkles" size={16} color={TITLE_GREEN} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: TITLE_GREEN, flex: 1 }}>
            Lodging suggestions for your group
          </Text>
          {isRegenFetch ? <Spinner /> : null}
        </View>
        <Text style={{ fontSize: 12, color: BODY_MUTED, lineHeight: 17 }}>
          Tap an option below to add it. Want different vibes? Add a note and regenerate.
        </Text>
        <TextInput
          value={noteDraft}
          onChangeText={setNoteDraft}
          placeholder="e.g. more boutique hotels, near the beach"
          placeholderTextColor="#a3a3a3"
          multiline
          maxLength={280}
          style={{
            backgroundColor: 'white',
            borderRadius: 10,
            borderWidth: 1,
            borderColor: SHEET_BORDER,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontSize: 13,
            color: INK,
            minHeight: 60,
            textAlignVertical: 'top',
          }}
        />
        <Button
          variant="primary"
          fullWidth
          onPress={handleRegenerate}
          disabled={query.isFetching}
          loading={query.isFetching}
        >
          Regenerate
        </Button>
      </View>

      {/* Below the sheet, on the page background — Recommended banner +
          option cards. Visually mirrors itinerary's day cards. */}
      {isFirstFetch ? (
        <View style={{ paddingVertical: 24, alignItems: 'center', gap: 8 }}>
          <Spinner />
          <Text style={{ fontSize: 12, color: BODY_MUTED }}>
            Finding lodging that matches your group…
          </Text>
        </View>
      ) : query.isError && suggestions.length === 0 ? (
        <View style={{ padding: 16, borderRadius: 16, backgroundColor: '#FFFCF6', borderWidth: 1, borderColor: SHEET_BORDER, gap: 8 }}>
          <Text style={{ fontSize: 13, color: BODY_MUTED }}>
            Couldn't generate suggestions just now.
          </Text>
          <Button variant="primary" onPress={() => query.refetch()} fullWidth>
            Try again
          </Button>
        </View>
      ) : suggestions.length === 0 ? null : (
        <>
          {/* Recommended-for-your-group banner */}
          <View style={{ padding: 12, borderRadius: 12, backgroundColor: '#FFFCF6', borderWidth: 1, borderColor: SHEET_BORDER, gap: 2 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: BODY_MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Recommended for your group
            </Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: TITLE_GREEN }}>
              {recommendedLabel(recommended)}
            </Text>
            <Text style={{ fontSize: 12, color: BODY_MUTED, lineHeight: 17, marginTop: 2 }}>
              {recommendedReason(recommended)}
            </Text>
          </View>

          {/* Suggestions list — each row is an itinerary-style block card */}
          <View style={{ gap: 8 }}>
            {suggestions.map((s: LodgingSuggestion) => {
          const isSelected = selectedIndex === s.index;
          const visual = propertyVisual(s.propertyType);
          return (
            <Pressable
              key={s.index}
              onPress={() => setSelectedIndex(isSelected ? null : s.index)}
              style={{
                backgroundColor: '#FFFCF6',
                borderRadius: 16,
                borderWidth: isSelected ? 2 : 1,
                borderColor: isSelected ? TITLE_GREEN : SHEET_BORDER,
                padding: 12,
                gap: 10,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.06,
                shadowRadius: 6,
                elevation: 2,
              }}
            >
              {/* Top row: icon + title/subtitle column + selected badge.
                  Price moves to its own line below so the title and
                  property-type subtitle aren't squeezed and don't truncate
                  on small phones. */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 12, backgroundColor: visual.bg, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  <Ionicons name={visual.icon} size={16} color={TITLE_GREEN} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: INK }}>
                    {s.label}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#9DA8A0', lineHeight: 16 }}>
                    {s.propertyType} · {s.idealFor}
                  </Text>
                  {s.estimatedNightlyRate ? (
                    <Text style={{ fontSize: 12, fontWeight: '600', color: TITLE_GREEN, marginTop: 2 }}>
                      {s.estimatedNightlyRate}
                    </Text>
                  ) : null}
                </View>
                {isSelected ? (
                  <View style={{ backgroundColor: TITLE_GREEN, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: 'white' }}>Selected</Text>
                  </View>
                ) : null}
              </View>

              <Text style={{ fontSize: 13, color: '#3F4A45', lineHeight: 18 }}>
                {s.description}
              </Text>

              {/* Platform pills — keep brand colors so the handoff reads right */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(['airbnb', 'vrbo', 'booking'] as const).map((p) => {
                  const url = p === 'airbnb' ? s.airbnbUrl : p === 'vrbo' ? s.vrboUrl : s.bookingUrl;
                  if (!url) return null;
                  const isRecommended = recommendedPlatforms.includes(p);
                  const style = PLATFORM_STYLE[p];
                  return (
                    <Pressable
                      key={p}
                      onPress={() => Linking.openURL(url)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        backgroundColor: isRecommended ? style.text : style.bg,
                        borderRadius: 999,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '700', color: isRecommended ? 'white' : style.text }}>
                        {style.label}
                      </Text>
                      <Ionicons name="open-outline" size={10} color={isRecommended ? 'white' : style.text} />
                    </Pressable>
                  );
                })}
              </View>
            </Pressable>
          );
        })}
      </View>

          {selectedIndex !== null ? (
            <Button
              variant="primary"
              fullWidth
              onPress={() => {
                const s = suggestions.find((s: LodgingSuggestion) => s.index === selectedIndex);
                if (s) { onSelect(s); setSelectedIndex(null); }
              }}
            >
              {`Add "${suggestions.find((s: LodgingSuggestion) => s.index === selectedIndex)?.label}" to lodging`}
            </Button>
          ) : null}
        </>
      )}
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

  const [addSectionExpanded, setAddSectionExpanded] = useState(true);
  const addSectionInitialized = useRef(false);
  useEffect(() => {
    if (optionsLoaded && !addSectionInitialized.current) {
      addSectionInitialized.current = true;
      if (options.length > 0) setAddSectionExpanded(false);
    }
  }, [optionsLoaded, options.length]);

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

  // Pre-stage empty state — no destination/dates yet AND no manually-added
  // lodging. Mirrors the Itinerary empty state so the page reads
  // consistently across tabs while details are still being decided.
  const stageReady = !!trip?.destination && !!trip?.start_date && !!trip?.end_date;
  if (!stageReady && options.length === 0) {
    return (
      <View className="flex-1 bg-cream">
        <View className="flex-row items-center justify-between px-5 pt-4 pb-3">
          <Text className="text-base font-bold text-ink">Lodging</Text>
        </View>
        <View className="flex-1 justify-center">
          <EmptyState
            icon="bed-outline"
            title="Lodging suggestions"
            body="Once the destination and dates are locked in, Rally will recommend lodging tailored to your group's preferences and budget."
          />
        </View>
      </View>
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
            trip={trip}
            onSelect={(s) => {
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

        {/* ── Add a property ── */}
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
              <View style={{ flex: 1 }}>
                <Input
                  value={pasteUrl}
                  onChangeText={(v) => { setPasteUrl(v); setUrlError(''); setUrlParsed(null); }}
                  placeholder="Paste listing URL…"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>
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
                <Input
                  value={urlTitle}
                  onChangeText={setUrlTitle}
                  placeholder="Property name"
                  autoFocus
                />
                <Input
                  value={urlNotes}
                  onChangeText={setUrlNotes}
                  placeholder="Notes (optional)"
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
