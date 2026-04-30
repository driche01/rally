import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  Text,
  type TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, PlacesAutocompleteInput, useCelebration } from '@/components/ui';
import { MultiDatePicker, groupConsecutiveDays } from '@/components/MultiDatePicker';
import { ContactSelector, type SelectedContact } from '@/components/trips/ContactSelector';
import { CustomPollsSection, cleanCustomPoll } from '@/components/trips/CustomPollsSection';
import { FormSectionHeader } from '@/components/trips/FormSectionHeader';
import { BookByPicker } from '@/components/trips/BookByPicker';
import { LiveSmsPreview } from '@/components/trips/LiveSmsPreview';
import { tapHaptic } from '@/lib/haptics';
import type { CustomPoll } from '@/types/polls';
import { useCreateTrip } from '@/hooks/useTrips';
import { useProfile } from '@/hooks/useProfile';
import { useAuthStore } from '@/stores/authStore';
import * as Notifications from 'expo-notifications';
import { capture, Events } from '@/lib/analytics';
import { log } from '@/lib/logger';
import {
  computeCadence,
  daysUntil,
  deriveResponsesDue,
  formatCadenceDate,
  nudgeKindLabel,
} from '@/lib/cadence';
import type { GroupSizeBucket } from '@/types/database';

const BUDGET_OPTIONS = ['Under $500', '$500–$1k', '$1k–$2.5k', 'Above $2.5k'];

// Pre-set duration chips. Labels are nights (industry-standard for lodging).
// Friendly modifiers help respondents recognize the shape of each option.
const DURATION_OPTIONS = [
  '2 nights (weekend)',
  '3 nights (long weekend)',
  '5 nights',
  '7 nights (1 week)',
  '10 nights',
];

// Canonical title used everywhere the duration poll is referenced — server
// migrations 058/059 assume this exact string. Keep in sync.
const DURATION_POLL_TITLE = 'How long should the trip be?';

// Single source of truth for form-section labels. Matches the explicit
// style used by ContactSelector ("Who's coming?") so every label renders
// identically — system font, 14sp, weight 500, #404040. We deliberately
// bypass NativeWind's `font-medium` class here because `font-medium` is
// mapped to the Inter_500Medium fontFamily in tailwind.config.js, which
// would render these labels in a different typeface than the
// StyleSheet-styled ones.
const FORM_LABEL_STYLE = { fontSize: 14, fontWeight: '500' as const, color: '#404040' };

function bucketFromSize(n: number): GroupSizeBucket {
  if (n <= 4) return '0-4';
  if (n <= 8) return '5-8';
  if (n <= 12) return '9-12';
  if (n <= 20) return '13-20';
  return '20+';
}

/**
 * Format a date range as a poll option label, e.g. "Jun 17–24" or
 * "Jun 28 – Jul 5". Used when the planner adds 2+ date ranges and we
 * need readable poll-option strings.
 */
function formatDateRangeLabel(start: string, end: string | null): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const s = new Date(start + 'T12:00:00');
  const sm = months[s.getMonth()];
  const sd = s.getDate();
  if (!end) return `${sm} ${sd}`;
  const e = new Date(end + 'T12:00:00');
  const em = months[e.getMonth()];
  const ed = e.getDate();
  return sm === em ? `${sm} ${sd}–${ed}` : `${sm} ${sd} – ${em} ${ed}`;
}

/**
 * Parse the leading night-count from a duration string. Returns null if
 * the string doesn't start with a number followed by "night"/"nights".
 *
 * "2 nights (weekend)" → 2
 * "7 nights (1 week)" → 7
 * "5 nights"          → 5
 * "4 nights"          → 4 (custom)
 * "Group decides"     → null
 */
function parseDurationNights(s: string): number | null {
  const m = s.trim().match(/^(\d+)\s*nights?\b/i);
  return m ? Number(m[1]) : null;
}

/**
 * Number of days in a date range. End-null ranges are single days (1).
 * Used to compare a contiguous date range against a duration to decide
 * whether the planner has implicitly locked in trip dates at creation.
 */
function daysInRange(r: { start: string; end: string | null }): number {
  const startMs = new Date(r.start + 'T12:00:00').getTime();
  const endMs = new Date((r.end ?? r.start) + 'T12:00:00').getTime();
  return Math.round((endMs - startMs) / 86400000) + 1;
}

/**
 * Expand a date range into a sorted list of single-day labels ("Jun 17",
 * "Jun 18", …). When the planner adds 2+ ranges to a dates poll, we
 * expand each range so the survey can show a per-day calendar where
 * respondents tap individual days they're available — instead of forcing
 * them to pick whole ranges. The dashboard then renders a heat map of
 * those per-day votes.
 *
 * Returns DEDUPED labels across all input ranges, sorted chronologically.
 */
function expandRangesToDayLabels(
  ranges: Array<{ start: string | null; end: string | null }>,
): string[] {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const seen = new Map<string, Date>(); // label → date for sorting
  for (const r of ranges) {
    if (!r.start) continue;
    const s = new Date(r.start + 'T12:00:00');
    const e = r.end ? new Date(r.end + 'T12:00:00') : new Date(s);
    for (let d = new Date(s); d.getTime() <= e.getTime(); d.setDate(d.getDate() + 1)) {
      const label = `${months[d.getMonth()]} ${d.getDate()}`;
      if (!seen.has(label)) seen.set(label, new Date(d));
    }
  }
  return Array.from(seen.entries())
    .sort((a, b) => a[1].getTime() - b[1].getTime())
    .map(([label]) => label);
}

// Order matters: validate() walks fields top-to-bottom, and on a missing-info
// submission we scroll to the first error in this exact sequence.
const FIELD_ORDER = ['name', 'contacts', 'destination', 'dates', 'budget', 'bookBy'] as const;
type FieldKey = (typeof FIELD_ORDER)[number];

export default function NewTripScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const createTrip = useCreateTrip();
  const { celebrate, CelebrationOverlay } = useCelebration();

  const scrollRef = useRef<ScrollView>(null);
  const nameInputRef = useRef<TextInput>(null);
  // y-position of each validated field, captured via onLayout. Coordinates
  // are relative to the field's parent container (the gap-6 wrapper inside
  // ScrollView's content), which is what scrollTo expects.
  const fieldYsRef = useRef<Partial<Record<FieldKey, number>>>({});
  const onFieldLayout = (key: FieldKey) => (e: LayoutChangeEvent) => {
    fieldYsRef.current[key] = e.nativeEvent.layout.y;
  };
  function scrollToFirstError(errs: Partial<Record<FieldKey, string>>) {
    const firstKey = FIELD_ORDER.find((k) => errs[k]);
    if (!firstKey) return;
    const y = fieldYsRef.current[firstKey];
    if (y == null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
    if (firstKey === 'name') {
      // Delay focus until the scroll lands so the keyboard doesn't fight
      // the scroll animation.
      setTimeout(() => nameInputRef.current?.focus(), 250);
    }
  }

  const [name, setName] = useState('');
  const [contacts, setContacts] = useState<SelectedContact[]>([]);
  // Each field is now a list of options. Length-based semantics:
  //   0 → no poll (field stays blank)
  //   1 → decided poll (the value is locked at creation)
  //   2+ → live poll for the group to vote on
  const [destinations, setDestinations] = useState<Array<{ name: string; address: string }>>([{ name: '', address: '' }]);
  // Date selection lives as a flat set of ISO days. Consecutive days
  // collapse into ranges via groupConsecutiveDays — that's what we send
  // to the API and what the user sees in the form's range list.
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const dateRanges = useMemo(
    () => groupConsecutiveDays(selectedDays).map((g) => ({ start: g.start, end: g.end === g.start ? null : g.end })),
    [selectedDays],
  );
  // Default: all four standard buckets pre-selected. The planner
  // typically wants the group to vote across the spread, so pre-selecting
  // means the form is submittable on minimum effort. They can deselect
  // any bucket they want to exclude.
  const [budgets, setBudgets] = useState<string[]>([...BUDGET_OPTIONS]);
  // Planner-added budget ranges that aren't in the standard 4 buckets.
  // Auto-selected on add (so the planner doesn't have to tap twice).
  const [customBudgets, setCustomBudgets] = useState<string[]>([]);
  const [customBudgetInput, setCustomBudgetInput] = useState('');
  const [customBudgetOpen, setCustomBudgetOpen] = useState(false);
  // Duration: optional. Same 0/1/2+ semantics as other fields, with one
  // twist — 0 still creates a free-form duration poll so respondents can
  // tell the planner how many nights they prefer.
  const [durations, setDurations] = useState<string[]>([]);
  const [customDurations, setCustomDurations] = useState<string[]>([]);
  const [customDurationInput, setCustomDurationInput] = useState('');
  const [customDurationOpen, setCustomDurationOpen] = useState(false);
  // Both fields are decided by the planner at creation when:
  //   - exactly 1 contiguous date range
  //   - exactly 1 duration option picked
  //   - duration's night-count matches (days_in_range − 1)
  // In that case start_date/end_date get written to the trip directly
  // and the dates poll is skipped (a decided dates poll auto-creates via
  // syncTripFieldsToPolls). The duration's 1-option decided poll is
  // already handled by createLivePollsFromOptions.
  const decidedDateRange = useMemo<{ start: string; end: string | null } | null>(() => {
    if (dateRanges.length !== 1 || durations.length !== 1) return null;
    const r = dateRanges[0];
    if (!r.start) return null;
    const nights = parseDurationNights(durations[0]);
    if (nights === null) return null;
    return nights === daysInRange(r) - 1 ? r : null;
  }, [dateRanges, durations]);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  // Smart default: 14 days out — matches the "In 2 weeks" pill on
  // BookByPicker. The planner can swap to any other pill (or Custom)
  // in one tap; pre-filling means the form is submittable immediately.
  const [bookByDate, setBookByDate] = useState<string | null>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  const [customIntroSms, setCustomIntroSms] = useState<string | null>(null);
  const [customPolls, setCustomPolls] = useState<CustomPoll[]>([]);
  const [errors, setErrors] = useState<{
    name?: string;
    contacts?: string;
    destination?: string;
    dates?: string;
    budget?: string;
    bookBy?: string;
  }>({});

  // Auto-clear field-level errors when the planner fixes the field.
  // Avoids having to update every setter call site individually.
  useEffect(() => {
    if (errors.destination && destinations.some((d) => d.name.trim())) {
      setErrors((e) => ({ ...e, destination: undefined }));
    }
  }, [destinations, errors.destination]);
  useEffect(() => {
    if (errors.dates && selectedDays.length > 0) {
      setErrors((e) => ({ ...e, dates: undefined }));
    }
  }, [selectedDays, errors.dates]);
  useEffect(() => {
    if (errors.budget && budgets.length > 0) {
      setErrors((e) => ({ ...e, budget: undefined }));
    }
  }, [budgets, errors.budget]);

  const currentUser = useAuthStore((s) => s.user);
  const { data: plannerProfile } = useProfile(currentUser?.id);
  const plannerFirstName = (plannerProfile?.name ?? '').split(/\s+/)[0] || null;

  // Cadence preview — recomputes whenever book-by changes.
  const responsesDueDate = deriveResponsesDue(bookByDate);
  const cadencePreview = bookByDate && responsesDueDate
    ? computeCadence({ responsesDueDate }).filter((it) => it.kind !== 'initial')
    : [];
  const bookByDays = daysUntil(bookByDate);
  const showShortNoticeWarning = bookByDays !== null && bookByDays >= 0 && bookByDays < 5;

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Trip name is required';
    if (contacts.length === 0) errs.contacts = 'Add at least one person Rally should text';
    if (destinations.filter((d) => d.name.trim()).length === 0) {
      errs.destination = 'Pick at least one destination';
    }
    if (dateRanges.filter((r) => r.start).length === 0) {
      errs.dates = 'Pick at least one trip date';
    }
    if (budgets.length === 0) {
      errs.budget = 'Pick at least one budget option';
    }
    if (!bookByDate) errs.bookBy = 'Pick a date you need to book by';
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstError(errs);
    }
    return Object.keys(errs).length === 0;
  }

  function resolvedSize(): { bucket: GroupSizeBucket; precise: number | null } {
    // Group size is now derived from picked contacts + the planner.
    const total = contacts.length + 1;
    return { bucket: bucketFromSize(total), precise: total };
  }

  async function handleCreate() {
    if (!validate()) return;
    const { bucket, precise } = resolvedSize();

    // Filter empty rows; trim. Each field collapses to:
    //   0 entries → undefined / null (no poll, no decided value)
    //   1 entry   → decided trip-field value (poll auto-created via syncTripFieldsToPolls)
    //   2+ entries → live poll with those options
    const cleanDestinations = destinations
      .map((d) => ({ name: d.name.trim(), address: d.address.trim() }))
      .filter((d) => d.name.length > 0);
    const cleanDateRanges = dateRanges
      .filter((r) => r.start);
    // Budget is already deduped at the source (multi-select on a fixed list).
    const cleanBudgets = budgets;

    const firstDest = cleanDestinations[0];
    const firstBudget = cleanBudgets[0];

    // Pack 2+ option arrays into the polls payload that createTrip will
    // turn into LIVE polls server-side after the trip exists.
    const pollOptions: Array<{
      type: 'destination' | 'dates' | 'budget' | 'custom';
      title: string;
      option_labels: string[];
      allow_multi_select?: boolean;
      allow_empty_options?: boolean;
    }> = [];
    if (cleanDestinations.length >= 2) {
      pollOptions.push({
        type: 'destination',
        title: 'Where do you want to go?',
        option_labels: cleanDestinations.map((d) => d.name),
      });
    }
    if (cleanDateRanges.length >= 1 && !decidedDateRange) {
      // The date range(s) are treated as a *window* — the planner is
      // committing to a window, not the trip's actual dates. Expand to
      // per-day options so the survey can show a calendar where
      // respondents tap individual days they're free; the planner picks
      // actual trip dates later from the heat map. Trip-level
      // start_date/end_date stay null at creation.
      //
      // Skipped when decidedDateRange is set — that's the
      // single-range-matches-single-duration case where dates are
      // locked at creation and the dates poll auto-creates as a decided
      // poll via syncTripFieldsToPolls.
      pollOptions.push({
        type: 'dates',
        title: 'When are you free?',
        option_labels: expandRangesToDayLabels(cleanDateRanges),
      });
    }
    // Duration is always asked. If the planner provided 0 options, the
    // poll is created with no preset options and respondents enter a
    // free-form number of nights. 1 option → decided (writes to
    // trips.trip_duration). 2+ → live multi-select chip poll.
    const cleanDurations = durations
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    pollOptions.push({
      type: 'custom',
      title: DURATION_POLL_TITLE,
      option_labels: cleanDurations,
      allow_multi_select: true,
      allow_empty_options: cleanDurations.length === 0,
    });
    if (cleanBudgets.length >= 2) {
      pollOptions.push({
        type: 'budget',
        title: "What's your budget? (travel + lodging only)",
        option_labels: cleanBudgets,
      });
    }

    // Custom polls — same 0/1/2+ semantics. 1 option = decided poll, 2+ = live.
    // Polls with no question or no non-empty options drop out via cleanCustomPoll.
    for (const cp of customPolls) {
      const cleaned = cleanCustomPoll(cp);
      if (!cleaned) continue;
      pollOptions.push({
        type: 'custom',
        title: cleaned.question,
        option_labels: cleaned.options,
        allow_multi_select: cleaned.allowMulti,
      });
    }

    try {
      const trip = await createTrip.mutateAsync({
        name: name.trim(),
        group_size_bucket: bucket,
        group_size_precise: precise,
        // Trip dates are decided at creation only when the planner
        // picked one contiguous range AND one duration whose nights
        // equal (days − 1) of that range — see decidedDateRange. In every
        // other case the planner is committing to a window and the group
        // picks days they're free via the dates poll.
        start_date: decidedDateRange?.start ?? null,
        end_date: decidedDateRange ? (decidedDateRange.end ?? decidedDateRange.start) : null,
        budget_per_person: cleanBudgets.length === 1 ? firstBudget : null,
        destination: cleanDestinations.length === 1 ? firstDest!.name : null,
        destination_address: cleanDestinations.length === 1 ? firstDest!.address : null,
        // Decided duration: only set when exactly ONE duration option
        // provided. 0 means free-form (group decides), 2+ means live poll.
        trip_duration: cleanDurations.length === 1 ? cleanDurations[0] : null,
        book_by_date: bookByDate,
        custom_intro_sms: customIntroSms,
        contacts: contacts.map((c) => ({ name: c.name, phone: c.phone, email: c.email ?? null })),
        poll_options: pollOptions,
      });
      capture(Events.TRIP_CREATED, { group_size_bucket: bucket });
      log.action(Events.TRIP_CREATED, { tripId: trip.id, group_size_bucket: bucket });
      celebrate();
      setTimeout(() => router.replace(`/(app)/trips/${trip.id}`), 900);
      // Show notification primer if permission not yet determined
      setTimeout(async () => {
        const { status } = await Notifications.getPermissionsAsync();
        if (status === 'undetermined') {
          router.push('/(app)/notification-primer');
        }
      }, 1500);
    } catch {
      Alert.alert('Error', 'Could not create trip. Please try again.');
    }
  }

  return (
    <>
    {CelebrationOverlay}
    <MultiDatePicker
      visible={datePickerVisible}
      value={selectedDays}
      onConfirm={(next) => setSelectedDays(next)}
      onClose={() => setDatePickerVisible(false)}
      title="Pick the days you’re considering"
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
        <Text className="text-lg font-semibold text-[#262626]">New rally</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-6 pt-4">
          {/* Trip name sits above section 01 as a top-level title for the
              whole rally — it's the trip's identity, not part of the
              "who's going" set. Manual label so it matches the other
              field labels (Input's built-in label uses text-ink which
              renders darker than the rest of the form). */}
          <View className="gap-2" onLayout={onFieldLayout('name')}>
            <Text style={FORM_LABEL_STYLE}>Trip name</Text>
            <Input
              ref={nameInputRef}
              placeholder="e.g. Bali 2026, Jake's 30th, Ski Weekend"
              value={name}
              onChangeText={(t) => { if (t.length <= 60) setName(t); }}
              maxLength={60}
              error={errors.name}
              hint={`${name.length}/60`}
              autoFocus
            />
          </View>

          <FormSectionHeader step="01" title="Who's invited" first />

          {/* Contacts — replaces the legacy group-size question. Group size
              is derived from contacts.length + 1 (planner included). */}
          <View onLayout={onFieldLayout('contacts')}>
            <ContactSelector
              value={contacts}
              onChange={(next) => { setContacts(next); setErrors((e) => ({ ...e, contacts: undefined })); }}
              plannerLabel={plannerFirstName ? `${plannerFirstName}` : null}
              error={errors.contacts}
            />
          </View>

          <FormSectionHeader step="02" title="What you're deciding" />

          {/* Destination — option list. 0 = skip, 1 = decided, 2+ = poll. */}
          <View className="gap-2" onLayout={onFieldLayout('destination')}>
            <View className="flex-row items-baseline justify-between">
              <Text style={FORM_LABEL_STYLE}>Destination</Text>
              {destinations.filter((d) => d.name.trim()).length >= 2 ? (
                <Text className="text-[11px] font-semibold text-green">Will be polled</Text>
              ) : null}
            </View>
            {destinations.map((d, i) => (
              <View key={i} className="flex-row items-center gap-2">
                <View className="flex-1">
                  <PlacesAutocompleteInput
                    value={d.name}
                    onChangeText={(v) => {
                      setDestinations((prev) => {
                        const next = [...prev];
                        next[i] = { name: v, address: '' };
                        return next;
                      });
                    }}
                    onSelectPlace={(nm, addr) => {
                      setDestinations((prev) => {
                        const next = [...prev];
                        next[i] = { name: nm, address: addr };
                        return next;
                      });
                    }}
                    placeholder={i === 0 ? 'e.g. Cancun, Bali, Tokyo…' : 'Add another option'}
                    leadingIcon
                  />
                </View>
                {destinations.length > 1 ? (
                  <Pressable
                    onPress={() => setDestinations((prev) => prev.filter((_, idx) => idx !== i))}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Remove option"
                  >
                    <Ionicons name="close-circle" size={20} color="#A0A0A0" />
                  </Pressable>
                ) : null}
              </View>
            ))}
            <Pressable
              onPress={() => { tapHaptic(); setDestinations((prev) => [...prev, { name: '', address: '' }]); }}
              className="flex-row items-center gap-1 self-start mt-1"
            >
              <Ionicons name="add-outline" size={14} color="#0F3F2E" />
              <Text className="text-[13px] font-semibold text-green">Add another option</Text>
            </Pressable>
            {errors.destination ? (
              <Text className="text-[13px] text-red-500">{errors.destination}</Text>
            ) : null}
          </View>

          {/* How long? — multi-select duration chips. Asked BEFORE dates
              because the planner's date range is a *window*, not the
              trip itself. 0 = free-form poll, 1 = decided
              (writes trips.trip_duration), 2+ = live multi-select poll. */}
          <View className="gap-2">
            <View className="flex-row items-baseline justify-between">
              <Text style={FORM_LABEL_STYLE}>How long?</Text>
              {decidedDateRange ? (
                <Text className="text-[11px] font-semibold text-green">Decided</Text>
              ) : durations.length >= 2 ? (
                <Text className="text-[11px] font-semibold text-green">Will be polled</Text>
              ) : durations.length === 0 ? (
                <Text className="text-[11px] font-semibold text-[#737373]">Group decides</Text>
              ) : null}
            </View>
            <Text style={{ fontSize: 13, color: '#737373', marginTop: -2 }}>
              Pick durations to vote on, or skip to let your group tell you how many nights.
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {DURATION_OPTIONS.map((opt) => {
                const sel = durations.includes(opt);
                return (
                  <Pressable
                    key={opt}
                    onPress={() => { if (!sel) tapHaptic(); setDurations((prev) => sel ? prev.filter((d) => d !== opt) : [...prev, opt]); }}
                    className={`px-3.5 py-2 rounded-full border-[1.5px] ${sel ? 'border-green bg-green-soft' : 'border-line bg-card'}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: sel }}
                    accessibilityLabel={opt}
                  >
                    <Text className={`text-sm font-medium ${sel ? 'text-green' : 'text-[#525252]'}`}>{opt}</Text>
                  </Pressable>
                );
              })}
              {customDurations.map((opt) => {
                const sel = durations.includes(opt);
                return (
                  <View key={opt} className="flex-row items-center">
                    <Pressable
                      onPress={() => setDurations((prev) => sel ? prev.filter((d) => d !== opt) : [...prev, opt])}
                      className={`flex-row items-center gap-1.5 pl-3.5 pr-2 py-2 rounded-full border-[1.5px] ${sel ? 'border-green bg-green-soft' : 'border-line bg-card'}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: sel }}
                      accessibilityLabel={opt}
                    >
                      <Text className={`text-sm font-medium ${sel ? 'text-green' : 'text-[#525252]'}`}>{opt}</Text>
                      <Pressable
                        onPress={() => {
                          setCustomDurations((prev) => prev.filter((d) => d !== opt));
                          setDurations((prev) => prev.filter((d) => d !== opt));
                        }}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${opt}`}
                      >
                        <Ionicons name="close-circle" size={16} color={sel ? '#0F3F2E' : '#A0A0A0'} />
                      </Pressable>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            {customDurationOpen ? (
              <View className="flex-row items-center gap-2 mt-1">
                <View className="flex-1">
                  <Input
                    value={customDurationInput}
                    onChangeText={setCustomDurationInput}
                    placeholder="e.g. 4 nights or 14 nights"
                    maxLength={40}
                    autoFocus
                  />
                </View>
                <Pressable
                  onPress={() => {
                    const v = customDurationInput.trim();
                    if (!v) return;
                    if (!customDurations.includes(v) && !DURATION_OPTIONS.includes(v)) {
                      setCustomDurations((prev) => [...prev, v]);
                      setDurations((prev) => [...prev, v]); // auto-select on add
                    }
                    setCustomDurationInput('');
                    setCustomDurationOpen(false);
                  }}
                  className="px-3.5 py-2 rounded-full bg-green"
                  accessibilityRole="button"
                  accessibilityLabel="Add custom duration"
                >
                  <Text className="text-sm font-semibold text-white">Add</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setCustomDurationInput(''); setCustomDurationOpen(false); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text className="text-sm text-[#5F685F]">Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setCustomDurationOpen(true)}
                className="flex-row items-center gap-1 self-start mt-1"
              >
                <Ionicons name="add-outline" size={14} color="#0F3F2E" />
                <Text className="text-[13px] font-semibold text-green">Add custom duration</Text>
              </Pressable>
            )}
          </View>

          {/* Trip dates — single picker, multi-day taps. Consecutive days
              auto-group into ranges; non-consecutive picks become separate
              ranges. The picked range(s) define the *window* — respondents
              tap which days inside that window they're free, and the
              planner picks actual trip dates from the heat map later. */}
          <View className="gap-2" onLayout={onFieldLayout('dates')}>
            <View className="flex-row items-baseline justify-between">
              <Text style={FORM_LABEL_STYLE}>
                {decidedDateRange ? 'Trip dates' : 'Trip dates window'}
              </Text>
              {decidedDateRange ? (
                <Text className="text-[11px] font-semibold text-green">Decided</Text>
              ) : dateRanges.length >= 1 ? (
                <Text className="text-[11px] font-semibold text-green">Group picks days they're free</Text>
              ) : null}
            </View>
            <Text style={{ fontSize: 13, color: '#737373', marginTop: -2 }}>
              {decidedDateRange
                ? 'Duration matches — these dates are locked in.'
                : 'Pick the window — your group will tell you which days they work.'}
            </Text>
            <TouchableOpacity
              className="flex-row items-center gap-2.5 border-[1.5px] border-line rounded-xl bg-card px-3.5 py-[13px]"
              onPress={() => setDatePickerVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="calendar-outline" size={18} color="#737373" />
              <Text className="flex-1 text-sm font-medium text-[#262626]">
                {selectedDays.length === 0
                  ? 'Pick trip dates'
                  : `${selectedDays.length} day${selectedDays.length === 1 ? '' : 's'} · ${dateRanges.length} ${dateRanges.length === 1 ? 'option' : 'options'}`}
              </Text>
              <Text className="text-[12px] text-[#737373]">
                {selectedDays.length === 0 ? '' : 'Edit'}
              </Text>
            </TouchableOpacity>

            {dateRanges.length > 0 ? (
              <View className="rounded-xl border border-line bg-card overflow-hidden mt-1">
                {dateRanges.map((r, i) => {
                  const label = r.end
                    ? formatDateRangeLabel(r.start, r.end)
                    : formatDateRangeLabel(r.start, null);
                  const days = r.end
                    ? Math.round((new Date(r.end + 'T12:00:00').getTime() - new Date(r.start + 'T12:00:00').getTime()) / 86400000) + 1
                    : 1;
                  return (
                    <View
                      key={r.start}
                      className={`flex-row items-center justify-between px-3.5 py-2.5 ${i < dateRanges.length - 1 ? 'border-b border-line' : ''}`}
                    >
                      <View className="flex-row items-center gap-2 flex-1">
                        <Ionicons name="calendar" size={14} color="#0F3F2E" />
                        <Text className="text-sm font-medium text-[#262626]">{label}</Text>
                        <Text className="text-[12px] text-[#737373]">
                          · {days} day{days === 1 ? '' : 's'}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => {
                          // Remove all days in this range from selectedDays.
                          const start = new Date(r.start + 'T12:00:00').getTime();
                          const end = new Date((r.end ?? r.start) + 'T12:00:00').getTime();
                          setSelectedDays((prev) =>
                            prev.filter((d) => {
                              const t = new Date(d + 'T12:00:00').getTime();
                              return t < start || t > end;
                            }),
                          );
                        }}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${label}`}
                      >
                        <Ionicons name="close-circle" size={18} color="#A0A0A0" />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ) : null}
            {errors.dates ? (
              <Text className="text-[13px] text-red-500">{errors.dates}</Text>
            ) : null}
          </View>

          {/* Spend per person — multi-select. 0 = skip, 1 = decided, 2+ = poll. */}
          <View className="gap-2" onLayout={onFieldLayout('budget')}>
            <View className="flex-row items-baseline justify-between">
              <Text style={FORM_LABEL_STYLE}>Spend per person</Text>
              {budgets.length >= 2 ? (
                <Text className="text-[11px] font-semibold text-green">Will be polled</Text>
              ) : null}
            </View>
            <Text style={{ fontSize: 13, color: '#737373', marginTop: -2 }}>Travel + lodging only</Text>
            <View className="flex-row flex-wrap gap-2">
              {BUDGET_OPTIONS.map((opt) => {
                const sel = budgets.includes(opt);
                return (
                  <Pressable
                    key={opt}
                    onPress={() => { if (!sel) tapHaptic(); setBudgets((prev) => sel ? prev.filter((b) => b !== opt) : [...prev, opt]); }}
                    className={`px-3.5 py-2 rounded-full border-[1.5px] ${sel ? 'border-green bg-green-soft' : 'border-line bg-card'}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: sel }}
                    accessibilityLabel={opt}
                  >
                    <Text className={`text-sm font-medium ${sel ? 'text-green' : 'text-[#525252]'}`}>{opt}</Text>
                  </Pressable>
                );
              })}
              {customBudgets.map((opt) => {
                const sel = budgets.includes(opt);
                return (
                  <View key={opt} className="flex-row items-center">
                    <Pressable
                      onPress={() => setBudgets((prev) => sel ? prev.filter((b) => b !== opt) : [...prev, opt])}
                      className={`flex-row items-center gap-1.5 pl-3.5 pr-2 py-2 rounded-full border-[1.5px] ${sel ? 'border-green bg-green-soft' : 'border-line bg-card'}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: sel }}
                      accessibilityLabel={opt}
                    >
                      <Text className={`text-sm font-medium ${sel ? 'text-green' : 'text-[#525252]'}`}>{opt}</Text>
                      <Pressable
                        onPress={() => {
                          setCustomBudgets((prev) => prev.filter((b) => b !== opt));
                          setBudgets((prev) => prev.filter((b) => b !== opt));
                        }}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${opt}`}
                      >
                        <Ionicons name="close-circle" size={16} color={sel ? '#0F3F2E' : '#A0A0A0'} />
                      </Pressable>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            {customBudgetOpen ? (
              <View className="flex-row items-center gap-2 mt-1">
                <View className="flex-1">
                  <Input
                    value={customBudgetInput}
                    onChangeText={setCustomBudgetInput}
                    placeholder="e.g. $3k–$5k or Above $5k"
                    maxLength={40}
                    autoFocus
                  />
                </View>
                <Pressable
                  onPress={() => {
                    const v = customBudgetInput.trim();
                    if (!v) return;
                    if (!customBudgets.includes(v) && !BUDGET_OPTIONS.includes(v)) {
                      setCustomBudgets((prev) => [...prev, v]);
                      setBudgets((prev) => [...prev, v]); // auto-select on add
                    }
                    setCustomBudgetInput('');
                    setCustomBudgetOpen(false);
                  }}
                  className="px-3.5 py-2 rounded-full bg-green"
                  accessibilityRole="button"
                  accessibilityLabel="Add custom range"
                >
                  <Text className="text-sm font-semibold text-white">Add</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setCustomBudgetInput(''); setCustomBudgetOpen(false); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text className="text-sm text-[#5F685F]">Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setCustomBudgetOpen(true)}
                className="flex-row items-center gap-1 self-start mt-1"
              >
                <Ionicons name="add-outline" size={14} color="#0F3F2E" />
                <Text className="text-[13px] font-semibold text-green">Add custom range</Text>
              </Pressable>
            )}
            {errors.budget ? (
              <Text className="text-[13px] text-red-500">{errors.budget}</Text>
            ) : null}
          </View>

          {/* Custom polls — compact "Anything else for the group?" zero-state
              with example chips, expands inline when the planner adds one. */}
          <CustomPollsSection value={customPolls} onChange={setCustomPolls} />

          <FormSectionHeader step="03" title="When Rally texts" />

          {/* Book-by date (required) — drives the nudge cadence */}
          <View className="gap-2" onLayout={onFieldLayout('bookBy')}>
            <Text style={FORM_LABEL_STYLE}>When do you need to book by?</Text>
            <BookByPicker
              value={bookByDate}
              onChange={(d) => { setBookByDate(d); setErrors((e) => ({ ...e, bookBy: undefined })); }}
              hasError={Boolean(errors.bookBy)}
            />
            {errors.bookBy ? <Text className="text-[13px] text-red-500">{errors.bookBy}</Text> : null}

            {showShortNoticeWarning && (
              <View className="mt-1 px-3 py-2.5 rounded-xl bg-[#FEF3C7] border border-[#FDE68A]">
                <Text className="text-[13px] font-medium text-[#92400E]">
                  Tight timeline
                </Text>
                <Text className="text-[12px] text-[#78350F] mt-0.5">
                  Rally will only have time for limited nudges before {formatCadenceDate(bookByDate!)}. Want to push the date out a bit?
                </Text>
              </View>
            )}

            {cadencePreview.length > 0 && !showShortNoticeWarning && (
              <View className="mt-1 px-3 py-2.5 rounded-xl bg-green-soft border border-[#C8D8B5]">
                <Text className="text-[12px] font-medium text-green">
                  Rally will text non-responders on
                </Text>
                <Text className="text-[12px] text-[#235C38] mt-1 leading-[18px]">
                  {cadencePreview.map((it) => formatCadenceDate(it.scheduledFor)).join(' · ')}
                </Text>
                {responsesDueDate && (
                  <Text className="text-[11px] text-[#5F685F] mt-1.5">
                    Responses due {formatCadenceDate(responsesDueDate)} (3 days before book-by) · {nudgeKindLabel('rd_minus_1').toLowerCase()} on {formatCadenceDate(cadencePreview[cadencePreview.length - 1].scheduledFor)}
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Editable preview of the initial outreach SMS. Replaces the
              older "Rally's intro text" + Customize-button flow — tapping
              the bubble lets the planner type directly. */}
          <LiveSmsPreview
            plannerFirstName={plannerFirstName}
            destination={
              destinations.filter((d) => d.name.trim()).length === 1
                ? destinations.find((d) => d.name.trim())!.name.trim()
                : null
            }
            responsesDueDate={responsesDueDate}
            customIntroSms={customIntroSms}
            onChange={setCustomIntroSms}
          />

          <Button onPress={handleCreate} loading={createTrip.isPending} fullWidth>
            Create trip
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    </>
  );
}
