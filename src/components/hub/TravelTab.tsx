/**
 * TravelTab — coordinate flights, trains, cars, and other transport.
 * Legs are persisted to Supabase. Planners can mark legs as "share with group"
 * so they appear in the group section. Swipe left to delete a leg.
 */
import { useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useTrip, useUpdateTrip } from '@/hooks/useTrips';
import { DateRangePicker } from '@/components/DateRangePicker';
import {
  useCreateTravelLeg,
  useDeleteTravelLeg,
  useSharedMemberLegs,
  useTravelLegs,
  useUpdateTravelLeg,
} from '@/hooks/useTravelLegs';
import { useTravelSuggestionsQuery, useMemberTravelSuggestions } from '@/hooks/useAiSuggestions';
import { useRespondentsWithTravelInfo } from '@/hooks/useRespondents';
import { useMyProfile } from '@/hooks/useProfile';
import { computeTravelSignature } from '@/lib/travelSignature';
import type { TravelSuggestion } from '@/lib/api/aiSuggestions';
import type { RespondentWithTravelInfo } from '@/lib/api/respondents';
import type { TravelLeg, TransportMode, Trip } from '@/types/database';
import { Avatar, Button, EmptyState, FormField, Input, Pill, Sheet, Spinner, Toggle } from '@/components/ui';

/**
 * Extract a per-person round-trip USD number from suggestion cost strings like
 * "$150–250 each way", "$300 round-trip", "~$500". Returns null if unparseable.
 * Used to size the lodging budget once a flight suggestion is locked in.
 */
function parseEstimatedFlightCost(raw: string | null): number | null {
  if (!raw) return null;
  const nums = Array.from(raw.matchAll(/\$?\s*([\d,]+(?:\.\d+)?)/g))
    .map((m) => parseFloat(m[1].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return null;
  const midpoint = nums.length === 1 ? nums[0] : (nums[0] + nums[1]) / 2;
  return /each\s*way|one[-\s]*way/i.test(raw) ? Math.round(midpoint * 2) : Math.round(midpoint);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const MODE_CONFIG: Record<
  TransportMode,
  {
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    searchUrl: (q: string) => string;
  }
> = {
  flight: {
    label: 'Flight',
    icon: 'airplane-outline',
    searchUrl: (q) => `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`,
  },
  train: {
    label: 'Train',
    icon: 'train-outline',
    searchUrl: (q) => `https://www.google.com/search?q=train+${encodeURIComponent(q)}`,
  },
  car: {
    label: 'Car',
    icon: 'car-outline',
    searchUrl: (q) => `https://www.google.com/maps/dir/${encodeURIComponent(q)}`,
  },
  ferry: {
    label: 'Ferry',
    icon: 'boat-outline',
    searchUrl: (q) => `https://www.google.com/search?q=ferry+${encodeURIComponent(q)}`,
  },
  bus: {
    label: 'Bus',
    icon: 'bus-outline',
    searchUrl: (q) => `https://www.google.com/search?q=bus+${encodeURIComponent(q)}`,
  },
  other: {
    label: 'Other',
    icon: 'navigate-outline',
    searchUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
};

const MODES: TransportMode[] = ['flight', 'train', 'car', 'ferry', 'bus', 'other'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatLegDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

function buildShareText(leg: TravelLeg): string {
  const cfg = MODE_CONFIG[leg.mode as TransportMode];
  const parts: string[] = [`${cfg.label}: ${leg.label}`];
  if (leg.departure_date || leg.departure_time) {
    parts.push(`Departs: ${[leg.departure_date ? formatLegDate(leg.departure_date) : '', leg.departure_time].filter(Boolean).join(' at ')}`);
  }
  if (leg.arrival_date || leg.arrival_time) {
    parts.push(`Arrives: ${[leg.arrival_date ? formatLegDate(leg.arrival_date) : '', leg.arrival_time].filter(Boolean).join(' at ')}`);
  }
  if (leg.booking_ref) parts.push(`Booking ref: ${leg.booking_ref}`);
  if (leg.notes) parts.push(leg.notes);
  return parts.join('\n');
}

// ─── Form values ──────────────────────────────────────────────────────────────

interface LegFormValues {
  mode: TransportMode;
  label: string;
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
  bookingRef: string;
  notes: string;
  shareWithGroup: boolean;
}

// ─── LegForm ──────────────────────────────────────────────────────────────────

function LegForm({
  tripName,
  tripStartDate,
  tripEndDate,
  initialValues,
  saving,
  onSave,
  onCancel,
}: {
  tripName: string;
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  initialValues?: TravelLeg;
  saving?: boolean;
  onSave: (values: LegFormValues) => void;
  onCancel: () => void;
}) {
  const isEditing = Boolean(initialValues);
  const [mode, setMode] = useState<TransportMode>((initialValues?.mode as TransportMode) ?? 'flight');
  const [label, setLabel] = useState(initialValues?.label ?? '');
  const [departureDate, setDepartureDate] = useState(initialValues?.departure_date ?? tripStartDate ?? '');
  const [departureTime, setDepartureTime] = useState(initialValues?.departure_time ?? '');
  const [arrivalDate, setArrivalDate] = useState(
    initialValues?.arrival_date ?? tripEndDate ?? tripStartDate ?? '',
  );
  const [arrivalTime, setArrivalTime] = useState(initialValues?.arrival_time ?? '');
  const [bookingRef, setBookingRef] = useState(initialValues?.booking_ref ?? '');
  const [notes, setNotes] = useState(initialValues?.notes ?? '');
  const [shareWithGroup, setShareWithGroup] = useState(initialValues?.shared_with_group ?? false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);

  function handleSearch() {
    const query = label.trim() || tripName;
    Linking.openURL(MODE_CONFIG[mode].searchUrl(query));
  }

  function handleSave() {
    if (!label.trim()) {
      Alert.alert('Missing info', 'Please add a description (e.g. "JFK → LAX").');
      return;
    }
    onSave({
      mode,
      label: label.trim(),
      departureDate,
      departureTime,
      arrivalDate,
      arrivalTime,
      bookingRef: bookingRef.trim(),
      notes: notes.trim(),
      shareWithGroup,
    });
  }

  return (
    <View style={{ gap: 14 }}>
      {/* Mode selector */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {MODES.map((m) => (
          <Pill
            key={m}
            onPress={() => setMode(m)}
            selected={mode === m}
            leadingIcon={MODE_CONFIG[m].icon}
            size="sm"
          >
            {MODE_CONFIG[m].label}
          </Pill>
        ))}
      </View>

      {/* Description + search */}
      <FormField label="Description">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Input
              placeholder={
                mode === 'flight'
                  ? 'e.g. JFK → LAX'
                  : mode === 'car'
                  ? 'e.g. Drive to Yosemite'
                  : `e.g. ${MODE_CONFIG[mode].label} to destination`
              }
              value={label}
              onChangeText={setLabel}
            />
          </View>
          <Pressable
            onPress={handleSearch}
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              backgroundColor: '#EFE3D0',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityLabel={`Search ${MODE_CONFIG[mode].label}`}
          >
            <Ionicons name="search-outline" size={20} color="#5F685F" />
          </Pressable>
        </View>
      </FormField>

      {/* Dates — calendar picker */}
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Dates
        </Text>
        <Pressable
          onPress={() => setDatePickerVisible(true)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            height: 44,
            borderWidth: 1.5,
            borderColor: '#D9CCB6',
            borderRadius: 10,
            paddingHorizontal: 12,
            backgroundColor: '#FBF7EF',
          }}
          accessibilityRole="button"
          accessibilityLabel="Select departure and arrival dates"
        >
          <Ionicons name="calendar-outline" size={16} color="#888" />
          {departureDate ? (
            <Text style={{ flex: 1, fontSize: 14, color: '#163026' }}>
              {formatLegDate(departureDate)}
              {arrivalDate && arrivalDate !== departureDate ? ` → ${formatLegDate(arrivalDate)}` : ''}
            </Text>
          ) : (
            <Text style={{ flex: 1, fontSize: 14, color: '#A8A8A8' }}>Select dates</Text>
          )}
          {departureDate ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                setDepartureDate('');
                setArrivalDate('');
              }}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={16} color="#CCC" />
            </Pressable>
          ) : null}
        </Pressable>
      </View>

      {/* Times — departure and arrival */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <FormField label="Departs">
            <Input
              placeholder="HH:MM"
              value={departureTime}
              onChangeText={setDepartureTime}
              keyboardType="numbers-and-punctuation"
            />
          </FormField>
        </View>
        <View style={{ flex: 1 }}>
          <FormField label="Arrives">
            <Input
              placeholder="HH:MM"
              value={arrivalTime}
              onChangeText={setArrivalTime}
              keyboardType="numbers-and-punctuation"
            />
          </FormField>
        </View>
      </View>

      <DateRangePicker
        visible={datePickerVisible}
        startDate={departureDate || null}
        endDate={arrivalDate || null}
        title="Travel dates"
        startLabel="Departure"
        endLabel="Arrival"
        confirmLabel="Set dates"
        allowPastDates
        onConfirm={(start, end) => {
          setDepartureDate(start ?? '');
          setArrivalDate(end ?? start ?? '');
        }}
        onClose={() => setDatePickerVisible(false)}
      />

      {/* Booking ref */}
      <FormField label="Confirmation / Booking ref" trailing={<Text style={{ fontSize: 11, color: '#888' }}>(optional)</Text>}>
        <Input
          placeholder="e.g. ABC123"
          value={bookingRef}
          onChangeText={setBookingRef}
          autoCapitalize="characters"
        />
      </FormField>

      {/* Notes */}
      <FormField label="Notes" trailing={<Text style={{ fontSize: 11, color: '#888' }}>(optional)</Text>}>
        <Input
          placeholder="e.g. Meet at Terminal 4, baggage claim"
          value={notes}
          onChangeText={setNotes}
          multiline
        />
      </FormField>

      {/* Share with group toggle */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 4,
          borderTopWidth: 1,
          borderTopColor: '#F3F3F3',
          paddingTop: 14,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#163026' }}>Share with group</Text>
          <Text style={{ fontSize: 12, color: '#888', lineHeight: 16 }}>
            Visible to all group members in their travel section
          </Text>
        </View>
        <Toggle
          value={shareWithGroup}
          onValueChange={setShareWithGroup}
        />
      </View>

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" onPress={onCancel} fullWidth size="lg">
            Cancel
          </Button>
        </View>
        <View style={{ flex: 2 }}>
          <Button
            variant="primary"
            onPress={handleSave}
            loading={saving}
            disabled={saving}
            fullWidth
            size="lg"
          >
            {isEditing ? 'Save changes' : 'Add leg'}
          </Button>
        </View>
      </View>
    </View>
  );
}

// ─── LegFormSheet — bottom sheet wrapper for LegForm ─────────────────────────

function LegFormSheet({
  visible,
  initialValues,
  tripName,
  tripStartDate,
  tripEndDate,
  saving,
  onSave,
  onClose,
}: {
  visible: boolean;
  initialValues?: TravelLeg;
  tripName: string;
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  saving?: boolean;
  onSave: (values: LegFormValues) => void;
  onClose: () => void;
}) {
  const isEditing = Boolean(initialValues);
  return (
    <Sheet visible={visible} onClose={onClose} title={isEditing ? 'Edit leg' : 'Add leg'}>
      <LegForm
        tripName={tripName}
        tripStartDate={tripStartDate}
        tripEndDate={tripEndDate}
        initialValues={initialValues}
        saving={saving}
        onSave={onSave}
        onCancel={onClose}
      />
    </Sheet>
  );
}

// ─── SwipeableDeleteAction ────────────────────────────────────────────────────

function DeleteAction({ onPress }: { onPress: () => void }) {
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
      }}
      accessibilityLabel="Delete leg"
    >
      <Ionicons name="trash-outline" size={20} color="#fff" />
      <Text style={{ fontSize: 11, color: '#fff', marginTop: 3, fontWeight: '600' }}>Delete</Text>
    </Pressable>
  );
}

// ─── LegCard ──────────────────────────────────────────────────────────────────

function LegCard({
  leg,
  onEdit,
  onDelete,
}: {
  leg: TravelLeg;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const swipeRef = useRef<Swipeable>(null);
  const cfg = MODE_CONFIG[leg.mode as TransportMode];

  function handleDelete() {
    if (!onDelete) return;
    swipeRef.current?.close();
    Alert.alert('Remove this leg?', leg.label, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: onDelete },
    ]);
  }

  async function handleShare() {
    try {
      await Share.share({ message: buildShareText(leg) });
    } catch {
      // user cancelled or not supported
    }
  }

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={onDelete ? () => <DeleteAction onPress={handleDelete} /> : undefined}
      overshootRight={false}
      friction={2}
    >
      <Pressable
        onPress={onEdit}
        accessibilityRole={onEdit ? 'button' : 'none'}
        accessibilityLabel={onEdit ? `Edit ${leg.label}` : undefined}
        style={({ pressed }) => ({
          backgroundColor: pressed ? '#F9F9F9' : '#fff',
          borderRadius: 16,
          padding: 16,
          borderWidth: 1,
          borderColor: '#EBEBEB',
          gap: 10,
        })}
      >
        {/* Top row: icon + label + share button */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: '#F3F3F3',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={cfg.icon} size={20} color="#555" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#163026' }}>{leg.label}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '500', color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {cfg.label}
              </Text>
              {leg.shared_with_group ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 3,
                    backgroundColor: '#E8F4EE',
                    borderRadius: 999,
                    paddingHorizontal: 7,
                    paddingVertical: 2,
                  }}
                >
                  <Ionicons name="people-outline" size={10} color="#235C38" />
                  <Text style={{ fontSize: 10, fontWeight: '600', color: '#235C38' }}>Shared</Text>
                </View>
              ) : null}
            </View>
          </View>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              handleShare();
            }}
            hitSlop={8}
            accessibilityLabel="Share leg details"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              backgroundColor: '#F3F3F3',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'}
              size={16}
              color="#555"
            />
          </Pressable>
        </View>

        {/* Departure / arrival */}
        {leg.departure_date || leg.departure_time || leg.arrival_date || leg.arrival_time ? (
          <View style={{ flexDirection: 'row', gap: 20 }}>
            {leg.departure_date || leg.departure_time ? (
              <View style={{ gap: 2 }}>
                <Text style={{ fontSize: 11, color: '#A8A8A8', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Departs
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#163026' }}>
                  {[leg.departure_date ? formatLegDate(leg.departure_date) : '', leg.departure_time]
                    .filter(Boolean)
                    .join(' ')}
                </Text>
              </View>
            ) : null}
            {leg.arrival_date || leg.arrival_time ? (
              <View style={{ gap: 2 }}>
                <Text style={{ fontSize: 11, color: '#A8A8A8', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Arrives
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#163026' }}>
                  {[leg.arrival_date ? formatLegDate(leg.arrival_date) : '', leg.arrival_time]
                    .filter(Boolean)
                    .join(' ')}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Booking ref */}
        {leg.booking_ref ? (
          <View
            style={{
              backgroundColor: '#F8F8F8',
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 6,
              alignSelf: 'flex-start',
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#555', fontVariant: ['tabular-nums'] }}>
              Ref: {leg.booking_ref}
            </Text>
          </View>
        ) : null}

        {/* Notes */}
        {leg.notes ? (
          <Text style={{ fontSize: 13, color: '#666', lineHeight: 18 }}>{leg.notes}</Text>
        ) : null}
      </Pressable>
    </Swipeable>
  );
}

// ─── MemberLegCard ────────────────────────────────────────────────────────────

function MemberLegCard({
  leg,
  respondentName,
}: {
  leg: TravelLeg;
  respondentName: string;
}) {
  const cfg = MODE_CONFIG[leg.mode as TransportMode];

  async function handleShare() {
    try {
      await Share.share({ message: buildShareText(leg) });
    } catch {}
  }

  return (
    <View
      style={{
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#EBEBEB',
        gap: 10,
      }}
    >
      {/* Member name */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Avatar name={respondentName} size="sm" />
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#555', flex: 1 }}>{respondentName}</Text>
        <Pressable
          onPress={handleShare}
          hitSlop={8}
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            backgroundColor: '#F3F3F3',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'}
            size={14}
            color="#555"
          />
        </Pressable>
      </View>

      {/* Leg info */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: '#F3F3F3',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={cfg.icon} size={18} color="#555" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#163026' }}>{leg.label}</Text>
          <Text style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {cfg.label}
          </Text>
        </View>
      </View>

      {leg.departure_date || leg.departure_time || leg.arrival_date || leg.arrival_time ? (
        <View style={{ flexDirection: 'row', gap: 20 }}>
          {leg.departure_date || leg.departure_time ? (
            <View style={{ gap: 1 }}>
              <Text style={{ fontSize: 11, color: '#A8A8A8', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Departs
              </Text>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#163026' }}>
                {[leg.departure_date ? formatLegDate(leg.departure_date) : '', leg.departure_time]
                  .filter(Boolean)
                  .join(' ')}
              </Text>
            </View>
          ) : null}
          {leg.arrival_date || leg.arrival_time ? (
            <View style={{ gap: 1 }}>
              <Text style={{ fontSize: 11, color: '#A8A8A8', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Arrives
              </Text>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#163026' }}>
                {[leg.arrival_date ? formatLegDate(leg.arrival_date) : '', leg.arrival_time]
                  .filter(Boolean)
                  .join(' ')}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {leg.booking_ref ? (
        <View
          style={{
            backgroundColor: '#F8F8F8',
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 5,
            alignSelf: 'flex-start',
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: '600', color: '#555' }}>Ref: {leg.booking_ref}</Text>
        </View>
      ) : null}

      {leg.notes ? (
        <Text style={{ fontSize: 12, color: '#666', lineHeight: 17 }}>{leg.notes}</Text>
      ) : null}
    </View>
  );
}

// ─── Travel Suggestion Card ───────────────────────────────────────────────────

const MODE_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  flight: 'airplane-outline',
  train: 'train-outline',
  car: 'car-outline',
  ferry: 'boat-outline',
  bus: 'bus-outline',
  other: 'navigate-outline',
};

// Icon-bg palette uses tokens from the lodging/itinerary system so all three
// hub tabs read as one product. Each mode gets its own color so the three
// most common (flight, train, bus) are visually distinct at a glance.
const MODE_ICON_BG: Record<TransportMode, string> = {
  flight: '#F1E2A8', // gold — sky/premium
  train:  '#DFE8D2', // green — relaxed/scenic
  bus:    '#FFF4F2', // peach — utilitarian/warm
  car:    '#EFE3D0', // sand — road trip neutral
  ferry:  '#D8E8E0', // soft teal — water
  other:  '#EFE3D0', // sand — neutral fallback
};

function TravelSuggestionCard({
  tripId,
  trip,
  enabled,
  /** When set, suggestions are scoped to this single traveler (their home airport + dealbreakers). */
  respondentPhone = null,
  title = 'Travel suggestions for your group',
  loadingMessage = 'Finding the best routes from your home airport…',
  onApply,
}: {
  tripId: string;
  /** Trip row — used to read the `cached_travel_suggestions` payload directly for instant render. */
  trip: Trip | undefined;
  /** Auto-fire on mount only when the trip has the inputs it needs (destination + dates). */
  enabled: boolean;
  respondentPhone?: string | null;
  title?: string;
  loadingMessage?: string;
  onApply?: (s: TravelSuggestion) => void;
}) {
  // Group-scope cache lives on the trip row (warmed by trip_warm_travel_cache
  // trigger). Member-scope queries always go through the edge function — there
  // is no per-member cache yet. The trip-row read is what makes the Travel
  // tab open instantly, just like Itinerary's stored draft.
  const isGroupScope = !respondentPhone;

  // Steering-note state mirrors lodging:
  //  - `noteDraft` is the controlled textarea (changes on every keystroke).
  //  - `committedNote` flows into the query key — only updates on Regenerate
  //    so we don't fire one Gemini call per keystroke.
  const [noteDraft, setNoteDraft] = useState('');
  const [committedNote, setCommittedNote] = useState('');
  const hasCommittedNote = committedNote.trim().length > 0;

  // When the planner has committed a steering note we ignore the trip-row
  // cache (it's the canonical no-note version) and let the query carry the
  // note-tuned result.
  const tripCachedPayload: TravelSuggestion[] | null =
    !hasCommittedNote && isGroupScope && Array.isArray(trip?.cached_travel_suggestions)
      ? (trip!.cached_travel_suggestions as TravelSuggestion[])
      : null;
  const expectedSignature =
    isGroupScope && trip
      ? computeTravelSignature({
          destination: trip.destination,
          startDate: trip.start_date,
          endDate: trip.end_date,
          groupSize: trip.group_size_precise ?? 4,
          budgetPerPerson: trip.budget_per_person,
          tripType: trip.trip_type,
        })
      : null;
  const cacheIsStale =
    !hasCommittedNote &&
    expectedSignature != null &&
    trip?.cached_travel_suggestions_signature !== expectedSignature;

  // Fire the edge function when:
  //  - we're in member scope (no row cache exists), OR
  //  - the trip row has nothing cached (first-ever open / pre-trigger trips), OR
  //  - the cache exists but the signature is stale (silent refresh), OR
  //  - the planner committed a steering note (cache is bypassed by design).
  const query = useTravelSuggestionsQuery(tripId, {
    enabled: enabled && (!isGroupScope || !tripCachedPayload || cacheIsStale || hasCommittedNote),
    respondentPhone,
    note: committedNote,
  });
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // Prefer the freshly-fetched payload over the row cache so a successful
  // refresh visibly updates the card.
  const suggestions = query.data?.suggestions ?? tripCachedPayload ?? [];
  const emptyReason = query.data?.reason ?? null;

  async function handleRetry() {
    const result = await query.refetch();
    if (result.error) {
      Alert.alert('Error', 'Could not load suggestions. Please try again.');
    }
  }

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

  // Pre-stage state — destination/dates missing. Show a simple message
  // without the Regenerate controls (no point steering an empty prompt).
  if (!enabled && suggestions.length === 0) {
    return (
      <View style={{ backgroundColor: '#EFE3D0', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#DDE8D8', gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="sparkles" size={16} color="#0F3F2E" />
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F3F2E', flex: 1 }}>{title}</Text>
        </View>
        <Text style={{ fontSize: 13, color: '#4A6E8A', lineHeight: 18 }}>
          {respondentPhone
            ? "Once the trip's destination and dates are locked in, route suggestions for you will appear here."
            : "Once the destination and dates are locked in, Rally will suggest the best routes from your home airport."}
        </Text>
      </View>
    );
  }

  const selected = selectedIndex != null
    ? suggestions.find((s) => s.index === selectedIndex) ?? null
    : null;
  const isFirstFetch = query.isLoading && suggestions.length === 0;
  const isRegenFetch = query.isFetching && suggestions.length > 0;
  const showControls = isGroupScope && enabled;

  return (
    <View style={{ marginBottom: 16, gap: 12 }}>
      {/* Cream tan controls sheet — mirrors lodging's split layout so both
          Hub tabs read as the same product. The textarea + Regenerate live
          here; suggestion cards render below on the page background. */}
      {showControls ? (
        <View style={{ backgroundColor: '#EFE3D0', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#DDE8D8', gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="sparkles" size={16} color="#0F3F2E" />
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F3F2E', flex: 1 }}>
              {title}
            </Text>
            {isRegenFetch ? <Spinner /> : null}
          </View>
          <Text style={{ fontSize: 12, color: '#4A6E8A', lineHeight: 17 }}>
            Tap an option below to add it. Want different vibes? Add a note and regenerate.
          </Text>
          <TextInput
            value={noteDraft}
            onChangeText={setNoteDraft}
            placeholder="e.g. more direct flights, no red-eyes"
            placeholderTextColor="#a3a3a3"
            multiline
            maxLength={280}
            style={{
              backgroundColor: 'white',
              borderRadius: 10,
              borderWidth: 1,
              borderColor: '#DDE8D8',
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 13,
              color: '#163026',
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
      ) : null}

      {/* Below the sheet, on the page background. Loading / empty / cards. */}
      {isFirstFetch ? (
        <View style={{ paddingVertical: 24, alignItems: 'center', gap: 8 }}>
          <Spinner />
          <Text style={{ fontSize: 12, color: '#4A6E8A' }}>{loadingMessage}</Text>
        </View>
      ) : suggestions.length === 0 ? (
        <View style={{ paddingVertical: 24, paddingHorizontal: 16, alignItems: 'center', gap: 10 }}>
          <Text style={{ fontSize: 13, color: '#4A6E8A', lineHeight: 18, textAlign: 'center' }}>
            {emptyReason === 'no_origin'
              ? respondentPhone
                ? "We don't have this traveler's home airport yet. Once they fill it in, route suggestions will appear here."
                : 'Set your home airport in your traveler profile so Rally can suggest routes from where you actually fly.'
              : 'No suggestions yet. Tap below to retry.'}
          </Text>
          {emptyReason !== 'no_origin' ? (
            <Pressable
              onPress={handleRetry}
              style={{ backgroundColor: '#0F3F2E', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 18 }}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFCF6' }}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {suggestions.map((s: TravelSuggestion) => {
            const isSelected = selectedIndex === s.index;
            return (
              <Pressable
                key={s.index}
                onPress={() => setSelectedIndex(isSelected ? null : s.index)}
                style={{
                  backgroundColor: '#FFFCF6',
                  borderRadius: 16,
                  borderWidth: isSelected ? 2 : 1,
                  borderColor: isSelected ? '#0F3F2E' : '#DDE8D8',
                  padding: 12,
                  gap: 10,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.06,
                  shadowRadius: 6,
                  elevation: 2,
                }}
                accessibilityRole="button"
                accessibilityLabel={`${s.label}, ${s.estimatedDuration}${s.estimatedCostPerPerson ? `, ${s.estimatedCostPerPerson}` : ''}`}
                accessibilityState={{ selected: isSelected }}
              >
                {/* Top row: icon + title/subtitle column + selected badge.
                    Cost moves under the subtitle so the title doesn't get
                    squeezed by a long price string on small phones. */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 12, backgroundColor: MODE_ICON_BG[s.mode] ?? '#EFE3D0', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                    <Ionicons name={MODE_ICON[s.mode] ?? 'navigate-outline'} size={16} color="#0F3F2E" />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#163026' }}>
                      {s.label}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#9DA8A0', lineHeight: 16 }}>
                      {MODE_CONFIG[s.mode]?.label ?? 'Travel'} · {s.estimatedDuration}
                    </Text>
                    {s.estimatedCostPerPerson ? (
                      <Text style={{ fontSize: 12, fontWeight: '600', color: '#0F3F2E', marginTop: 2 }}>
                        {s.estimatedCostPerPerson}
                      </Text>
                    ) : null}
                  </View>
                  {isSelected ? (
                    <View style={{ backgroundColor: '#0F3F2E', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: 'white' }}>Selected</Text>
                    </View>
                  ) : null}
                </View>

                <Text style={{ fontSize: 13, color: '#3F4A45', lineHeight: 18 }}>
                  {s.description}
                </Text>

                {/* Google pill — soft Google-blue tint + Google blue text mirrors
                    lodging's brand-tinted platform pills. */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  <Pressable
                    onPress={(e) => { e.stopPropagation(); Linking.openURL(s.searchUrl); }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: '#E8F0FE',
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                    }}
                    accessibilityLabel={`Search ${s.label} on Google`}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#1A73E8' }}>Google</Text>
                    <Ionicons name="open-outline" size={10} color="#1A73E8" />
                  </Pressable>
                </View>
              </Pressable>
            );
          })}

          {selected ? (
            <Button
              variant="primary"
              fullWidth
              onPress={() => {
                if (onApply) { onApply(selected); setSelectedIndex(null); }
              }}
            >
              {`Add "${selected.label}" as travel leg`}
            </Button>
          ) : null}
        </View>
      )}
    </View>
  );
}

// ─── Per-Member Routes Section (planner view) ────────────────────────────────
//
// Lists each respondent with their saved home airport. Each row has its own
// "Suggest route" button that lazy-fires a single suggest-travel call scoped
// to that one traveler. React-query caches results by [tripId, phone] so
// collapsing/expanding the section doesn't refetch.

function MemberRouteRow({
  tripId,
  member,
  onApply,
}: {
  tripId: string;
  member: RespondentWithTravelInfo;
  onApply?: (s: TravelSuggestion, member: RespondentWithTravelInfo) => void;
}) {
  const [requested, setRequested] = useState(false);
  const query = useMemberTravelSuggestions(tripId, member.phone, {
    enabled: requested && !!member.phone && !!member.home_airport,
  });
  const suggestions = query.data?.suggestions ?? [];
  const noAirport = !member.home_airport;

  return (
    <View style={{
      backgroundColor: '#FFFCF6',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: '#DDE8D8',
      padding: 12,
      gap: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 6,
      elevation: 2,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar name={member.name} size="sm" />
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#163026' }}>{member.name}</Text>
          <Text style={{ fontSize: 12, color: noAirport ? '#9DA8A0' : '#5F685F' }}>
            {noAirport ? 'No home airport saved' : `From ${member.home_airport}`}
          </Text>
        </View>
        {!requested && !noAirport ? (
          <Pressable
            onPress={() => setRequested(true)}
            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#0F3F2E' }}
            accessibilityRole="button"
            accessibilityLabel={`Suggest route for ${member.name}`}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFCF6' }}>Suggest route</Text>
          </Pressable>
        ) : null}
      </View>

      {requested && query.isPending ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Spinner />
          <Text style={{ fontSize: 12, color: '#9DA8A0' }}>Finding routes from {member.home_airport}…</Text>
        </View>
      ) : null}

      {requested && query.isError ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 12, color: '#B45252' }}>Could not load suggestions.</Text>
          <Pressable onPress={() => query.refetch()} hitSlop={6}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#0F3F2E' }}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {suggestions.length > 0 ? (
        <View style={{ gap: 6 }}>
          {suggestions.map((s) => (
            <Pressable
              key={s.index}
              onPress={() => onApply?.(s, member)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: '#EFE3D0' }}
              accessibilityRole="button"
              accessibilityLabel={`Apply ${s.label} for ${member.name}`}
            >
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: MODE_ICON_BG[s.mode] ?? '#EFE3D0', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={MODE_ICON[s.mode] ?? 'navigate-outline'} size={14} color="#0F3F2E" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#163026' }}>{s.label}</Text>
                <Text style={{ fontSize: 11, color: '#5F685F' }}>
                  {s.estimatedDuration}
                  {s.estimatedCostPerPerson ? ` · ${s.estimatedCostPerPerson}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color="#0F3F2E" />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PerMemberRoutesSection({
  tripId,
  onApply,
}: {
  tripId: string;
  onApply?: (s: TravelSuggestion, member: RespondentWithTravelInfo) => void;
}) {
  const { data: members = [], isLoading } = useRespondentsWithTravelInfo(tripId);
  const [expanded, setExpanded] = useState(false);

  if (isLoading || members.length === 0) return null;

  const withAirport = members.filter((m) => m.home_airport).length;

  return (
    <View style={{ marginBottom: 16, gap: 12 }}>
      {/* Sand sheet — header + collapsed-state hint mirrors the main
          suggestion card's controls sheet. Member rows render below on
          the page background as separate white-cream cards. */}
      <Pressable
        onPress={() => setExpanded((p) => !p)}
        style={{
          backgroundColor: '#EFE3D0',
          borderRadius: 16,
          padding: 16,
          borderWidth: 1,
          borderColor: '#DDE8D8',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
        accessibilityRole="button"
        accessibilityLabel="Toggle per-member travel routes"
      >
        <Ionicons name="people" size={16} color="#0F3F2E" />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F3F2E' }}>Routes by traveler</Text>
          <Text style={{ fontSize: 12, color: '#4A6E8A', marginTop: 2 }}>
            {withAirport}/{members.length} {members.length === 1 ? 'has' : 'have'} a home airport saved
          </Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#0F3F2E" />
      </Pressable>

      {expanded ? (
        <View style={{ gap: 8 }}>
          {members.map((m) => (
            <MemberRouteRow key={m.id} tripId={tripId} member={m} onApply={onApply} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function TravelTab({ tripId, isPlanner = true }: { tripId: string; isPlanner?: boolean }) {
  const { data: trip } = useTrip(tripId);
  const { data: legs = [], isLoading } = useTravelLegs(tripId);
  const { data: memberLegs = [] } = useSharedMemberLegs(tripId);
  // Personalized suggestions for the non-planner view need the viewer's phone.
  const { data: myProfile } = useMyProfile();
  const myPhone = myProfile?.phone ?? null;

  const createMutation = useCreateTravelLeg(tripId);
  const updateMutation = useUpdateTravelLeg(tripId);
  const deleteMutation = useDeleteTravelLeg(tripId);
  const updateTripMutation = useUpdateTrip();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingLeg, setEditingLeg] = useState<TravelLeg | null>(null);
  const [appliedSuggestion, setAppliedSuggestion] = useState<TravelSuggestion | null>(null);

  const isSaving = createMutation.isPending || updateMutation.isPending;
  // Auto-fire suggestions only when the trip has the inputs the prompt needs.
  const canAutoSuggest = Boolean(trip?.destination && trip?.start_date);

  async function handleAdd(values: LegFormValues) {
    try {
      await createMutation.mutateAsync({
        trip_id: tripId,
        respondent_id: null,
        mode: values.mode,
        label: values.label,
        departure_date: values.departureDate || null,
        departure_time: values.departureTime || null,
        arrival_date: values.arrivalDate || null,
        arrival_time: values.arrivalTime || null,
        booking_ref: values.bookingRef || null,
        notes: values.notes || null,
        shared_with_group: values.shareWithGroup,
      });
      // When a flight suggestion drove this add, persist its per-person cost
      // estimate to the trip so the lodging suggester can subtract it from
      // the per-person budget.
      if (
        appliedSuggestion?.mode === 'flight' &&
        trip?.estimated_flight_cost_per_person == null
      ) {
        const cost = parseEstimatedFlightCost(appliedSuggestion.estimatedCostPerPerson);
        if (cost != null) {
          updateTripMutation.mutate({ id: tripId, estimated_flight_cost_per_person: cost });
        }
      }
      setShowAddForm(false);
      setAppliedSuggestion(null);
    } catch {
      Alert.alert('Error', 'Could not save travel leg. Please try again.');
    }
  }

  async function handleUpdate(values: LegFormValues) {
    if (!editingLeg) return;
    try {
      await updateMutation.mutateAsync({
        id: editingLeg.id,
        updates: {
          mode: values.mode,
          label: values.label,
          departure_date: values.departureDate || null,
          departure_time: values.departureTime || null,
          arrival_date: values.arrivalDate || null,
          arrival_time: values.arrivalTime || null,
          booking_ref: values.bookingRef || null,
          notes: values.notes || null,
          shared_with_group: values.shareWithGroup,
        },
      });
      setEditingLeg(null);
    } catch {
      Alert.alert('Error', 'Could not update travel leg. Please try again.');
    }
  }

  function handleDelete(id: string) {
    deleteMutation.mutate(id, {
      onError: () => Alert.alert('Error', 'Could not delete travel leg. Please try again.'),
    });
  }

  function handleCancel() {
    setShowAddForm(false);
    setEditingLeg(null);
    setAppliedSuggestion(null);
  }

  // Pre-stage empty state — no destination/start date yet AND no legs
  // (own or shared by group members). Mirrors the Itinerary/Lodging
  // empty states so the page reads consistently across tabs while
  // details are still being decided.
  if (!canAutoSuggest && legs.length === 0 && memberLegs.length === 0 && !isLoading) {
    return (
      <View style={{ flex: 1, padding: 16, gap: 12 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4,
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#163026' }}>Travel</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="airplane-outline"
            title="Travel suggestions"
            body="Lock in a destination and dates to see suggested routes for your group."
          />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#163026' }}>Travel</Text>
        {legs.length > 0 ? (
          <Pressable
            onPress={async () => {
              const text = legs.map(buildShareText).join('\n\n');
              try { await Share.share({ message: text }); } catch {}
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: '#D9CCB6',
            }}
            accessibilityRole="button"
            accessibilityLabel="Share all travel legs"
          >
            <Ionicons name="share-outline" size={15} color="#737373" />
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#737373' }}>Share all</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Travel suggestions — pinned to top.
          Planners see the group-wide card + a per-member breakdown.
          Members see a personal card scoped to their own profile. */}
      {isPlanner ? (
        <>
          <TravelSuggestionCard
            tripId={tripId}
            trip={trip}
            enabled={canAutoSuggest && legs.length === 0}
            onApply={(s) => { setAppliedSuggestion(s); setShowAddForm(true); }}
          />
          {canAutoSuggest ? (
            <PerMemberRoutesSection
              tripId={tripId}
              onApply={(s) => { setAppliedSuggestion(s); setShowAddForm(true); }}
            />
          ) : null}
        </>
      ) : (
        <TravelSuggestionCard
          tripId={tripId}
          trip={trip}
          enabled={canAutoSuggest && legs.length === 0 && !!myPhone}
          respondentPhone={myPhone}
          title="Your route"
          loadingMessage="Finding the best routes from your home airport…"
          onApply={(s) => { setAppliedSuggestion(s); setShowAddForm(true); }}
        />
      )}

      {/* My legs */}
      {isLoading && legs.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 32 }}>
          <Text style={{ fontSize: 14, color: '#AAA' }}>Loading…</Text>
        </View>
      ) : null}

      {legs.map((leg) => (
        <LegCard
          key={leg.id}
          leg={leg}
          onEdit={isPlanner ? () => { setShowAddForm(false); setEditingLeg(leg); } : undefined}
          onDelete={isPlanner ? () => handleDelete(leg.id) : undefined}
        />
      ))}

      {/* Group members' shared legs */}
      {memberLegs.length > 0 ? (
        <View style={{ marginTop: legs.length > 0 ? 8 : 0, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '700',
                color: '#AAA',
                letterSpacing: 0.8,
                textTransform: 'uppercase',
              }}
            >
              Group members
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: '#EBEBEB' }} />
          </View>
          <Text style={{ fontSize: 13, color: '#888', marginTop: -4, lineHeight: 18 }}>
            Travel legs shared by your group members
          </Text>
          {memberLegs.map((leg) => (
            <MemberLegCard key={leg.id} leg={leg} respondentName={leg.respondent_name} />
          ))}
        </View>
      ) : null}

      {/* Add leg button */}
      {isPlanner ? (
        <Pressable
          onPress={() => setShowAddForm(true)}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            paddingVertical: 20,
            borderRadius: 16,
            borderWidth: 2,
            borderStyle: 'dashed',
            borderColor: '#D9CCB6',
          }}
          accessibilityRole="button"
        >
          <Ionicons name="add-circle-outline" size={18} color="#D4D4D4" />
          <Text style={{ fontSize: 12, color: '#D0D0D0' }}>Tap to add leg</Text>
        </Pressable>
      ) : null}

      {/* Empty state — only when there's no other content driving the page.
          Once Travel suggestions land in the trip-row cache, the suggestion
          card carries the page on its own; the airplane illustration below
          starts to feel redundant. */}
      {legs.length === 0 && !isLoading && !Array.isArray(trip?.cached_travel_suggestions) ? (
        <View style={{ alignItems: 'center', paddingVertical: 48, gap: 10 }}>
          <Ionicons name="airplane-outline" size={44} color="#D0D0D0" />
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#163026' }}>No travel legs yet</Text>
          <Text style={{ fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 20, paddingHorizontal: 32 }}>
            Add flights, trains, car trips, or any other transport to coordinate how everyone gets there.
          </Text>
        </View>
      ) : null}

      {/* Add leg sheet */}
      <LegFormSheet
        visible={showAddForm}
        initialValues={appliedSuggestion ? { mode: appliedSuggestion.mode, label: appliedSuggestion.label } as TravelLeg : undefined}
        tripName={trip?.name ?? ''}
        tripStartDate={trip?.start_date ?? null}
        tripEndDate={trip?.end_date ?? null}
        saving={isSaving}
        onSave={handleAdd}
        onClose={handleCancel}
      />

      {/* Edit leg sheet */}
      <LegFormSheet
        visible={editingLeg !== null}
        initialValues={editingLeg ?? undefined}
        tripName={trip?.name ?? ''}
        tripStartDate={trip?.start_date ?? null}
        tripEndDate={trip?.end_date ?? null}
        saving={isSaving}
        onSave={handleUpdate}
        onClose={handleCancel}
      />
    </ScrollView>
  );
}
