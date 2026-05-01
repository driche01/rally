/**
 * Edit Trip — mirrors the new-trip form so the planner sees every field
 * with its current state pre-filled. Differences from new-trip:
 *   - "Update trip" instead of "Create"
 *   - Inline warnings when an edit affects a poll that already has
 *     responses ("This will reset N existing votes")
 *   - Follow-up SMS editor at the bottom; broadcast to the group on
 *     update so respondents know plans changed
 *   - Contacts section is deferred — managed via the dashboard's
 *     participant roster instead
 *
 * State lives as the union of trip primitives + per-poll option lists
 * (destinations[], selectedDays[], budgets[]). On hydrate
 * we read the trip + its existing polls and reconstruct that shape so
 * the form matches reality. On Update we sync trip primitives + recreate
 * the affected polls (existing polls get deleted; cascade clears their
 * responses), then fan out the follow-up SMS.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { MultiDatePicker, groupConsecutiveDays } from '@/components/MultiDatePicker';
import { CustomPollsSection, cleanCustomPoll } from '@/components/trips/CustomPollsSection';
import { FormSectionHeader } from '@/components/trips/FormSectionHeader';
import { BookByPicker } from '@/components/trips/BookByPicker';
import { GroupSection } from '@/components/trips/GroupSection';
import type { CustomPoll } from '@/types/polls';
import { useTrip, useUpdateTrip } from '@/hooks/useTrips';
import { usePolls } from '@/hooks/usePolls';
import { broadcastToSession, getActiveTripSession } from '@/lib/api/dashboard';
import { supabase } from '@/lib/supabase';
import { parseDateRangeLabel } from '@/lib/pollFormUtils';
import {
  computeCadence,
  daysUntil,
  deriveResponsesDue,
  formatCadenceDate,
} from '@/lib/cadence';
import type { GroupSizeBucket, PollWithOptions } from '@/types/database';

const BUDGET_OPTIONS = ['Under $500', '$500–$1k', '$1k–$2.5k', 'Above $2.5k'];

// Mirror of new.tsx — same chip set + canonical title so creation and
// editing stay in lockstep. Migrations 058/059 lock this exact title for
// the duration poll, so don't rename without also updating those.
const DURATION_OPTIONS = [
  '2 nights',
  '3 nights',
  '5 nights',
  '7 nights',
];

// Old chip labels carried a parenthetical hint (e.g. "2 nights (weekend)").
// Normalize stored options so trips created before the relabel still light
// up the right preset chips on edit.
function normalizeDurationLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '').trim();
}
const DURATION_POLL_TITLE = 'How long should the trip be?';

const FORM_LABEL_STYLE = { fontSize: 14, fontWeight: '500' as const, color: '#404040' };

function bucketFromSize(n: number): GroupSizeBucket {
  if (n <= 4) return '0-4';
  if (n <= 8) return '5-8';
  if (n <= 12) return '9-12';
  if (n <= 20) return '13-20';
  return '20+';
}

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

function expandRangesToDayLabels(ranges: Array<{ start: string | null; end: string | null }>): string[] {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const seen = new Map<string, Date>();
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

/**
 * Parse a per-day poll option label ("Jun 17") into ISO 'YYYY-MM-DD'.
 * Used to hydrate `selectedDays` from an existing dates poll.
 */
function parseDateOptionToISO(label: string): string | null {
  const r = parseDateRangeLabel(label);
  if (!r) return null;
  // Per-day options have start === end. Take the start.
  return r.start.toISOString().slice(0, 10);
}

export default function EditTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: trip, isLoading: tripLoading } = useTrip(id);
  const { data: polls = [], isLoading: pollsLoading } = usePolls(id);
  const updateTrip = useUpdateTrip();

  const [name, setName] = useState('');
  const [destinations, setDestinations] = useState<Array<{ name: string; address: string }>>([{ name: '', address: '' }]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const dateRanges = useMemo(
    () => groupConsecutiveDays(selectedDays).map((g) => ({ start: g.start, end: g.end === g.start ? null : g.end })),
    [selectedDays],
  );
  // Mirrors new.tsx: a single date range whose night-count matches the only
  // selected duration is treated as decided (no dates poll, no duration poll).
  const decidedDateRange = useMemo<{ start: string; end: string | null } | null>(() => {
    if (dateRanges.length !== 1 || durations.length !== 1) return null;
    const r = dateRanges[0];
    if (!r.start) return null;
    const m = durations[0].trim().match(/^(\d+)\s*nights?\b/i);
    if (!m) return null;
    const nights = Number(m[1]);
    const startMs = new Date(r.start + 'T12:00:00').getTime();
    const endMs = new Date((r.end ?? r.start) + 'T12:00:00').getTime();
    const days = Math.round((endMs - startMs) / 86400000) + 1;
    return nights === days - 1 ? r : null;
  }, [dateRanges, durations]);
  const [budgets, setBudgets] = useState<string[]>([]);
  const [customBudgets, setCustomBudgets] = useState<string[]>([]);
  const [customBudgetInput, setCustomBudgetInput] = useState('');
  const [customBudgetOpen, setCustomBudgetOpen] = useState(false);
  // Duration: mirror of new.tsx state. 0 → free-form poll, 1 → decided
  // (writes trips.trip_duration), 2+ → live multi-select chip poll.
  const [durations, setDurations] = useState<string[]>([]);
  const [customDurations, setCustomDurations] = useState<string[]>([]);
  const [customDurationInput, setCustomDurationInput] = useState('');
  const [customDurationOpen, setCustomDurationOpen] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [bookByDate, setBookByDate] = useState<string | null>(null);
  const [customIntroSms, setCustomIntroSms] = useState<string | null>(null);
  const [followupSms, setFollowupSms] = useState('');
  const [followupUserEdited, setFollowupUserEdited] = useState(false);
  const [customPolls, setCustomPolls] = useState<CustomPoll[]>([]);
  const [errors, setErrors] = useState<{ name?: string; bookBy?: string }>({});
  const [initialized, setInitialized] = useState(false);

  // Snapshot of initial form state for diff detection. Captured when we
  // hydrate so we can tell the planner "X has X new responses — editing
  // will reset them."
  const [initialSnapshot, setInitialSnapshot] = useState<{
    destinations: string[];
    selectedDays: string[];
    budgets: string[];
    durations: string[];
    customPolls: { pollId: string | null; question: string; options: string[]; allowMulti: boolean }[];
  } | null>(null);

  // Per-poll-type response counts. Hydrated alongside the form.
  const [responseCounts, setResponseCounts] = useState<Record<string, number>>({});

  // ─── Hydrate state from trip + polls ─────────────────────────────────────
  useEffect(() => {
    if (initialized || tripLoading || pollsLoading || !trip) return;

    setName(trip.name);
    setBookByDate(trip.book_by_date ?? null);
    setCustomIntroSms(trip.custom_intro_sms ?? null);

    // Destination: prefer poll options if a poll exists, else use trip primitive
    const destPoll = polls.find((p) => p.type === 'destination');
    if (destPoll && destPoll.poll_options.length > 0) {
      setDestinations(destPoll.poll_options.map((o) => ({ name: o.label, address: '' })));
    } else if (trip.destination) {
      setDestinations([{ name: trip.destination, address: trip.destination_address ?? '' }]);
    } else {
      setDestinations([{ name: '', address: '' }]);
    }

    // Dates: parse per-day option labels back to ISO. If no poll, use trip primitives.
    const datesPoll = polls.find((p) => p.type === 'dates');
    if (datesPoll && datesPoll.poll_options.length > 0) {
      const isoDays: string[] = [];
      for (const o of datesPoll.poll_options) {
        const iso = parseDateOptionToISO(o.label);
        if (iso) isoDays.push(iso);
      }
      setSelectedDays(isoDays);
    } else if (trip.start_date) {
      // Fill the range from start_date to end_date (or just start_date)
      const days: string[] = [];
      const s = new Date(trip.start_date + 'T12:00:00');
      const e = trip.end_date ? new Date(trip.end_date + 'T12:00:00') : new Date(s);
      for (let d = new Date(s); d.getTime() <= e.getTime(); d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().slice(0, 10));
      }
      setSelectedDays(days);
    } else {
      setSelectedDays([]);
    }

    // Budget: poll options + carve out custom buckets
    const budgetPoll = polls.find((p) => p.type === 'budget');
    if (budgetPoll && budgetPoll.poll_options.length > 0) {
      const labels = budgetPoll.poll_options.map((o) => o.label);
      setBudgets(labels);
      setCustomBudgets(labels.filter((l) => !BUDGET_OPTIONS.includes(l)));
    } else if (trip.budget_per_person) {
      setBudgets([trip.budget_per_person]);
      if (!BUDGET_OPTIONS.includes(trip.budget_per_person)) {
        setCustomBudgets([trip.budget_per_person]);
      }
    } else {
      setBudgets([]);
      setCustomBudgets([]);
    }

    // Duration: prefer the canonical custom poll's options if present.
    // Falls back to trip.trip_duration (decided value, no poll) if the
    // poll doesn't exist yet (older trips created before the duration
    // section shipped).
    const durationPoll = polls.find((p) => p.type === 'custom' && p.title === DURATION_POLL_TITLE);
    if (durationPoll) {
      const labels = durationPoll.poll_options.map((o) => normalizeDurationLabel(o.label));
      setDurations(labels);
      setCustomDurations(labels.filter((l) => !DURATION_OPTIONS.includes(l)));
    } else if (trip.trip_duration) {
      const normalized = normalizeDurationLabel(trip.trip_duration);
      setDurations([normalized]);
      if (!DURATION_OPTIONS.includes(normalized)) {
        setCustomDurations([normalized]);
      }
    } else {
      setDurations([]);
      setCustomDurations([]);
    }

    // Custom polls — every type='custom' poll. The canonical duration
    // poll is filtered out (it has its own form section) so it doesn't
    // surface twice as a planner-defined question.
    const hydratedCustom: CustomPoll[] = polls
      .filter((p) => p.type === 'custom' && p.title !== DURATION_POLL_TITLE)
      .map((p) => ({
        id: p.id,
        pollId: p.id,
        question: p.title,
        options: p.poll_options.map((o) => o.label),
        allowMulti: p.allow_multi_select ?? false,
      }));
    setCustomPolls(hydratedCustom);

    setInitialized(true);
  }, [trip, polls, tripLoading, pollsLoading, initialized]);

  // Capture initial snapshot once form is hydrated
  useEffect(() => {
    if (!initialized || initialSnapshot !== null) return;
    setInitialSnapshot({
      destinations: destinations.map((d) => d.name).filter(Boolean),
      selectedDays: [...selectedDays],
      budgets: [...budgets],
      durations: [...durations],
      customPolls: customPolls.map((cp) => ({
        pollId: cp.pollId ?? null,
        question: cp.question,
        options: [...cp.options],
        allowMulti: cp.allowMulti,
      })),
    });
  }, [initialized, initialSnapshot, destinations, selectedDays, budgets, durations, customPolls]);

  // Pull poll-response counts so we can warn the planner about edits
  // that would reset existing votes.
  useEffect(() => {
    if (!initialized || polls.length === 0) return;
    let cancelled = false;
    (async () => {
      const counts: Record<string, number> = {};
      for (const p of polls) {
        const { count } = await supabase
          .from('poll_responses')
          .select('id', { count: 'exact', head: true })
          .eq('poll_id', p.id);
        counts[p.type === 'custom' ? p.id : p.type] = count ?? 0;
      }
      if (!cancelled) setResponseCounts(counts);
    })();
    return () => { cancelled = true; };
  }, [initialized, polls]);

  // ─── Diff detection ──────────────────────────────────────────────────────
  function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
    return true;
  }

  const destChanged = useMemo(() => {
    if (!initialSnapshot) return false;
    return !arraysEqual(initialSnapshot.destinations, destinations.map((d) => d.name).filter(Boolean));
  }, [initialSnapshot, destinations]);

  const datesChanged = useMemo(() => {
    if (!initialSnapshot) return false;
    return !arraysEqual(initialSnapshot.selectedDays, selectedDays);
  }, [initialSnapshot, selectedDays]);

  const budgetsChanged = useMemo(() => {
    if (!initialSnapshot) return false;
    return !arraysEqual(initialSnapshot.budgets, budgets);
  }, [initialSnapshot, budgets]);

  const durationsChanged = useMemo(() => {
    if (!initialSnapshot) return false;
    return !arraysEqual(initialSnapshot.durations, durations);
  }, [initialSnapshot, durations]);

  // Per-custom-poll diff. A custom poll has changed if its question,
  // option list, or allow-multi flag differs from the snapshot.
  function customPollChanged(cp: CustomPoll): boolean {
    if (!initialSnapshot) return false;
    if (!cp.pollId) return true; // brand-new poll added in this session
    const snap = initialSnapshot.customPolls.find((s) => s.pollId === cp.pollId);
    if (!snap) return true;
    if (snap.question !== cp.question) return true;
    if (snap.allowMulti !== cp.allowMulti) return true;
    if (!arraysEqual(snap.options, cp.options)) return true;
    return false;
  }

  /** Custom polls present in the snapshot but no longer in state — must be deleted on save. */
  const removedCustomPolls = useMemo(() => {
    if (!initialSnapshot) return [] as { pollId: string; question: string }[];
    const currentIds = new Set(customPolls.map((c) => c.pollId).filter(Boolean) as string[]);
    return initialSnapshot.customPolls
      .filter((s) => s.pollId && !currentIds.has(s.pollId))
      .map((s) => ({ pollId: s.pollId as string, question: s.question }));
  }, [initialSnapshot, customPolls]);

  // Aggregate: any field changed that has existing responses?
  const affectedPolls = useMemo(() => {
    const affected: string[] = [];
    if (destChanged && (responseCounts['destination'] ?? 0) > 0) affected.push(`destination (${responseCounts['destination']} votes)`);
    if (datesChanged && (responseCounts['dates'] ?? 0) > 0) affected.push(`trip dates (${responseCounts['dates']} votes)`);
    if (budgetsChanged && (responseCounts['budget'] ?? 0) > 0) affected.push(`spend per person (${responseCounts['budget']} votes)`);
    // Edited custom polls with existing votes
    for (const cp of customPolls) {
      if (cp.pollId && customPollChanged(cp) && (responseCounts[cp.pollId] ?? 0) > 0) {
        const label = cp.question.trim() || 'a custom question';
        affected.push(`"${label}" (${responseCounts[cp.pollId]} votes)`);
      }
    }
    // Removed custom polls with existing votes
    for (const removed of removedCustomPolls) {
      if ((responseCounts[removed.pollId] ?? 0) > 0) {
        const label = removed.question.trim() || 'a custom question';
        affected.push(`"${label}" (removed, ${responseCounts[removed.pollId]} votes)`);
      }
    }
    return affected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destChanged, datesChanged, budgetsChanged, responseCounts, polls, customPolls, removedCustomPolls, initialSnapshot]);

  // Default follow-up SMS body — used until the planner edits it.
  // The bracketed tokens ([Name], [Planner]) stay as literals here;
  // per-recipient substitution happens server-side at broadcast time.
  const defaultFollowup = useMemo(() => {
    const changedFields: string[] = [];
    if (destChanged) {
      const n = destinations.filter((d) => d.name.trim()).length;
      changedFields.push(n >= 2 ? 'the destination options' : 'the destination');
    }
    if (datesChanged) {
      changedFields.push('the trip dates');
    }
    if (budgetsChanged) {
      changedFields.push(budgets.length >= 2 ? 'the budget options' : 'the budget');
    }
    // Any added / edited / removed custom polls.
    const anyCustomChanged =
      removedCustomPolls.length > 0 ||
      customPolls.some((cp) => customPollChanged(cp));
    if (anyCustomChanged) {
      changedFields.push('the custom questions');
    }
    const summary =
      changedFields.length === 0
        ? 'the trip details'
        : changedFields.length === 1
          ? changedFields[0]
          : changedFields.length === 2
            ? `${changedFields[0]} and ${changedFields[1]}`
            : `${changedFields.slice(0, -1).join(', ')}, and ${changedFields[changedFields.length - 1]}`;
    const url = trip ? `https://rallysurveys.netlify.app/respond/${trip.share_token}` : '';
    return `Hey [Name] — [Planner] made some updates to ${summary} for the trip. Update your responses here: ${url}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    destChanged,
    datesChanged,
    budgetsChanged,
    trip,
    destinations,
    budgets,
    customPolls,
    removedCustomPolls,
    initialSnapshot,
  ]);

  // Keep follow-up in sync with the default until the planner manually edits it
  useEffect(() => {
    if (!followupUserEdited) setFollowupSms(defaultFollowup);
  }, [defaultFollowup, followupUserEdited]);

  // ─── Cadence preview ─────────────────────────────────────────────────────
  const responsesDueDate = deriveResponsesDue(bookByDate);
  const cadencePreview = bookByDate && responsesDueDate
    ? computeCadence({ responsesDueDate }).filter((it) => it.kind !== 'initial')
    : [];
  const bookByDays = daysUntil(bookByDate);
  const showShortNoticeWarning = bookByDays !== null && bookByDays >= 0 && bookByDays < 5;
  const bookByChanged = (trip?.book_by_date ?? null) !== bookByDate;

  // ─── Validation ──────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Trip name is required';
    if (!bookByDate) errs.bookBy = 'Pick a date you need to book by';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function resolvedSize(): { bucket: GroupSizeBucket; precise: number | null } {
    const precise = trip?.group_size_precise ?? null;
    if (precise) return { bucket: bucketFromSize(precise), precise };
    return { bucket: trip?.group_size_bucket ?? '0-4', precise: null };
  }

  // ─── Update flow ─────────────────────────────────────────────────────────
  async function handleUpdate() {
    if (!validate() || !trip) return;

    if (affectedPolls.length > 0) {
      // Defer the actual write until the planner confirms.
      Alert.alert(
        'Resetting existing responses',
        `Some edits will reset votes on: ${affectedPolls.join(', ')}. Rally will text the group with your follow-up message. Continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Update', style: 'destructive', onPress: () => doUpdate() },
        ],
      );
      return;
    }
    await doUpdate();
  }

  async function doUpdate() {
    if (!trip) return;
    const { bucket, precise } = resolvedSize();

    const cleanDestinations = destinations
      .map((d) => ({ name: d.name.trim(), address: d.address.trim() }))
      .filter((d) => d.name.length > 0);
    const cleanDateRanges = dateRanges.filter((r) => r.start);
    const cleanBudgets = budgets;
    const cleanDurations = durations.map((s) => s.trim()).filter((s) => s.length > 0);

    try {
      // 1. Update trip primitives. start/end/destination/budget/duration
      //    follow the 0-or-1 contract (1 option = decided value, anything
      //    else clears the column so polls own it).
      await updateTrip.mutateAsync({
        id: trip.id,
        name: name.trim(),
        group_size_bucket: bucket,
        group_size_precise: precise,
        start_date: cleanDateRanges.length === 1 ? cleanDateRanges[0].start : null,
        end_date: cleanDateRanges.length === 1 ? cleanDateRanges[0].end : null,
        budget_per_person: cleanBudgets.length === 1 ? cleanBudgets[0] : null,
        destination: cleanDestinations.length === 1 ? cleanDestinations[0].name : null,
        destination_address: cleanDestinations.length === 1 ? cleanDestinations[0].address : null,
        // Decided duration: only set when exactly 1 option provided.
        // 0 → free-form poll handled below; 2+ → live poll handled below.
        trip_duration: cleanDurations.length === 1 ? cleanDurations[0] : null,
        book_by_date: bookByDate,
        custom_intro_sms: customIntroSms,
      });

      // 2. Sync polls. For each field type, delete the existing poll(s)
      //    and recreate based on current state. Cascade clears responses.
      //    We only rebuild the polls for fields that actually changed —
      //    untouched polls stay intact.
      if (destChanged) {
        await rebuildPoll(trip.id, polls, 'destination', cleanDestinations.map((d) => d.name), 'Where do you want to go?', true);
      }
      if (datesChanged) {
        await rebuildPoll(trip.id, polls, 'dates', expandRangesToDayLabels(cleanDateRanges), 'When are you free?', true);
      }
      if (budgetsChanged) {
        await rebuildPoll(trip.id, polls, 'budget', cleanBudgets, "What's your budget? (travel + lodging only)", false);
      }

      if (durationsChanged) {
        // The duration poll is a custom poll keyed off DURATION_POLL_TITLE.
        // Empty options → free-form numeric mode (allowEmpty=true keeps the
        // poll record so respondents see a number input on the survey).
        const existingDurationPoll = polls.find(
          (p) => p.type === 'custom' && p.title === DURATION_POLL_TITLE,
        );
        await rebuildCustomPoll(
          trip.id,
          existingDurationPoll?.id ?? null,
          DURATION_POLL_TITLE,
          cleanDurations,
          true,
          true,
        );
      }

      // Rebuild changed custom polls (added or edited)
      let anyCustomChanged = false;
      for (const cp of customPolls) {
        if (!customPollChanged(cp)) continue;
        anyCustomChanged = true;
        const cleaned = cleanCustomPoll(cp);
        if (!cleaned) {
          // Empty edit — delete the existing poll if any, create nothing.
          if (cp.pollId) {
            await supabase.from('polls').delete().eq('id', cp.pollId);
          }
          continue;
        }
        await rebuildCustomPoll(trip.id, cp.pollId ?? null, cleaned.question, cleaned.options, cleaned.allowMulti);
      }
      // Delete polls that were removed entirely.
      for (const removed of removedCustomPolls) {
        anyCustomChanged = true;
        await supabase.from('polls').delete().eq('id', removed.pollId);
      }

      // 3. Send follow-up SMS to the group if any field changed.
      const anyChanged = destChanged || datesChanged || budgetsChanged || durationsChanged || anyCustomChanged;
      if (anyChanged && followupSms.trim().length > 0) {
        try {
          const session = await getActiveTripSession(trip.id);
          if (session) await broadcastToSession(session.id, followupSms.trim());
        } catch (err) {
          console.warn('[edit-trip] follow-up broadcast failed:', err);
        }
      }

      router.back();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Try again.';
      Alert.alert('Could not update', msg);
    }
  }

  if (tripLoading || pollsLoading || !initialized) {
    return (
      <View className="flex-1 items-center justify-center" style={{ paddingTop: insets.top }}>
        <ActivityIndicator size="large" color="#0F3F2E" />
      </View>
    );
  }

  return (
    <>
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
          {/* Trip name — top-level field above any step header, mirroring
              the new-rally screen so the two flows look identical. */}
          <View className="gap-2">
            <Text style={FORM_LABEL_STYLE}>Trip name</Text>
            <Input
              placeholder="e.g. Bali 2026, Jake's 30th, Ski Weekend"
              value={name}
              onChangeText={(t) => { if (t.length <= 60) setName(t); }}
              maxLength={60}
              error={errors.name}
              hint={`${name.length}/60`}
              autoFocus={false}
            />
          </View>

          <FormSectionHeader step="01" title="Who's invited" first />

          {/* Roster — add/remove members. Each action fires a 1:1 SMS via
              the member-add / member-remove edge functions. */}
          <GroupSection tripId={trip!.id} />

          <FormSectionHeader step="02" title="What you're deciding" />

          {/* Destination */}
          <View className="gap-2">
            <View className="flex-row items-baseline justify-between">
              <Text style={FORM_LABEL_STYLE}>Destination</Text>
              {(() => {
                const filled = destinations.filter((d) => d.name.trim()).length;
                if (filled >= 2) return <Text className="text-[11px] font-semibold text-green">Will be polled</Text>;
                if (filled === 1) return <Text className="text-[11px] font-semibold text-green">Decided</Text>;
                return <Text className="text-[11px] font-semibold text-[#737373]">Group decides</Text>;
              })()}
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
                  >
                    <Ionicons name="close-circle" size={20} color="#A0A0A0" />
                  </Pressable>
                ) : null}
              </View>
            ))}
            <Pressable
              onPress={() => setDestinations((prev) => [...prev, { name: '', address: '' }])}
              className="flex-row items-center gap-1 self-start mt-1"
            >
              <Ionicons name="add-outline" size={14} color="#0F3F2E" />
              <Text className="text-[13px] font-semibold text-green">Add another option</Text>
            </Pressable>
            {destChanged && (responseCounts['destination'] ?? 0) > 0 ? (
              <ResetWarning votes={responseCounts['destination']} />
            ) : null}
          </View>

          {/* How long? — placed above Trip dates because the date picker is
              a *window* (the trip itself can be shorter than the picked
              range). 0 = free-form poll, 1 = decided (writes
              trips.trip_duration), 2+ = live multi-select chip poll. */}
          <View className="gap-2">
            <View className="flex-row items-baseline justify-between">
              <Text style={FORM_LABEL_STYLE}>How long?</Text>
              {durations.length >= 2 ? (
                <Text className="text-[11px] font-semibold text-green">Will be polled</Text>
              ) : durations.length === 1 ? (
                <Text className="text-[11px] font-semibold text-green">Decided</Text>
              ) : (
                <Text className="text-[11px] font-semibold text-[#737373]">Group decides</Text>
              )}
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
                    onPress={() => setDurations((prev) => sel ? prev.filter((d) => d !== opt) : [...prev, opt])}
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
                      setDurations((prev) => [...prev, v]);
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

          {/* Trip dates */}
          <View className="gap-2">
            <View className="flex-row items-baseline justify-between">
              <Text style={FORM_LABEL_STYLE}>
                {decidedDateRange ? 'Trip dates' : 'Trip dates window'}
              </Text>
              {decidedDateRange ? (
                <Text className="text-[11px] font-semibold text-green">Decided</Text>
              ) : dateRanges.length >= 1 ? (
                <Text className="text-[11px] font-semibold text-green">Will be polled</Text>
              ) : (
                <Text className="text-[11px] font-semibold text-[#737373]">Group decides</Text>
              )}
            </View>
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
              <Text className="text-[12px] text-[#737373]">{selectedDays.length === 0 ? '' : 'Edit'}</Text>
            </TouchableOpacity>
            {dateRanges.length > 0 ? (
              <View className="rounded-xl border border-line bg-card overflow-hidden mt-1">
                {dateRanges.map((r, i) => {
                  const label = formatDateRangeLabel(r.start, r.end);
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
                        <Text className="text-[12px] text-[#737373]">· {days} day{days === 1 ? '' : 's'}</Text>
                      </View>
                      <Pressable
                        onPress={() => {
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
                      >
                        <Ionicons name="close-circle" size={18} color="#A0A0A0" />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ) : null}
            {datesChanged && (responseCounts['dates'] ?? 0) > 0 ? (
              <ResetWarning votes={responseCounts['dates']} />
            ) : null}
          </View>

          {/* Spend per person */}
          <View className="gap-2">
            <View className="flex-row items-baseline justify-between">
              <View className="flex-row items-center gap-1.5">
                <Text style={FORM_LABEL_STYLE}>Spend per person</Text>
                <Pressable
                  onPress={() => Alert.alert('Spend per person', 'Travel + lodging only. Meals and activities are split separately.')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="More info on spend per person"
                >
                  <Ionicons name="information-circle-outline" size={16} color="#A0A0A0" />
                </Pressable>
              </View>
              {budgets.length >= 2 ? (
                <Text className="text-[11px] font-semibold text-green">Will be polled</Text>
              ) : budgets.length === 1 ? (
                <Text className="text-[11px] font-semibold text-green">Decided</Text>
              ) : (
                <Text className="text-[11px] font-semibold text-[#737373]">Group decides</Text>
              )}
            </View>
            <View className="flex-row flex-wrap gap-2">
              {BUDGET_OPTIONS.map((opt) => {
                const sel = budgets.includes(opt);
                return (
                  <Pressable
                    key={opt}
                    onPress={() => setBudgets((prev) => sel ? prev.filter((b) => b !== opt) : [...prev, opt])}
                    className={`px-3.5 py-2 rounded-full border-[1.5px] ${sel ? 'border-green bg-green-soft' : 'border-line bg-card'}`}
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
                    >
                      <Text className={`text-sm font-medium ${sel ? 'text-green' : 'text-[#525252]'}`}>{opt}</Text>
                      <Pressable
                        onPress={() => {
                          setCustomBudgets((prev) => prev.filter((b) => b !== opt));
                          setBudgets((prev) => prev.filter((b) => b !== opt));
                        }}
                        hitSlop={8}
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
                      setBudgets((prev) => [...prev, v]);
                    }
                    setCustomBudgetInput('');
                    setCustomBudgetOpen(false);
                  }}
                  className="px-3.5 py-2 rounded-full bg-green"
                >
                  <Text className="text-sm font-semibold text-white">Add</Text>
                </Pressable>
                <Pressable onPress={() => { setCustomBudgetInput(''); setCustomBudgetOpen(false); }} hitSlop={8}>
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

            {budgetsChanged && (responseCounts['budget'] ?? 0) > 0 ? (
              <ResetWarning votes={responseCounts['budget']} />
            ) : null}
          </View>

          {/* Custom polls — free-form questions added by the planner. */}
          <CustomPollsSection
            value={customPolls}
            onChange={setCustomPolls}
            renderResetWarning={(cp) => {
              if (!cp.pollId) return null;
              const votes = responseCounts[cp.pollId] ?? 0;
              if (votes === 0) return null;
              if (!customPollChanged(cp)) return null;
              return <ResetWarning votes={votes} />;
            }}
          />

          <FormSectionHeader step="03" title="When Rally texts" />

          {/* Book-by date */}
          <View className="gap-2">
            <Text style={FORM_LABEL_STYLE}>When do you need to book by?</Text>
            {bookByChanged ? (
              <Text style={{ fontSize: 13, color: '#92400E', marginTop: -2 }}>
                Changing this recalculates the nudge schedule for everyone who hasn't responded.
              </Text>
            ) : null}
            <BookByPicker
              value={bookByDate}
              onChange={(d) => { setBookByDate(d); setErrors((e) => ({ ...e, bookBy: undefined })); }}
              hasError={Boolean(errors.bookBy)}
            />
            {errors.bookBy ? <Text className="text-[13px] text-red-500">{errors.bookBy}</Text> : null}
            {showShortNoticeWarning && (
              <View className="mt-1 px-3 py-2.5 rounded-xl bg-[#FEF3C7] border border-[#FDE68A]">
                <Text className="text-[13px] font-medium text-[#92400E]">Tight timeline</Text>
                <Text className="text-[12px] text-[#78350F] mt-0.5">
                  Rally will only have time for limited nudges before {formatCadenceDate(bookByDate!)}.
                </Text>
              </View>
            )}
            {cadencePreview.length > 0 && !showShortNoticeWarning && bookByChanged && (
              <View className="mt-1 px-3 py-2.5 rounded-xl bg-green-soft border border-[#C8D8B5]">
                <Text className="text-[12px] font-medium text-green">New nudge schedule</Text>
                <Text className="text-[12px] text-[#235C38] mt-1 leading-[18px]">
                  {cadencePreview.map((it) => formatCadenceDate(it.scheduledFor)).join(' · ')}
                </Text>
                {responsesDueDate && (
                  <Text className="text-[11px] text-[#5F685F] mt-1.5">
                    Responses due {formatCadenceDate(responsesDueDate)} (3 days before book-by)
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Rally's follow-up text — only meaningful if something changed */}
          {(destChanged || datesChanged || budgetsChanged
            || removedCustomPolls.length > 0
            || customPolls.some((cp) => customPollChanged(cp))) ? (
            <View className="gap-2">
              <Text style={FORM_LABEL_STYLE}>Rally's follow-up text</Text>
              <TextInput
                value={followupSms}
                onChangeText={(t) => {
                  setFollowupUserEdited(true);
                  setFollowupSms(t);
                }}
                multiline
                placeholder={defaultFollowup}
                placeholderTextColor="#a3a3a3"
                style={{
                  backgroundColor: 'white',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: '#E5E5E5',
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontSize: 14,
                  color: '#163026',
                  minHeight: 100,
                  textAlignVertical: 'top',
                }}
                maxLength={320}
              />
              <View className="flex-row justify-between">
                <Text className="text-[11px] text-[#737373] flex-1">
                  Use [Name], [Planner], [Destination], or [Trip] — each invitee gets their own values filled in.
                </Text>
                <Text className="text-[11px] text-[#888]">{followupSms.length} / 320</Text>
              </View>
            </View>
          ) : null}

          <Button onPress={handleUpdate} loading={updateTrip.isPending} fullWidth>
            Update trip
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    </>
  );
}

// ─── Inline reset warning ─────────────────────────────────────────────────────

function ResetWarning({ votes }: { votes: number }) {
  return (
    <View className="mt-1 px-3 py-2.5 rounded-xl bg-[#FEF3C7] border border-[#FDE68A] flex-row items-start gap-2">
      <Ionicons name="warning-outline" size={14} color="#92400E" style={{ marginTop: 1 }} />
      <View className="flex-1">
        <Text className="text-[13px] font-semibold text-[#92400E]">
          {votes} existing {votes === 1 ? 'vote' : 'votes'} will be reset
        </Text>
        <Text className="text-[12px] text-[#78350F] mt-0.5">
          Rally will text the group with your follow-up message so they can re-vote.
        </Text>
      </View>
    </View>
  );
}

// ─── Poll rebuild helpers ─────────────────────────────────────────────────────

/**
 * Delete every existing poll of `pollType` for this trip + recreate
 * based on the new option list.
 *   options.length === 0 → no poll re-created
 *   options.length === 1 → DECIDED poll with that option
 *   options.length >= 2 → LIVE poll with those options
 *
 * Cascade-deletes any existing poll_responses on the old polls.
 */
async function rebuildPoll(
  tripId: string,
  existing: PollWithOptions[],
  pollType: 'destination' | 'dates' | 'budget',
  optionLabels: string[],
  title: string,
  multiSelect: boolean,
): Promise<void> {
  const old = existing.filter((p) => p.type === pollType);
  for (const p of old) {
    await supabase.from('polls').delete().eq('id', p.id);
  }
  if (optionLabels.length === 0) return;

  // Preserve the rebuilt poll's slot in survey order. Multi-field edits
  // call this for each changed type — collapsing every rebuilt poll to
  // position 0 collides them. If no prior poll of this type existed,
  // append after the rest of the trip's polls.
  const position = old[0]?.position ?? existing.length;

  const status = optionLabels.length === 1 ? 'decided' : 'live';
  const { data: poll } = await supabase
    .from('polls')
    .insert({
      trip_id: tripId,
      type: pollType,
      title,
      status,
      allow_multi_select: multiSelect && optionLabels.length >= 2,
      position,
    })
    .select()
    .single();
  if (!poll) return;

  const optsRows = optionLabels.map((label, i) => ({ poll_id: poll.id, label, position: i }));
  const { data: insertedOpts } = await supabase
    .from('poll_options')
    .insert(optsRows)
    .select();

  // For decided polls, point decided_option_id at the single option
  if (status === 'decided' && insertedOpts && insertedOpts[0]) {
    await supabase
      .from('polls')
      .update({ decided_option_id: insertedOpts[0].id })
      .eq('id', poll.id);
  }
}

/**
 * Rebuild a custom poll. If `existingPollId` is non-null, that poll is
 * deleted first (cascade clears its responses). Then a fresh poll is
 * inserted with the given title, options, and multi-select flag.
 *
 * Used by both the trip-length poll (single canonical custom poll) and
 * the arbitrary planner-defined custom polls. The caller resolves which
 * poll-id to delete; this function never matches by title.
 */
async function rebuildCustomPoll(
  tripId: string,
  existingPollId: string | null,
  title: string,
  optionLabels: string[],
  multiSelect: boolean,
  allowEmptyOptions = false,
): Promise<void> {
  // Preserve the edited poll's original position; for a brand-new poll
  // (no existingPollId), append after every other poll on the trip.
  // Hardcoding position: 0 collides with sibling polls.
  let position: number;
  if (existingPollId) {
    const { data: priorRow } = await supabase
      .from('polls')
      .select('position')
      .eq('id', existingPollId)
      .maybeSingle();
    position = priorRow?.position ?? 0;
    await supabase.from('polls').delete().eq('id', existingPollId);
  } else {
    const { count } = await supabase
      .from('polls')
      .select('*', { count: 'exact', head: true })
      .eq('trip_id', tripId);
    position = count ?? 0;
  }

  // Free-form mode (allowEmptyOptions=true): the duration poll without
  // preset chips creates a poll record with NO poll_options so the survey
  // renders a numeric input. Otherwise, an empty options list means the
  // planner cleared the poll — return without inserting anything.
  if (optionLabels.length === 0 && !allowEmptyOptions) return;

  const isFreeForm = optionLabels.length === 0;
  const status = optionLabels.length === 1 ? 'decided' : 'live';
  const { data: poll } = await supabase
    .from('polls')
    .insert({
      trip_id: tripId,
      type: 'custom',
      title,
      status,
      allow_multi_select: multiSelect && optionLabels.length >= 2,
      position,
    })
    .select()
    .single();
  if (!poll) return;

  if (isFreeForm) return;

  const optsRows = optionLabels.map((label, i) => ({ poll_id: poll.id, label, position: i }));
  const { data: insertedOpts } = await supabase
    .from('poll_options')
    .insert(optsRows)
    .select();

  if (status === 'decided' && insertedOpts && insertedOpts[0]) {
    await supabase
      .from('polls')
      .update({ decided_option_id: insertedOpts[0].id })
      .eq('id', poll.id);
  }
}
