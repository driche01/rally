/**
 * TravelTab — coordinate flights, trains, cars, and other transport.
 * Legs are persisted to Supabase. Planners can mark legs as "share with group"
 * so they appear in the group section. Swipe left to delete a leg.
 */
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useTrip } from '@/hooks/useTrips';
import { DateRangePicker } from '@/components/DateRangePicker';
import {
  useCreateTravelLeg,
  useDeleteTravelLeg,
  useSharedMemberLegs,
  useTravelLegs,
  useUpdateTravelLeg,
} from '@/hooks/useTravelLegs';
import { useGetTravelSuggestions } from '@/hooks/useAiSuggestions';
import type { TravelSuggestion } from '@/lib/api/aiSuggestions';
import type { TravelLeg, TransportMode } from '@/types/database';
import { Button } from '@/components/ui';

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
        {MODES.map((m) => {
          const sel = mode === m;
          return (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 999,
                borderWidth: 1.5,
                borderColor: sel ? '#0F3F2E' : '#D9CCB6',
                backgroundColor: sel ? '#fff5f2' : '#fff',
              }}
            >
              <Ionicons name={MODE_CONFIG[m].icon} size={14} color={sel ? '#0F3F2E' : '#888'} />
              <Text style={{ fontSize: 13, fontWeight: '500', color: sel ? '#0F3F2E' : '#555' }}>
                {MODE_CONFIG[m].label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Description + search */}
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Description
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            style={{
              flex: 1,
              height: 44,
              borderWidth: 1.5,
              borderColor: '#D9CCB6',
              borderRadius: 10,
              paddingHorizontal: 12,
              fontSize: 15,
              color: '#163026',
              backgroundColor: '#FBF7EF',
            }}
            placeholder={
              mode === 'flight'
                ? 'e.g. JFK → LAX'
                : mode === 'car'
                ? 'e.g. Drive to Yosemite'
                : `e.g. ${MODE_CONFIG[mode].label} to destination`
            }
            placeholderTextColor="#A8A8A8"
            value={label}
            onChangeText={setLabel}
          />
          <Pressable
            onPress={handleSearch}
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              backgroundColor: '#F3F3F3',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityLabel={`Search ${MODE_CONFIG[mode].label}`}
          >
            <Ionicons name="search-outline" size={20} color="#555" />
          </Pressable>
        </View>
      </View>

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
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Departs
          </Text>
          <TextInput
            style={{
              height: 44,
              borderWidth: 1.5,
              borderColor: '#D9CCB6',
              borderRadius: 10,
              paddingHorizontal: 12,
              fontSize: 15,
              color: '#163026',
              backgroundColor: '#FBF7EF',
            }}
            placeholder="HH:MM"
            placeholderTextColor="#A8A8A8"
            value={departureTime}
            onChangeText={setDepartureTime}
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Arrives
          </Text>
          <TextInput
            style={{
              height: 44,
              borderWidth: 1.5,
              borderColor: '#D9CCB6',
              borderRadius: 10,
              paddingHorizontal: 12,
              fontSize: 15,
              color: '#163026',
              backgroundColor: '#FBF7EF',
            }}
            placeholder="HH:MM"
            placeholderTextColor="#A8A8A8"
            value={arrivalTime}
            onChangeText={setArrivalTime}
            keyboardType="numbers-and-punctuation"
          />
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
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Confirmation / Booking ref{' '}
          <Text style={{ fontWeight: '400', textTransform: 'none' }}>(optional)</Text>
        </Text>
        <TextInput
          style={{
            height: 44,
            borderWidth: 1.5,
            borderColor: '#D9CCB6',
            borderRadius: 10,
            paddingHorizontal: 12,
            fontSize: 15,
            color: '#163026',
            backgroundColor: '#FBF7EF',
          }}
          placeholder="e.g. ABC123"
          placeholderTextColor="#A8A8A8"
          value={bookingRef}
          onChangeText={setBookingRef}
          autoCapitalize="characters"
        />
      </View>

      {/* Notes */}
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Notes <Text style={{ fontWeight: '400', textTransform: 'none' }}>(optional)</Text>
        </Text>
        <TextInput
          style={{
            minHeight: 72,
            borderWidth: 1.5,
            borderColor: '#D9CCB6',
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontSize: 15,
            color: '#163026',
            backgroundColor: '#FBF7EF',
            textAlignVertical: 'top',
          }}
          placeholder="e.g. Meet at Terminal 4, baggage claim"
          placeholderTextColor="#A8A8A8"
          value={notes}
          onChangeText={setNotes}
          multiline
        />
      </View>

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
        <Switch
          value={shareWithGroup}
          onValueChange={setShareWithGroup}
          trackColor={{ false: '#D9CCB6', true: '#C8ECD9' }}
          thumbColor={shareWithGroup ? '#235C38' : '#fff'}
          ios_backgroundColor="#D9CCB6"
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
    <Modal
      visible={visible}
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
          <Pressable onPress={() => {}} style={{ backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' }}>
            {/* Drag handle + header */}
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#D9CCB6' }} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}>
              <Pressable onPress={onClose}>
                <Text style={{ fontSize: 15, color: '#0F3F2E' }}>Cancel</Text>
              </Pressable>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#163026' }}>
                {isEditing ? 'Edit leg' : 'Add leg'}
              </Text>
              <View style={{ width: 56 }} />
            </View>
            {/* Scrollable form content */}
            <ScrollView
              contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <LegForm
                tripName={tripName}
                tripStartDate={tripStartDate}
                tripEndDate={tripEndDate}
                initialValues={initialValues}
                saving={saving}
                onSave={onSave}
                onCancel={onClose}
              />
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
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
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: '#E8F4EE',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#235C38' }}>
            {respondentName.trim().charAt(0).toUpperCase()}
          </Text>
        </View>
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

// ─── AI Travel Suggestion Card ────────────────────────────────────────────────

const MODE_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  flight: 'airplane-outline',
  train: 'train-outline',
  car: 'car-outline',
  ferry: 'boat-outline',
  bus: 'bus-outline',
  other: 'navigate-outline',
};

function TravelAiSuggestionCard({ tripId, defaultExpanded = true, onApply }: { tripId: string; defaultExpanded?: boolean; onApply?: (s: TravelSuggestion) => void }) {
  const getSuggestions = useGetTravelSuggestions(tripId);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [origin, setOrigin] = useState('');
  const [showOriginInput, setShowOriginInput] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const suggestions = getSuggestions.data ?? [];

  function handleGenerate() {
    if (suggestions.length > 0) {
      setExpanded((p) => !p);
      return;
    }
    setShowOriginInput(true);
  }

  function handleSubmitOrigin() {
    setShowOriginInput(false);
    getSuggestions.mutate(origin || undefined, {
      onSuccess: () => setExpanded(true),
      onError: () => Alert.alert('Error', 'Could not get AI suggestions. Please try again.'),
    });
  }

  // No suggestions yet — show itinerary-style generate card
  if (suggestions.length === 0) {
    return (
      <View style={{ backgroundColor: '#EEF3F8', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#D8E4EE', gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="sparkles-outline" size={18} color="#1A4060" />
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#1A4060' }}>AI travel suggestions</Text>
        </View>
        <Text style={{ fontSize: 13, color: '#4A6E8A', lineHeight: 18 }}>
          Rally will suggest the best travel modes and routes based on your destination, dates, and group size.
        </Text>
        {showOriginInput ? (
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 12, color: '#4A6E8A' }}>Where are you traveling from? (optional)</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={origin}
                onChangeText={setOrigin}
                placeholder="e.g. New York, NY"
                placeholderTextColor="#A3A3A3"
                style={{ flex: 1, borderWidth: 1.5, borderColor: '#C8D9E8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: '#163026', backgroundColor: 'white' }}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSubmitOrigin}
              />
              <Pressable
                onPress={handleSubmitOrigin}
                disabled={getSuggestions.isPending}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1A4060', justifyContent: 'center' }}
              >
                {getSuggestions.isPending ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text style={{ fontSize: 13, fontWeight: '600', color: 'white' }}>Go</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
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
        )}
      </View>
    );
  }

  return (
    <View
      style={{
        marginBottom: 12,
        borderRadius: 16,
        backgroundColor: 'white',
        borderWidth: 1,
        borderColor: '#D8E4EE',
        overflow: 'hidden',
        shadowColor: '#1A4060',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 2,
      }}
    >
      <Pressable
        onPress={handleGenerate}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 }}
        accessibilityRole="button"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="sparkles-outline" size={15} color="#1A4060" />
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#1A4060' }}>AI travel suggestions</Text>
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

      {/* Suggestions list */}
      {expanded && suggestions.length > 0 ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
          {suggestions.map((s: TravelSuggestion) => (
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: '#FFF4F2', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={MODE_ICON[s.mode] ?? 'navigate-outline'} size={15} color="#0F3F2E" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#163026' }}>{s.label}</Text>
                  <Text style={{ fontSize: 11, color: '#888' }}>
                    {s.estimatedDuration}
                    {s.estimatedCostPerPerson ? ` · ${s.estimatedCostPerPerson}` : ''}
                  </Text>
                </View>
                {selectedIndex === s.index ? (
                  <View style={{ backgroundColor: '#1A4060', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: 'white' }}>Selected</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => Linking.openURL(s.searchUrl)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: '#D9CCB6' }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#1A4060' }}>Search</Text>
                    <Ionicons name="open-outline" size={10} color="#1A4060" />
                  </Pressable>
                )}
              </View>
              <Text style={{ fontSize: 12, color: '#555', lineHeight: 17 }}>{s.description}</Text>
              <View style={{ gap: 3 }}>
                {s.pros.map((p, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 5, alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 11, color: '#16A34A', marginTop: 1 }}>✓</Text>
                    <Text style={{ fontSize: 11, color: '#555', flex: 1 }}>{p}</Text>
                  </View>
                ))}
                {s.cons.map((c, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 5, alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 11, color: '#888', marginTop: 1 }}>–</Text>
                    <Text style={{ fontSize: 11, color: '#888', flex: 1 }}>{c}</Text>
                  </View>
                ))}
              </View>
              {s.bookingTip ? (
                <View style={{ flexDirection: 'row', gap: 5, alignItems: 'flex-start', backgroundColor: '#FFF8F6', borderRadius: 8, padding: 8 }}>
                  <Ionicons name="bulb-outline" size={12} color="#0F3F2E" style={{ marginTop: 1 }} />
                  <Text style={{ fontSize: 11, color: '#0F3F2E', flex: 1 }}>{s.bookingTip}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
          {selectedIndex !== null ? (
            <Pressable
              onPress={() => {
                const s = suggestions.find((s: TravelSuggestion) => s.index === selectedIndex);
                if (s && onApply) { onApply(s); setExpanded(false); setSelectedIndex(null); }
              }}
              style={{ backgroundColor: '#1A4060', borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 4 }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: 'white' }}>
                Add "{suggestions.find((s: TravelSuggestion) => s.index === selectedIndex)?.label}" as travel leg
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!expanded && suggestions.length === 0 && !getSuggestions.isPending && !showOriginInput ? (
        <Text style={{ paddingHorizontal: 14, paddingBottom: 12, fontSize: 12, color: '#A3A3A3' }}>
          AI will suggest the best travel modes and routes based on your destination, dates, and group size.
        </Text>
      ) : null}
    </View>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function TravelTab({ tripId, isPlanner = true }: { tripId: string; isPlanner?: boolean }) {
  const { data: trip } = useTrip(tripId);
  const { data: legs = [], isLoading } = useTravelLegs(tripId);
  const { data: memberLegs = [] } = useSharedMemberLegs(tripId);

  const createMutation = useCreateTravelLeg(tripId);
  const updateMutation = useUpdateTravelLeg(tripId);
  const deleteMutation = useDeleteTravelLeg(tripId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingLeg, setEditingLeg] = useState<TravelLeg | null>(null);
  const [appliedSuggestion, setAppliedSuggestion] = useState<TravelSuggestion | null>(null);

  const isSaving = createMutation.isPending || updateMutation.isPending;

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

      {/* AI suggestions — pinned to top, planner only */}
      {isPlanner ? (
        <TravelAiSuggestionCard
          tripId={tripId}
          defaultExpanded={legs.length === 0}
          onApply={(s) => { setAppliedSuggestion(s); setShowAddForm(true); }}
        />
      ) : null}

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

      {/* Empty state */}
      {legs.length === 0 && !isLoading ? (
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
