/**
 * Group member poll response screen.
 *
 * Works as:
 *  - Native deep link: rally://respond/[tripId]   → opens this screen in the app
 *  - Web fallback:     https://rallyapp.io/respond/[tripId] → served via Expo web
 *
 * No auth required. Name captured once, stored in localStorage / AsyncStorage.
 * After submitting, shows a download prompt to convert respondents → planners.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, useCelebration } from '@/components/ui';
import { getTripByShareToken } from '@/lib/api/trips';
import { enrollRespondentAsMember } from '@/lib/api/members';
import { normalizePhone } from '@/lib/phone';
import { EmailCapture } from '@/components/landing/EmailCapture';
import { MultiDatePicker } from '@/components/MultiDatePicker';
import {
  getOrCreateRespondent,
  getExistingRespondentForTrip,
  getExistingResponses,
  getExistingNumericResponses,
  submitPollResponses,
  clearTripSession,
  sendSurveyConfirmationSms,
} from '@/lib/api/respondents';
import { daysUntil, formatCadenceDate } from '@/lib/cadence';
import { getTripStage } from '@/lib/tripStage';
import { getResponseCountsForTrip } from '@/lib/api/responses';
import { getProfileByToken, upsertProfileByToken } from '@/lib/api/travelerProfiles';
import { TravelerProfileForm } from '@/components/respond/TravelerProfileForm';
import type { TravelerProfile } from '@/types/profile';
import { capture, Events } from '@/lib/analytics';
import { log } from '@/lib/logger';
import type { TripWithPolls, PollWithOptions, Respondent } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { getBlocksForTrip, upsertDayRsvp, formatDayLabel, formatTime } from '@/lib/api/itinerary';
import type { ItineraryBlock, DayRsvpStatus } from '@/types/database';

// ─── Web layout ───────────────────────────────────────────────────────────────

const IS_WEB = Platform.OS === 'web';

/**
 * On web: renders a full-screen branded background with a centered white card.
 * On native: transparent passthrough — no change to layout.
 */
function WebPageShell({
  children,
  cardStyle,
}: {
  children: React.ReactNode;
  cardStyle?: object;
}) {
  if (!IS_WEB) return <>{children}</>;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#F4ECDF',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <View
        style={[
          {
            width: '100%',
            maxWidth: 480,
            backgroundColor: 'white',
            borderRadius: 24,
            overflow: 'hidden',
            // @ts-ignore — web-only CSS property
            boxShadow: '0 4px 40px rgba(0,0,0,0.10)',
          },
          cardStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

// ─── Name storage ─────────────────────────────────────────────────────────────

const NAME_KEY = 'rally_respondent_name';

async function getStoredName(): Promise<string> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(NAME_KEY) ?? '';
  }
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  return (await AsyncStorage.getItem(NAME_KEY)) ?? '';
}

async function storeName(name: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(NAME_KEY, name);
    return;
  }
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem(NAME_KEY, name);
}

// Canonical duration poll title — must match what trip-creation writes
// (DURATION_POLL_TITLE in app/(app)/trips/new.tsx). Used to identify the
// duration poll for free-form numeric rendering.
const DURATION_POLL_TITLE = 'How long should the trip be?';

// ─── Poll title (survey-side override) ────────────────────────────────────
// New polls are stored with respondent-friendly titles ("Where do you want
// to go?", etc.) directly. This override is kept as a normalization layer
// so that legacy polls created before the title refresh still render with
// the right framing on the survey screen. Custom polls (e.g. trip length)
// fall through to the planner's stored title.
function surveyPollTitle(poll: { type?: string | null; title?: string | null }): string {
  switch (poll.type) {
    case 'destination': return 'Where do you want to go?';
    case 'dates':       return 'When are you free?';
    case 'budget':      return "What's your budget? (travel + lodging only)";
    default:            return poll.title ?? '';
  }
}

function isDurationPoll(poll: { type?: string | null; title?: string | null }): boolean {
  return poll.type === 'custom' && poll.title === DURATION_POLL_TITLE;
}

// ─── Date range helpers ────────────────────────────────────────────────────────

const MONTH_ABBR: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseDateRangeLabel(label: string): { start: Date; end: Date } | null {
  const now = new Date();
  const currentYear = now.getFullYear();

  function dateFor(month: string, day: number): Date {
    const m = MONTH_ABBR[month];
    if (m === undefined) return new Date(NaN);
    const d = new Date(currentYear, m, day);
    // If more than 30 days in the past, assume next year
    if (d.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) {
      return new Date(currentYear + 1, m, day);
    }
    return d;
  }

  // "Mar 15 – Apr 2" (cross-month) or "Mar 15 – Mar 20" (same month, full)
  const rangeMatch = label.match(/^([A-Z][a-z]+)\s+(\d+)\s*[–\-]\s*([A-Z][a-z]+)\s+(\d+)$/);
  if (rangeMatch) {
    const start = dateFor(rangeMatch[1], parseInt(rangeMatch[2], 10));
    const end = dateFor(rangeMatch[3], parseInt(rangeMatch[4], 10));
    if (isNaN(start.getTime())) return null;
    return { start, end };
  }

  // "Apr 1–30" (same month, compact — no second month name)
  const compactMatch = label.match(/^([A-Z][a-z]+)\s+(\d+)[–\-](\d+)$/);
  if (compactMatch) {
    const start = dateFor(compactMatch[1], parseInt(compactMatch[2], 10));
    const end = dateFor(compactMatch[1], parseInt(compactMatch[3], 10));
    if (isNaN(start.getTime())) return null;
    return { start, end };
  }

  // "Mar 15" (single day)
  const singleMatch = label.match(/^([A-Z][a-z]+)\s+(\d+)$/);
  if (singleMatch) {
    const start = dateFor(singleMatch[1], parseInt(singleMatch[2], 10));
    if (isNaN(start.getTime())) return null;
    return { start, end: start };
  }

  return null;
}

function isDateRangeLabel(label: string): boolean {
  return /^[A-Z][a-z]{2,}\s+\d+/.test(label);
}

// ─── Single poll response row ──────────────────────────────────────────────────

function PollResponseCard({
  poll,
  selectedOptions,
  onSelect,
}: {
  poll: PollWithOptions;
  selectedOptions: string[];
  onSelect: (optionId: string) => void;
}) {
  return (
    <View className="mb-5">
      <Text className="mb-3 text-lg font-semibold text-ink">{surveyPollTitle(poll)}</Text>
      {poll.allow_multi_select ? (
        <Text className="mb-2 text-xs text-muted">Select all that apply</Text>
      ) : null}
      <View className="gap-2">
        {poll.poll_options.map((opt) => {
          const selected = selectedOptions.includes(opt.id);
          return (
            <Pressable
              key={opt.id}
              onPress={() => onSelect(opt.id)}
              className={[
                'flex-row items-center rounded-2xl border px-4 py-3.5 min-h-[52px]',
                selected
                  ? 'border-green bg-green-soft'
                  : 'border-line bg-card',
              ].join(' ')}
              accessibilityRole={poll.allow_multi_select ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: selected, selected }}
              accessibilityLabel={opt.label}
            >
              <View
                className={[
                  'mr-3 items-center justify-center',
                  poll.allow_multi_select
                    ? 'h-5 w-5 rounded-md border-2'
                    : 'h-5 w-5 rounded-full border-2',
                  selected ? 'border-green bg-green' : 'border-line bg-card',
                ].join(' ')}
              >
                {selected ? (
                  poll.allow_multi_select ? (
                    <Ionicons name="checkmark" size={12} color="white" />
                  ) : (
                    <View className="h-2 w-2 rounded-full bg-card" />
                  )
                ) : null}
              </View>
              <Text
                className={['flex-1 text-base', selected ? 'font-medium text-ink' : 'text-ink'].join(' ')}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Write-in poll card ────────────────────────────────────────────────────
//
// Used by polls with `allow_write_ins=true`. Renders the existing options
// like PollResponseCard, plus a text input that lets the respondent add
// a new option. Pending write-ins are kept in local state until submit —
// the actual poll_option row is created server-side via the
// submit_poll_write_in RPC, which de-dupes case-insensitively and returns
// the option_id to vote on. Other respondents see the new option after
// the periodic polls refetch.

function WriteInPollCard({
  poll,
  selectedOptions,
  pendingWriteIns,
  onSelect,
  onAddWriteIn,
  onRemoveWriteIn,
  placeholder,
}: {
  poll: PollWithOptions;
  selectedOptions: string[];
  pendingWriteIns: string[];
  onSelect: (optionId: string) => void;
  onAddWriteIn: (label: string) => void;
  onRemoveWriteIn: (label: string) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState('');

  function handleAdd() {
    const v = input.trim();
    if (!v) return;
    // Local case-insensitive dedupe against existing options + pending so
    // a respondent typing the same thing twice doesn't create duplicates.
    // Server-side dedupe still runs — this is just UX polish.
    const lower = v.toLowerCase();
    const existing = poll.poll_options.find((o) => o.label.toLowerCase() === lower);
    if (existing) {
      if (!selectedOptions.includes(existing.id)) onSelect(existing.id);
      setInput('');
      return;
    }
    if (pendingWriteIns.some((p) => p.toLowerCase() === lower)) {
      setInput('');
      return;
    }
    onAddWriteIn(v);
    setInput('');
  }

  return (
    <View className="mb-5">
      <Text className="mb-3 text-lg font-semibold text-ink">{surveyPollTitle(poll)}</Text>
      <Text className="mb-2 text-xs text-muted">
        {poll.allow_multi_select ? 'Select all that apply, or add your own.' : 'Pick one, or add your own.'}
      </Text>
      <View className="gap-2">
        {poll.poll_options.map((opt) => {
          const selected = selectedOptions.includes(opt.id);
          return (
            <Pressable
              key={opt.id}
              onPress={() => onSelect(opt.id)}
              className={[
                'flex-row items-center rounded-2xl border px-4 py-3.5 min-h-[52px]',
                selected ? 'border-green bg-green-soft' : 'border-line bg-card',
              ].join(' ')}
              accessibilityRole={poll.allow_multi_select ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: selected, selected }}
              accessibilityLabel={opt.label}
            >
              <View
                className={[
                  'mr-3 items-center justify-center h-5 w-5 border-2',
                  poll.allow_multi_select ? 'rounded-md' : 'rounded-full',
                  selected ? 'border-green bg-green' : 'border-line bg-card',
                ].join(' ')}
              >
                {selected ? (
                  poll.allow_multi_select ? (
                    <Ionicons name="checkmark" size={12} color="white" />
                  ) : (
                    <View className="h-2 w-2 rounded-full bg-card" />
                  )
                ) : null}
              </View>
              <Text className={['flex-1 text-base', selected ? 'font-medium text-ink' : 'text-ink'].join(' ')}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}

        {pendingWriteIns.map((label) => (
          <View
            key={`pending-${label}`}
            className="flex-row items-center rounded-2xl border border-green bg-green-soft px-4 py-3.5 min-h-[52px]"
          >
            <View className="mr-3 h-5 w-5 items-center justify-center rounded-md border-2 border-green bg-green">
              <Ionicons name="checkmark" size={12} color="white" />
            </View>
            <Text className="flex-1 text-base font-medium text-ink">{label}</Text>
            <Text className="mr-3 text-[11px] font-semibold uppercase text-green">You</Text>
            <Pressable
              onPress={() => onRemoveWriteIn(label)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${label}`}
            >
              <Ionicons name="close-circle" size={20} color="#0F3F2E" />
            </Pressable>
          </View>
        ))}
      </View>

      <View className="mt-3 flex-row items-center gap-2">
        <View className="flex-1 rounded-2xl border border-line bg-card px-3.5 py-2.5">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={placeholder}
            placeholderTextColor="#A0A0A0"
            maxLength={40}
            onSubmitEditing={handleAdd}
            returnKeyType="done"
            style={{ fontSize: 15, color: '#1F1F1F', padding: 0 }}
            accessibilityLabel="Add an option"
          />
        </View>
        <Pressable
          onPress={handleAdd}
          disabled={input.trim().length === 0}
          className={[
            'rounded-full px-4 py-2.5',
            input.trim().length === 0 ? 'bg-line' : 'bg-green',
          ].join(' ')}
          accessibilityRole="button"
          accessibilityLabel="Add option"
        >
          <Text className={['text-sm font-semibold', input.trim().length === 0 ? 'text-muted' : 'text-white'].join(' ')}>
            Add
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Duration poll card — chips when planner provided options, free-form
// numeric input when they didn't. Identified by canonical title. ─────────

function DurationPollCard({
  poll,
  selectedOptions,
  numericValue,
  onSelect,
  onNumericChange,
}: {
  poll: PollWithOptions;
  selectedOptions: string[];
  numericValue: number | null;
  onSelect: (optionId: string) => void;
  onNumericChange: (n: number | null) => void;
}) {
  // Local input mirror for the free-form numeric mode. Declared here so
  // the hook order is stable across re-renders, regardless of which
  // branch we render below.
  const [inputText, setInputText] = useState<string>(numericValue?.toString() ?? '');

  // Keep input synced if the parent's numericValue changes externally
  // (e.g. existing responses load asynchronously after mount).
  useEffect(() => {
    setInputText(numericValue?.toString() ?? '');
  }, [numericValue]);

  // Option-based: planner provided 2+ choices. Render as chips via the
  // shared PollResponseCard. (1-option polls are decided + read-only —
  // they get filtered out before reaching here.)
  if (poll.poll_options.length > 0) {
    return (
      <PollResponseCard poll={poll} selectedOptions={selectedOptions} onSelect={onSelect} />
    );
  }

  // Free-form: planner didn't pre-set durations. Respondent enters a
  // number of nights. Stored as poll_responses.numeric_value.
  function handleChange(t: string) {
    // Strip non-digits — nights are always positive integers.
    const digits = t.replace(/\D/g, '').slice(0, 3);
    setInputText(digits);
    if (digits.length === 0) {
      onNumericChange(null);
    } else {
      const n = parseInt(digits, 10);
      onNumericChange(isNaN(n) || n <= 0 ? null : n);
    }
  }

  return (
    <View className="mb-5">
      <Text className="mb-3 text-lg font-semibold text-ink">How long should the trip be?</Text>
      <Text className="mb-3 text-xs text-muted">Tell us how many nights work for you.</Text>
      <View className="flex-row items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3.5">
        <TextInput
          value={inputText}
          onChangeText={handleChange}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor="#A0A0A0"
          maxLength={3}
          style={{
            fontSize: 28,
            fontWeight: '700',
            color: '#0F3F2E',
            minWidth: 52,
            textAlign: 'center',
            padding: 0,
          }}
          accessibilityLabel="Number of nights"
        />
        <Text className="text-base font-medium text-ink">
          {inputText === '1' ? 'night' : 'nights'}
        </Text>
      </View>
    </View>
  );
}

// ─── Calendar card for availability-style dates polls ─────────────────────────

function DatesPollCard({
  poll,
  selectedOptions,
  onSelect,
  onSetSelections,
  tripDuration,
}: {
  poll: PollWithOptions;
  selectedOptions: string[];
  onSelect: (optionId: string) => void;
  /** Replace the entire selection set for this poll at once. Used by the
   *  MultiDatePicker confirm — the picker hands us a final set of days, we
   *  map them to option IDs in one shot. */
  onSetSelections: (optionIds: string[]) => void;
  /** Optional pre-set trip length, e.g. "3 days" or "1 week". Surfaced as
   *  a small banner above the calendar so respondents know how long the
   *  trip will be while picking days they're free. */
  tripDuration?: string | null;
}) {
  // Hooks must run unconditionally for stable order across renders.
  const [pickerVisible, setPickerVisible] = useState(false);

  const parsedOptions = poll.poll_options
    .map((opt) => ({ ...opt, range: parseDateRangeLabel(opt.label) }))
    .filter((opt): opt is typeof opt & { range: { start: Date; end: Date } } => opt.range !== null);

  // Fall back to list UI if none of the labels parsed as dates (e.g. duration poll)
  if (parsedOptions.length === 0) {
    return (
      <PollResponseCard poll={poll} selectedOptions={selectedOptions} onSelect={onSelect} />
    );
  }

  // Per-day poll: every option is a single day (start === end). Only
  // per-day polls use MultiDatePicker — legacy range-style polls fall
  // through to chip selection below so existing data still works.
  const isPerDayPoll = parsedOptions.every((o) => {
    const { start, end } = o.range;
    return start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
  });

  if (!isPerDayPoll) {
    return (
      <PollResponseCard poll={poll} selectedOptions={selectedOptions} onSelect={onSelect} />
    );
  }

  // Build a Date → option map. Each option's range collapses to a single
  // day; we key on ISO 'YYYY-MM-DD'.
  function dateToIso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const isoToOption = new Map<string, PollWithOptions['poll_options'][number]>();
  for (const o of parsedOptions) {
    isoToOption.set(dateToIso(o.range.start), o);
  }
  const allIsos = Array.from(isoToOption.keys()).sort();
  const minIso = allIsos[0];
  const maxIso = allIsos[allIsos.length - 1];

  // ISO list of days the respondent has currently selected — derived from
  // selectedOptions (option IDs).
  const selectedIsos: string[] = [];
  for (const [iso, opt] of isoToOption) {
    if (selectedOptions.includes(opt.id)) selectedIsos.push(iso);
  }

  // Pretty range label, e.g. "Jun 1 – Jun 30".
  const minLabel = new Date(minIso + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
  const maxLabel = new Date(maxIso + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
  const windowLabel = minIso === maxIso ? minLabel : `${minLabel} – ${maxLabel}`;

  function handleConfirmDays(days: string[]) {
    const ids: string[] = [];
    for (const day of days) {
      const opt = isoToOption.get(day);
      if (opt) ids.push(opt.id);
    }
    onSetSelections(ids);
  }

  return (
    <View className="mb-5">
      <Text className="mb-3 text-lg font-semibold text-ink">{surveyPollTitle(poll)}</Text>
      {tripDuration ? (
        <View className="mb-2 flex-row items-center gap-1.5 rounded-xl bg-green-soft px-3 py-2">
          <Ionicons name="hourglass-outline" size={14} color="#0F3F2E" />
          <Text className="text-xs font-medium text-green">
            Trip is {tripDuration} — pick the days you're free.
          </Text>
        </View>
      ) : null}
      <Text className="mb-2 text-xs text-muted">
        Window: {windowLabel}. Tap to mark every day you're free.
      </Text>

      {Platform.OS === 'web' ? (
        // Web: render the calendar inline as part of the poll. No
        // open-button affordance, no fullscreen modal — the picker
        // becomes a normal block in the response card.
        <MultiDatePicker
          inline
          visible
          value={selectedIsos}
          onConfirm={handleConfirmDays}
          onClose={() => {}}
          title="Pick days you're free"
          confirmLabel="Confirm availability"
          minDate={minIso}
          maxDate={maxIso}
          allowPastDates
        />
      ) : (
        <Pressable
          onPress={() => setPickerVisible(true)}
          className="flex-row items-center gap-2.5 rounded-2xl border border-line bg-card px-4 py-3.5"
          accessibilityRole="button"
          accessibilityLabel="Pick days you're free"
        >
          <Ionicons name="calendar-outline" size={18} color="#0F3F2E" />
          <Text className="flex-1 text-sm font-medium text-ink">
            {selectedIsos.length === 0
              ? "Pick days you're free"
              : `${selectedIsos.length} day${selectedIsos.length === 1 ? '' : 's'} selected`}
          </Text>
          <Text className="text-[12px] text-muted">{selectedIsos.length === 0 ? 'Open' : 'Edit'}</Text>
        </Pressable>
      )}

      {/* Selection summary (chips of picked days) */}
      {selectedIsos.length > 0 ? (
        <View className="mt-3 flex-row flex-wrap gap-2">
          {selectedIsos.slice(0, 8).map((iso) => {
            const label = new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
              month: 'short', day: 'numeric',
            });
            return (
              <View key={iso} className="flex-row items-center gap-1 rounded-full bg-gold/40 px-3 py-1">
                <Ionicons name="checkmark-circle" size={13} color="#0F3F2E" />
                <Text className="text-xs font-medium text-ink">{label}</Text>
              </View>
            );
          })}
          {selectedIsos.length > 8 ? (
            <View className="flex-row items-center rounded-full bg-cream-warm px-3 py-1">
              <Text className="text-xs font-medium text-muted">
                +{selectedIsos.length - 8} more
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {Platform.OS !== 'web' ? (
        <MultiDatePicker
          visible={pickerVisible}
          value={selectedIsos}
          onConfirm={handleConfirmDays}
          onClose={() => setPickerVisible(false)}
          title="Pick days you're free"
          confirmLabel="Confirm availability"
          minDate={minIso}
          maxDate={maxIso}
          allowPastDates
        />
      ) : null}
    </View>
  );
}

// ─── Poll results visual (post-submission) ────────────────────────────────────

function PollResultsCard({
  poll,
  counts,
  myOptionIds,
}: {
  poll: PollWithOptions;
  counts: Record<string, number>;
  myOptionIds: string[];
}) {
  const totalVotes = Object.values(counts).reduce((s, n) => s + n, 0);
  const leadingId =
    totalVotes > 0
      ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
      : null;

  // Detect per-day poll: all options are single-day labels
  const parsedResultOptions = poll.poll_options
    .map((opt) => ({ ...opt, range: parseDateRangeLabel(opt.label) }))
    .filter((opt): opt is typeof opt & { range: { start: Date; end: Date } } => opt.range !== null);

  const isPerDayResults =
    parsedResultOptions.length > 0 &&
    parsedResultOptions.every((o) => {
      const { start, end } = o.range;
      return start.getFullYear() === end.getFullYear() &&
        start.getMonth() === end.getMonth() &&
        start.getDate() === end.getDate();
    });

  if (isPerDayResults) {
    return (
      <DateResultsCalendar
        poll={poll}
        parsedOptions={parsedResultOptions}
        counts={counts}
        myOptionIds={myOptionIds}
      />
    );
  }

  return (
    <View className="mb-5">
      <Text className="mb-3 text-sm font-semibold text-ink">{surveyPollTitle(poll)}</Text>
      <View className="gap-3">
        {poll.poll_options.map((opt) => {
          const votes = counts[opt.id] ?? 0;
          const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
          const isLeading = leadingId === opt.id && totalVotes > 0;
          const isMyPick = myOptionIds.includes(opt.id);
          return (
            <View key={opt.id} className="gap-1">
              <View className="flex-row items-center">
                <Text
                  className={[
                    'flex-1 text-sm',
                    isLeading ? 'font-semibold text-ink' : 'text-muted',
                  ].join(' ')}
                  numberOfLines={1}
                >
                  {opt.label}
                </Text>
                {isMyPick ? (
                  <View className="ml-2 rounded-full bg-gold/40 px-2 py-0.5">
                    <Text className="text-xs font-medium text-ink">Your pick</Text>
                  </View>
                ) : null}
                <Text className="ml-2 text-xs text-muted">
                  {votes} vote{votes !== 1 ? 's' : ''}
                </Text>
              </View>
              <View className="h-2 overflow-hidden rounded-full bg-cream-warm">
                <View
                  className={[
                    'h-full rounded-full',
                    isMyPick || isLeading ? 'bg-green' : 'bg-line',
                  ].join(' ')}
                  style={{ width: pct > 0 ? `${pct}%` : '2%' }}
                />
              </View>
            </View>
          );
        })}
      </View>
      <Text className="mt-2 text-xs text-muted">
        {totalVotes === 0
          ? "You're the first — results will appear as others respond."
          : `${totalVotes} vote${totalVotes !== 1 ? 's' : ''} so far`}
      </Text>
    </View>
  );
}

// ─── Calendar heatmap for per-day date poll results ───────────────────────────

function DateResultsCalendar({
  poll,
  parsedOptions,
  counts,
  myOptionIds,
}: {
  poll: PollWithOptions;
  parsedOptions: Array<{ id: string; label: string; range: { start: Date; end: Date } }>;
  counts: Record<string, number>;
  myOptionIds: string[];
}) {
  const maxVotes = Math.max(...parsedOptions.map((o) => counts[o.id] ?? 0), 1);
  const allDates = parsedOptions.map((o) => o.range.start);
  const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));

  const [viewYear, setViewYear] = useState(minDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(minDate.getMonth());

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const trailingNulls = (7 - ((firstDayOfWeek + daysInMonth) % 7)) % 7;
  const cells: (Date | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(viewYear, viewMonth, i + 1)),
    ...Array(trailingNulls).fill(null),
  ];

  function getOptionForDate(date: Date) {
    const t = date.getTime();
    return parsedOptions.find((o) => {
      const s = new Date(o.range.start.getFullYear(), o.range.start.getMonth(), o.range.start.getDate()).getTime();
      return t === s;
    });
  }

  const canGoPrev =
    viewYear > minDate.getFullYear() ||
    (viewYear === minDate.getFullYear() && viewMonth > minDate.getMonth());
  const canGoNext =
    viewYear < maxDate.getFullYear() ||
    (viewYear === maxDate.getFullYear() && viewMonth < maxDate.getMonth());

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const totalResponders = Math.max(...Object.values(counts), 0);

  return (
    <View className="mb-5">
      <Text className="mb-1 text-sm font-semibold text-ink">{surveyPollTitle(poll)}</Text>
      <Text className="mb-3 text-xs text-muted">
        {totalResponders === 0
          ? "You're the first — results will appear as others respond."
          : 'Darker = more people available'}
      </Text>

      <View className="rounded-2xl border border-line bg-card p-4">
        {/* Month navigation */}
        <View className="mb-3 flex-row items-center justify-between">
          <Pressable
            onPress={() => {
              const d = new Date(viewYear, viewMonth - 1, 1);
              setViewYear(d.getFullYear());
              setViewMonth(d.getMonth());
            }}
            disabled={!canGoPrev}
            className="rounded-lg p-1.5"
          >
            <Ionicons name="chevron-back" size={18} color={canGoPrev ? '#6B7280' : '#D1D5DB'} />
          </Pressable>
          <Text className="text-sm font-semibold text-ink">{monthLabel}</Text>
          <Pressable
            onPress={() => {
              const d = new Date(viewYear, viewMonth + 1, 1);
              setViewYear(d.getFullYear());
              setViewMonth(d.getMonth());
            }}
            disabled={!canGoNext}
            className="rounded-lg p-1.5"
          >
            <Ionicons name="chevron-forward" size={18} color={canGoNext ? '#6B7280' : '#D1D5DB'} />
          </Pressable>
        </View>

        {/* Day headers */}
        <View className="mb-1 flex-row">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
            <Text key={d} className="flex-1 text-center text-xs font-medium text-muted">
              {d}
            </Text>
          ))}
        </View>

        {/* Calendar grid */}
        <View className="flex-row flex-wrap">
          {cells.map((date, i) => {
            if (!date) {
              return <View key={`e-${i}`} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />;
            }
            const opt = getOptionForDate(date);
            const isInRange = opt !== undefined;
            const votes = opt ? (counts[opt.id] ?? 0) : 0;
            const isMyPick = opt ? myOptionIds.includes(opt.id) : false;
            // Intensity 0–1 based on votes vs max
            const intensity = isInRange && maxVotes > 0 ? votes / maxVotes : 0;
            // Coral color: interpolate from #DFE8D2 (0 votes) to #0F3F2E (max votes)
            const r = Math.round(255 - intensity * (255 - 216));
            const g = Math.round(240 - intensity * (240 - 90));
            const b = Math.round(238 - intensity * (238 - 48));
            const bgColor = isInRange
              ? votes > 0
                ? `rgb(${r},${g},${b})`
                : '#F5F5F4'
              : 'transparent';
            const textColor = isInRange
              ? intensity > 0.5 ? '#FFFFFF' : '#6B7280'
              : '#D1D5DB';

            return (
              <View
                key={date.toISOString()}
                style={{ width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: bgColor,
                    borderWidth: isMyPick ? 2 : 0,
                    borderColor: '#0F3F2E',
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: isInRange ? '600' : '400', color: textColor }}>
                    {date.getDate()}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* Legend */}
      <View className="mt-2 flex-row items-center gap-2">
        <View className="flex-row items-center gap-1">
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#F5F5F4' }} />
          <Text className="text-xs text-muted">No votes</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#0F3F2E' }} />
          <Text className="text-xs text-muted">Popular</Text>
        </View>
        {myOptionIds.length > 0 ? (
          <View className="flex-row items-center gap-1">
            <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#0F3F2E' }} />
            <Text className="text-xs text-muted">Your picks</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ─── Download prompt (post-submission) ────────────────────────────────────────

function DownloadPrompt({ tripName: _tripName, tripId }: { tripName?: string; tripId: string }) {
  // Show once per trip per device — same gating the App Store/Play Store
  // prompt used. Avoids nagging respondents who've already seen it.
  const VIRAL_KEY = 'rally_viral_' + tripId;
  const [shown, setShown] = useState<boolean | null>(null);

  useEffect(() => {
    async function checkShown() {
      if (Platform.OS === 'web') {
        const val = localStorage.getItem(VIRAL_KEY);
        if (val) {
          setShown(false);
        } else {
          localStorage.setItem(VIRAL_KEY, '1');
          setShown(true);
        }
      } else {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
        const val = await AsyncStorage.getItem(VIRAL_KEY);
        if (val) {
          setShown(false);
        } else {
          await AsyncStorage.setItem(VIRAL_KEY, '1');
          setShown(true);
        }
      }
    }
    checkShown();
  }, []);

  if (shown === null || shown === false) return null;

  return (
    <View style={{ marginTop: 24 }}>
      <EmailCapture
        source="respond_post_submit"
        tripId={tripId}
        variant="card"
        title="Want this in an app?"
        subtitle="Drop your email and we'll get you in as soon as Rally opens up — your trip will be waiting."
        ctaLabel="Get me on the list"
      />
    </View>
  );
}

// ─── Itinerary day range helper ────────────────────────────────────────────────

function getDaysInRange(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const current = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  while (current <= end) {
    days.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return days;
}

// ─── Block type icon map ───────────────────────────────────────────────────────

const BLOCK_TYPE_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  activity: 'walk-outline',
  meal: 'restaurant-outline',
  travel: 'car-outline',
  accommodation: 'bed-outline',
  free_time: 'sunny-outline',
};

// ─── Itinerary RSVP section (Phase 2 only) ────────────────────────────────────

function ItineraryRsvpSection({
  trip,
  blocks,
  dayRsvps,
  respondentId,
  onRsvpChange,
  rsvpSaving,
}: {
  trip: TripWithPolls;
  blocks: ItineraryBlock[];
  dayRsvps: Record<string, DayRsvpStatus>;
  respondentId: string;
  onRsvpChange: (dayDate: string, status: DayRsvpStatus) => void;
  rsvpSaving: string | null;
}) {
  if (!trip.start_date || !trip.end_date || blocks.length === 0) return null;

  const days = getDaysInRange(trip.start_date, trip.end_date);
  if (days.length === 0) return null;

  return (
    <View className="mt-6">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="calendar-outline" size={18} color="#0F3F2E" />
        <Text className="text-lg font-bold text-ink">Are you in?</Text>
      </View>
      <Text className="mt-1 text-sm text-muted">
        Let the planner know which days work for you.
      </Text>

      {days.map((dayDate) => {
        const dayBlocks = blocks
          .filter((b) => b.day_date === dayDate)
          .sort((a, b) => a.position - b.position);
        const currentStatus = dayRsvps[dayDate];
        const isSaving = rsvpSaving === dayDate;

        return (
          <View key={dayDate} className="mt-4 rounded-2xl border border-line bg-card p-4">
            {/* Day header */}
            <Text className="mb-3 text-sm font-semibold text-ink">
              {formatDayLabel(dayDate)}
            </Text>

            {/* Blocks list */}
            {dayBlocks.length > 0 ? (
              <View className="mb-4 gap-2">
                {dayBlocks.map((block) => (
                  <View key={block.id} className="flex-row items-start gap-2">
                    <View className="mt-0.5">
                      <Ionicons
                        name={BLOCK_TYPE_ICONS[block.type] ?? 'ellipse-outline'}
                        size={16}
                        color="#6B7280"
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-ink">{block.title}</Text>
                      {block.start_time ? (
                        <Text className="text-xs text-muted">{formatTime(block.start_time)}</Text>
                      ) : null}
                      {block.location ? (
                        <Text className="text-xs text-muted" numberOfLines={1}>
                          {block.location}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* RSVP buttons */}
            {isSaving ? (
              <ActivityIndicator size="small" color="#0F3F2E" />
            ) : (
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => onRsvpChange(dayDate, 'going')}
                  className={[
                    'flex-1 items-center justify-center rounded-xl border py-2',
                    currentStatus === 'going'
                      ? 'border-green-500 bg-green-500'
                      : 'border-green-200 bg-green-50',
                  ].join(' ')}
                  accessibilityRole="button"
                  accessibilityLabel="Going"
                  accessibilityState={{ selected: currentStatus === 'going' }}
                >
                  <Text
                    className={[
                      'text-xs font-semibold',
                      currentStatus === 'going' ? 'text-white' : 'text-green',
                    ].join(' ')}
                  >
                    ✓ Going
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => onRsvpChange(dayDate, 'not_sure')}
                  className={[
                    'flex-1 items-center justify-center rounded-xl border py-2',
                    currentStatus === 'not_sure'
                      ? 'border-amber-400 bg-amber-400'
                      : 'border-amber-200 bg-amber-50',
                  ].join(' ')}
                  accessibilityRole="button"
                  accessibilityLabel="Maybe"
                  accessibilityState={{ selected: currentStatus === 'not_sure' }}
                >
                  <Text
                    className={[
                      'text-xs font-semibold',
                      currentStatus === 'not_sure' ? 'text-white' : 'text-amber-700',
                    ].join(' ')}
                  >
                    ? Maybe
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => onRsvpChange(dayDate, 'cant_make_it')}
                  className={[
                    'flex-1 items-center justify-center rounded-xl border py-2',
                    currentStatus === 'cant_make_it'
                      ? 'border-muted bg-muted'
                      : 'border-line bg-cream-warm',
                  ].join(' ')}
                  accessibilityRole="button"
                  accessibilityLabel="Can't make it"
                  accessibilityState={{ selected: currentStatus === 'cant_make_it' }}
                >
                  <Text
                    className={[
                      'text-xs font-semibold',
                      currentStatus === 'cant_make_it' ? 'text-white' : 'text-muted',
                    ].join(' ')}
                  >
                    ✕ Can't make it
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function formatTripDates(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const s = new Date(start + 'T12:00:00');
  const e = end ? new Date(end + 'T12:00:00') : null;
  const sm = months[s.getMonth()]; const sd = s.getDate();
  if (!e) return `${sm} ${sd}`;
  const em = months[e.getMonth()]; const ed = e.getDate();
  return sm === em ? `${sm} ${sd}–${ed}` : `${sm} ${sd} – ${em} ${ed}`;
}

// ─── Main screen ───────────────────────────────────────────────────────────────

type Step = 'name' | 'polls' | 'profile' | 'done';

export default function RespondScreen() {
  const { tripId: shareToken } = useLocalSearchParams<{ tripId: string }>();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('name');
  const { celebrate, CelebrationOverlay } = useCelebration();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [firstNameError, setFirstNameError] = useState('');
  const [lastNameError, setLastNameError] = useState('');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [trip, setTrip] = useState<TripWithPolls | null>(null);
  const [loadError, setLoadError] = useState<'not_found' | 'closed' | 'error' | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [hasExistingResponses, setHasExistingResponses] = useState(false);
  const [existingRespondent, setExistingRespondent] = useState<Respondent | null>(null);
  const [initialTravelerProfile, setInitialTravelerProfile] = useState<TravelerProfile | null>(null);

  // responses: { [pollId]: optionId[] } — option-based polls
  const [responses, setResponses] = useState<Record<string, string[]>>({});
  // numericResponses: { [pollId]: nights } — free-form numeric polls
  // (currently the duration poll when planner provided no preset chips).
  const [numericResponses, setNumericResponses] = useState<Record<string, number | null>>({});
  // writeIns: { [pollId]: pendingLabel[] } — labels the respondent typed
  // into a write-in poll's input. Materialized on submit via the
  // submit_poll_write_in RPC (which de-dupes case-insensitively against
  // existing options server-side).
  const [writeIns, setWriteIns] = useState<Record<string, string[]>>({});
  // live vote counts fetched after submission: { [pollId]: { [optionId]: count } }
  const [resultCounts, setResultCounts] = useState<Record<string, Record<string, number>>>({});
  const [respondentId, setRespondentId] = useState<string | null>(null);
  const [itineraryBlocks, setItineraryBlocks] = useState<ItineraryBlock[]>([]);
  const [dayRsvps, setDayRsvps] = useState<Record<string, DayRsvpStatus>>({});
  const [rsvpSaving, setRsvpSaving] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);

  // ─── Refetch polls while on the polls step ────────────────────────────────
  // Other respondents may add write-in options after this respondent
  // landed. A periodic refetch surfaces those new options live so the
  // UI matches the user's stated requirement: "they should be able to
  // see what other group members have written in." Cheap query, public
  // share token endpoint — 5s feels live without hammering the server.
  useEffect(() => {
    if (step !== 'polls' || !trip?.share_token) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const fresh = await getTripByShareToken(trip.share_token!);
        if (cancelled) return;
        setTrip((prev) => (prev ? { ...prev, polls: fresh.polls } : prev));
      } catch {
        /* non-fatal — next tick will retry */
      }
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [step, trip?.share_token]);

  // ─── Load trip ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const data = await getTripByShareToken(shareToken);
        setTrip(data);

        // Pre-fill name from storage (convenience — user still sees the name step)
        const stored = await getStoredName();

        function applyStoredName(fullName: string) {
          const parts = fullName.trim().split(/\s+/);
          setFirstName(parts[0] ?? '');
          setLastName(parts.slice(1).join(' ') ?? '');
        }

        if (stored) applyStoredName(stored);

        // Load any existing responses for this device+trip without auto-skipping.
        // This lets a returning user update their picks, while still allowing a
        // *different* person on the same device to enter their own name and respond.
        try {
          const respondent = await getExistingRespondentForTrip(data.id);
          if (respondent) {
            setExistingRespondent(respondent);
            applyStoredName(respondent.name); // Pre-fill with their actual stored name
            if (respondent.email) setEmail(respondent.email);
            if (respondent.phone) setPhone(respondent.phone);
            const [existing, existingNumeric] = await Promise.all([
              getExistingResponses(data.id, respondent.id),
              getExistingNumericResponses(data.id, respondent.id),
            ]);
            const anyExisting =
              Object.values(existing).some((arr) => arr.length > 0) ||
              Object.keys(existingNumeric).length > 0;
            if (anyExisting) {
              setResponses(existing);
              setNumericResponses(existingNumeric);
              setHasExistingResponses(true);
            }
          } else if (stored) {
            applyStoredName(stored);
          }
        } catch {
          // No existing respondent — fine, fresh start
          if (stored) applyStoredName(stored);
        }

        setLoading(false);
      } catch (err: unknown) {
        setLoading(false);
        const msg = err instanceof Error
          ? err.message
          : (err as any)?.message ?? JSON.stringify(err);
        if (
          msg.includes('not found') ||
          msg.includes('JSON object') ||
          msg.includes('0 rows') ||
          msg.includes('PGRST116')
        ) {
          setLoadError('not_found');
        } else {
          setLoadError('error');
        }
      }
    }
    if (shareToken) load();
  }, [shareToken]);

  // ─── Handle option selection ───────────────────────────────────────────────
  function handleSelect(pollId: string, optionId: string, multiSelect: boolean) {
    setResponses((prev) => {
      const current = prev[pollId] ?? [];
      if (multiSelect) {
        return {
          ...prev,
          [pollId]: current.includes(optionId)
            ? current.filter((id) => id !== optionId)
            : [...current, optionId],
        };
      }
      // Single-select: replace
      return { ...prev, [pollId]: [optionId] };
    });
  }

  // ─── Name step → polls step ────────────────────────────────────────────────
  async function handleNameContinue() {
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    const fullName = [trimmedFirst, trimmedLast].filter(Boolean).join(' ');

    let hasError = false;
    if (!trimmedFirst) {
      setFirstNameError('First name is required');
      hasError = true;
    } else {
      setFirstNameError('');
    }
    if (!trimmedLast) {
      setLastNameError('Last name is required');
      hasError = true;
    } else {
      setLastNameError('');
    }
    if (!trimmedEmail) {
      setEmailError('Email is required');
      hasError = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailError('Please enter a valid email');
      hasError = true;
    } else {
      setEmailError('');
    }
    if (!trimmedPhone) {
      setPhoneError('Phone number is required');
      hasError = true;
    } else if (normalizePhone(trimmedPhone) === null) {
      // Reject anything we can't E.164-normalize — that format is what SMS,
      // survey, and app all key off for identity unification (Phase 0+).
      setPhoneError('Enter a valid phone number');
      hasError = true;
    } else {
      setPhoneError('');
    }
    if (hasError) return;

    await storeName(fullName);

    // If they entered a different name than the existing respondent, clear the
    // trip session so a new respondent gets created on submit. This allows a
    // different person on the same device to respond independently.
    if (existingRespondent && existingRespondent.name !== fullName) {
      await clearTripSession(trip!.id);
      setExistingRespondent(null);
      setHasExistingResponses(false);
      setResponses({});
      setNumericResponses({});
    }

    // Trip-creation + polling are unified — every respondent answers
    // the polls. Completing them is the implicit "I'm in"; there's no
    // separate yes/no RSVP step.
    setStep('polls');
  }

  // ─── Respond as someone else (clears stored session for this trip) ─────────
  async function handleRespondAsDifferentPerson() {
    if (!trip) return;
    await clearTripSession(trip.id);
    setExistingRespondent(null);
    setHasExistingResponses(false);
    setResponses({});
    setNumericResponses({});
    setFirstName('');
    setLastName('');
    setFirstNameError('');
    setLastNameError('');
    setEmail('');
    setEmailError('');
    setPhone('');
    setPhoneError('');
  }

  /**
   * After the trip-survey path completes, look up any existing traveler
   * profile and transition to the 'profile' step. Best-effort: if the
   * RPC fails (e.g. network), we still move on with a null initial
   * profile so the planner-side trip submission isn't blocked.
   *
   * Phone is normalized to E.164 to match `trip_session_participants.phone`
   * — without this, the RPC's auth gate rejects the read/write because
   * the user-entered "(917) 555-..." string doesn't equal the stored
   * "+19175551234".
   */
  async function enterProfileStep() {
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone) {
      try {
        const existing = await getProfileByToken(shareToken, normalizedPhone);
        setInitialTravelerProfile(existing);
      } catch {
        /* non-fatal */
      }
    }
    setStep('profile');
  }

  // ─── Submit all responses ──────────────────────────────────────────────────
  async function handleSubmit() {
    if (!trip) return;
    setSubmitting(true);
    const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
    try {
      const respondent = await getOrCreateRespondent(trip.id, fullName, email.trim() || null, phone.trim() || null);
      setRespondentId(respondent.id);
      const polls = trip.polls ?? [];
      for (const poll of polls) {
        let optionIds = responses[poll.id] ?? [];
        const numeric = numericResponses[poll.id] ?? null;

        // Materialize any pending write-ins for this poll. The RPC
        // de-dupes case-insensitively against existing options, so the
        // same label typed by two respondents lands on a single option.
        const pendingLabels = writeIns[poll.id] ?? [];
        for (const label of pendingLabels) {
          const { data, error } = await supabase.rpc('submit_poll_write_in', {
            p_poll_id: poll.id,
            p_label: label,
            p_session_token: respondent.session_token,
          });
          if (error) {
            console.warn('[respond] submit_poll_write_in failed:', error.message);
            continue;
          }
          const result = data as { ok: boolean; option_id?: string; reason?: string } | null;
          if (result?.ok && result.option_id && !optionIds.includes(result.option_id)) {
            optionIds = [...optionIds, result.option_id];
          }
        }

        // Free-form numeric (legacy duration poll w/ no chips) takes
        // priority — option IDs and numeric values are mutually exclusive
        // per poll per respondent.
        await submitPollResponses(poll.id, respondent.id, optionIds, numeric);
      }
      capture(Events.RESPONDENT_SUBMITTED, { trip_id: trip.id, poll_count: polls.length });
      log.action(Events.RESPONDENT_SUBMITTED, { trip_id: trip.id, poll_count: polls.length });

      // On their first submission: create a Rally account and add them as a
      // trip member so the trip shows up in their app once they log in.
      if (!hasExistingResponses) {
        enrollRespondentAsMember(
          trip.id,
          email.trim(),
          firstName.trim(),
          lastName.trim(),
          phone.trim(),
        ).catch(() => { /* non-fatal — account creation failure doesn't block UX */ });
      }
      sendSurveyConfirmationSms(trip.id, phone.trim() || null, 'in');
      // Fetch live counts so the confirmation screen can show a results visual
      try {
        const counts = await getResponseCountsForTrip(trip.id);
        setResultCounts(counts);
      } catch {
        // non-fatal — confirmation screen will just show empty bars
      }
      // Fetch itinerary + existing RSVPs for this respondent if Phase 2 is active
      if (trip.phase2_unlocked && trip.start_date && trip.end_date) {
        try {
          const [blocks, rsvpResult] = await Promise.all([
            getBlocksForTrip(trip.id),
            supabase
              .from('day_rsvps')
              .select('day_date, status')
              .eq('trip_id', trip.id)
              .eq('respondent_id', respondent.id),
          ]);
          setItineraryBlocks(blocks);
          if (rsvpResult.data) {
            const rsvpMap: Record<string, DayRsvpStatus> = {};
            rsvpResult.data.forEach((r: { day_date: string; status: string }) => {
              rsvpMap[r.day_date] = r.status as DayRsvpStatus;
            });
            setDayRsvps(rsvpMap);
          }
        } catch { /* non-fatal — itinerary section will just not show */ }
      }
      celebrate();
      await enterProfileStep();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : (err as any)?.message ?? 'Unknown error';
      console.error('Submit failed:', msg, err);
      Alert.alert('Submission failed', 'Could not save your responses. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Handle RSVP change ────────────────────────────────────────────────────
  async function handleRsvpChange(dayDate: string, status: DayRsvpStatus) {
    if (!respondentId || !trip) return;
    setRsvpSaving(dayDate);
    try {
      await upsertDayRsvp(trip.id, respondentId, dayDate, status);
      setDayRsvps((prev) => ({ ...prev, [dayDate]: status }));
    } catch {
      Alert.alert('Error', 'Could not save your RSVP. Please try again.');
    } finally {
      setRsvpSaving(null);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <WebPageShell cardStyle={{ padding: 48 }}>
        <View className={IS_WEB ? 'items-center justify-center' : 'flex-1 items-center justify-center bg-cream'}>
          <ActivityIndicator size="large" color="#0F3F2E" />
        </View>
      </WebPageShell>
    );
  }

  if (loadError === 'not_found') {
    return (
      <WebPageShell cardStyle={{ padding: 40 }}>
        <View className={IS_WEB ? 'items-center' : 'flex-1 items-center justify-center bg-cream px-8'}>
          <Text className="text-5xl">🔗</Text>
          <Text className="mt-4 text-center text-xl font-semibold text-ink">
            This trip no longer exists.
          </Text>
          <Text className="mt-2 text-center text-sm text-muted">
            The trip planner may have deleted it.
          </Text>
        </View>
      </WebPageShell>
    );
  }

  if (loadError === 'closed' || (trip && trip.status !== 'active')) {
    return (
      <WebPageShell cardStyle={{ padding: 40 }}>
        <View className={IS_WEB ? 'items-center' : 'flex-1 items-center justify-center bg-cream px-8'}>
          <Text className="text-5xl">🔒</Text>
          <Text className="mt-4 text-center text-xl font-semibold text-ink">
            This trip is no longer accepting responses.
          </Text>
          <Text className="mt-2 text-center text-sm text-muted">
            The planner has closed it.
          </Text>
        </View>
      </WebPageShell>
    );
  }

  // Responses-due cutoff: planner set a deadline and it's passed. Block
  // new submissions and updates. Done before the !trip null-guard (which
  // is loaded by this point) and before any step rendering.
  if (trip && trip.responses_due_date) {
    const days = daysUntil(trip.responses_due_date);
    if (days !== null && days < 0) {
      return (
        <WebPageShell cardStyle={{ padding: 40 }}>
          <View className={IS_WEB ? 'items-center' : 'flex-1 items-center justify-center bg-cream px-8'}>
            <Text className="text-5xl">⏰</Text>
            <Text className="mt-4 text-center text-xl font-semibold text-ink">
              Responses are closed.
            </Text>
            <Text className="mt-2 text-center text-sm text-muted">
              The deadline was {formatCadenceDate(trip.responses_due_date)}. The planner is locking in plans now — reach out to them directly with any updates.
            </Text>
          </View>
        </WebPageShell>
      );
    }
  }

  if (loadError === 'error') {
    return (
      <WebPageShell cardStyle={{ padding: 40 }}>
        <View className={IS_WEB ? 'items-center' : 'flex-1 items-center justify-center bg-cream px-8'}>
          <Text className="text-5xl">⚠️</Text>
          <Text className="mt-4 text-center text-xl font-semibold text-ink">
            Something went wrong.
          </Text>
          <Text className="mt-2 text-center text-sm text-muted">
            Check your connection and try again.
          </Text>
        </View>
      </WebPageShell>
    );
  }

  if (!trip) return null;

  // Render order on the survey: pin the duration question above the
  // dates calendar so respondents tell us trip length first, then pick
  // availability with that context. Other polls keep their saved order.
  const polls: PollWithOptions[] = (() => {
    const all = trip.polls ?? [];
    const duration = all.filter(isDurationPoll);
    const dates = all.filter((p) => p.type === 'dates');
    const rest = all.filter((p) => !isDurationPoll(p) && p.type !== 'dates');
    return [...duration, ...dates, ...rest];
  })();
  const plannerLabel = 'Your trip planner';

  // ─── Name step ─────────────────────────────────────────────────────────────
  if (step === 'name') {
    const nameForm = (
      <View
        style={{
          paddingTop: IS_WEB ? 36 : insets.top + 24,
          paddingBottom: IS_WEB ? 36 : insets.bottom + 24,
          paddingHorizontal: IS_WEB ? 36 : 24,
          ...(IS_WEB ? {} : { flex: 1, justifyContent: 'center' as const }),
        }}
      >
          {/* Rally wordmark */}
          <Text className="mb-1 text-3xl font-bold text-green">rally</Text>

          {/* Trip header */}
          <Text className="text-2xl font-bold text-ink">{trip.name}</Text>
          <Text className="mt-1 text-base text-muted">
            {plannerLabel} is planning a trip and wants your input.
          </Text>

          <View className="mt-8 gap-4">
            {/* Returning user banner */}
            {existingRespondent && hasExistingResponses ? (
              <View className="flex-row items-center justify-between rounded-2xl bg-gold/40 px-4 py-3">
                <Text className="text-sm text-ink">
                  Updating your previous responses
                </Text>
                <Pressable
                  onPress={handleRespondAsDifferentPerson}
                  accessibilityRole="button"
                  accessibilityLabel="Respond as a different person"
                  hitSlop={8}
                >
                  <Text className="text-sm font-medium text-green">Not you?</Text>
                </Pressable>
              </View>
            ) : null}

            <View className="flex-row gap-3">
              <View className="flex-1 gap-1">
                <Text className="text-sm font-medium text-ink">First name</Text>
                <TextInput
                  ref={nameInputRef}
                  value={firstName}
                  onChangeText={(t) => {
                    setFirstName(t.slice(0, 30));
                    if (firstNameError) setFirstNameError('');
                  }}
                  placeholder="Jane"
                  maxLength={30}
                  autoFocus
                  autoCapitalize="words"
                  autoComplete="given-name"
                  returnKeyType="next"
                  className={[
                    'min-h-[52px] rounded-2xl border bg-card px-4 py-3 text-lg text-ink',
                    firstNameError ? 'border-red-400' : 'border-line',
                  ].join(' ')}
                  placeholderTextColor="#9DA8A0"
                />
                {firstNameError ? (
                  <Text className="text-sm text-red-500">{firstNameError}</Text>
                ) : null}
              </View>
              <View className="flex-1 gap-1">
                <Text className="text-sm font-medium text-ink">Last name</Text>
                <TextInput
                  value={lastName}
                  onChangeText={(t) => {
                    setLastName(t.slice(0, 30));
                    if (lastNameError) setLastNameError('');
                  }}
                  placeholder="Smith"
                  maxLength={30}
                  autoCapitalize="words"
                  autoComplete="family-name"
                  returnKeyType="next"
                  className={[
                    'min-h-[52px] rounded-2xl border bg-card px-4 py-3 text-lg text-ink',
                    lastNameError ? 'border-red-400' : 'border-line',
                  ].join(' ')}
                  placeholderTextColor="#9DA8A0"
                />
                {lastNameError ? (
                  <Text className="text-sm text-red-500">{lastNameError}</Text>
                ) : null}
              </View>
            </View>

            <View className="gap-1">
              <Text className="text-sm font-medium text-ink">Email</Text>
              <TextInput
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (emailError) setEmailError('');
                }}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                returnKeyType="next"
                className={[
                  'min-h-[52px] rounded-2xl border bg-card px-4 py-3 text-lg text-ink',
                  emailError ? 'border-red-400' : 'border-line',
                ].join(' ')}
                placeholderTextColor="#9DA8A0"
              />
              {emailError ? (
                <Text className="text-sm text-red-500">{emailError}</Text>
              ) : null}
            </View>

            <View className="gap-1">
              <Text className="text-sm font-medium text-ink">Phone</Text>
              <TextInput
                value={phone}
                onChangeText={(t) => {
                  setPhone(t);
                  if (phoneError) setPhoneError('');
                }}
                placeholder="+1 555 000 0000"
                keyboardType="phone-pad"
                autoComplete="tel"
                returnKeyType="go"
                onSubmitEditing={handleNameContinue}
                className={[
                  'min-h-[52px] rounded-2xl border bg-card px-4 py-3 text-lg text-ink',
                  phoneError ? 'border-red-400' : 'border-line',
                ].join(' ')}
                placeholderTextColor="#9DA8A0"
              />
              {phoneError ? (
                <Text className="text-sm text-red-500">{phoneError}</Text>
              ) : null}
            </View>

            <Button onPress={handleNameContinue} fullWidth size="lg">
              {existingRespondent && hasExistingResponses ? 'Update my responses →' : 'See polls →'}
            </Button>

            <Text className="text-center text-xs text-muted">
              No account needed. Contact info is only shared with your trip planner.
            </Text>
          </View>
        </View>
    );

    if (IS_WEB) {
      return (
        <WebPageShell>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            // @ts-ignore — web-only
            style={{ maxHeight: '95vh' }}
          >
            {nameForm}
          </ScrollView>
        </WebPageShell>
      );
    }

    return (
      <KeyboardAvoidingView
        className="flex-1 bg-cream"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {nameForm}
      </KeyboardAvoidingView>
    );
  }

  // ─── Traveler profile step (post trip-survey) ─────────────────────────────
  if (step === 'profile') {
    return (
      <WebPageShell
        cardStyle={
          IS_WEB
            ? // @ts-ignore — web-only flex props
              { padding: 0, maxHeight: '95vh', display: 'flex', flexDirection: 'column' }
            : { padding: 0 }
        }
      >
        <TravelerProfileForm
          phone={normalizePhone(phone) ?? ''}
          initialProfile={initialTravelerProfile}
          respondentFirstName={firstName.trim() || null}
          onSave={(draft) => upsertProfileByToken(shareToken, draft)}
          onComplete={() => setStep('done')}
        />
      </WebPageShell>
    );
  }

  if (step === 'done') {
    return (
      <WebPageShell cardStyle={IS_WEB ? { maxHeight: '95vh' } : {}}>
      {CelebrationOverlay}
      <ScrollView
        style={IS_WEB ? {} : { flex: 1, backgroundColor: '#F9F9F7' }}
        contentContainerStyle={{
          paddingTop: IS_WEB ? 36 : insets.top + 24,
          paddingHorizontal: IS_WEB ? 36 : 24,
          paddingBottom: IS_WEB ? 36 : insets.bottom + 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-3xl font-bold text-green">rally</Text>

        <View className="mt-8 items-center">
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: '#DFE8D2',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 4,
            }}
          >
            <Ionicons name="sparkles" size={32} color="#0F3F2E" />
          </View>
          <Text className="mt-4 text-center text-2xl font-bold text-ink">
            {hasExistingResponses ? 'Responses updated!' : "You're in!"}
          </Text>
          <Text className="mt-2 text-center text-base text-muted">
            Your preferences have been shared with the planner.
          </Text>
        </View>

        {/* Live poll results visual */}
        {polls.length > 0 ? (
          <View className="mt-6 rounded-2xl border border-line bg-card p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-ink">Live results</Text>
              <View className="flex-row items-center gap-1">
                <View className="h-1.5 w-1.5 rounded-full bg-green-400" />
                <Text className="text-xs text-muted">Updating live</Text>
              </View>
            </View>
            {polls.map((poll) => (
              <PollResultsCard
                key={poll.id}
                poll={poll}
                counts={resultCounts[poll.id] ?? {}}
                myOptionIds={responses[poll.id] ?? []}
              />
            ))}
          </View>
        ) : null}

        {/* Itinerary RSVP section (Phase 2 only) */}
        {trip.phase2_unlocked && trip.start_date && trip.end_date && respondentId && (
          <ItineraryRsvpSection
            trip={trip}
            blocks={itineraryBlocks}
            dayRsvps={dayRsvps}
            respondentId={respondentId}
            onRsvpChange={handleRsvpChange}
            rsvpSaving={rsvpSaving}
          />
        )}

        {/* Download prompt */}
        <DownloadPrompt tripName={trip.name} tripId={trip.id} />
      </ScrollView>
      </WebPageShell>
    );
  }

  // ─── Polls step ────────────────────────────────────────────────────────────
  // A poll counts as answered when the respondent has either picked at
  // least one option, submitted a positive numeric value (legacy
  // free-form duration), or queued a write-in label that will be
  // materialized at submit time.
  const answeredCount = polls.filter((p) => {
    const optionPicks = (responses[p.id] ?? []).length > 0;
    const numericPick = (numericResponses[p.id] ?? 0) > 0;
    const writeInPick = (writeIns[p.id] ?? []).length > 0;
    return optionPicks || numericPick || writeInPick;
  }).length;
  const allAnswered = polls.length > 0 && answeredCount === polls.length;

  return (
    <WebPageShell
      cardStyle={IS_WEB ? {
        // @ts-ignore — web-only
        maxHeight: '95vh',
        display: 'flex',
        flexDirection: 'column',
      } : {}}
    >
    <KeyboardAvoidingView
      style={IS_WEB ? { flex: 1, display: 'flex', flexDirection: 'column' } : { flex: 1, backgroundColor: '#F9F9F7' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View
        className="border-b border-line bg-card px-6 pb-4"
        style={{ paddingTop: IS_WEB ? 20 : insets.top + 16 }}
      >
        <Text className="text-sm font-medium text-green">rally · {trip.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <Text className="text-lg font-bold text-ink">
            {hasExistingResponses ? `Hey ${firstName}, update your picks` : `Hey ${firstName}, weigh in`}
          </Text>
          <Ionicons name="arrow-down" size={18} color="#0F3F2E" />
        </View>
        {hasExistingResponses ? (
          <Text className="mt-0.5 text-xs text-muted">
            Your previous responses are pre-loaded — update anything below.
          </Text>
        ) : null}
        <View className="mt-2 flex-row items-center gap-2">
          <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-cream-warm">
            <View
              className="h-full rounded-full bg-green"
              style={{ width: polls.length > 0 ? `${(answeredCount / polls.length) * 100}%` : '0%' }}
            />
          </View>
          <Text className="text-xs text-muted">
            {answeredCount}/{polls.length} answered
          </Text>
        </View>
      </View>

      <ScrollView
        style={IS_WEB ? { flex: 1 } : {}}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: IS_WEB ? 24 : insets.bottom + 100 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {polls.length === 0 ? (
          <View className="items-center py-12">
            <Text className="text-base text-muted">No polls yet — check back soon.</Text>
          </View>
        ) : (
          polls.map((poll) => {
            // Write-in polls take priority — they handle their own chip
            // rendering AND the "add an option" input. Used today by
            // blank-destination polls and duration polls.
            if (poll.allow_write_ins) {
              return (
                <WriteInPollCard
                  key={poll.id}
                  poll={poll}
                  selectedOptions={responses[poll.id] ?? []}
                  pendingWriteIns={writeIns[poll.id] ?? []}
                  onSelect={(optionId) => handleSelect(poll.id, optionId, poll.allow_multi_select)}
                  onAddWriteIn={(label) =>
                    setWriteIns((prev) => ({
                      ...prev,
                      [poll.id]: [...(prev[poll.id] ?? []), label],
                    }))
                  }
                  onRemoveWriteIn={(label) =>
                    setWriteIns((prev) => ({
                      ...prev,
                      [poll.id]: (prev[poll.id] ?? []).filter((l) => l !== label),
                    }))
                  }
                  placeholder={
                    poll.type === 'destination'
                      ? 'Add a destination…'
                      : isDurationPoll(poll)
                        ? 'Add a duration (e.g. 4 nights)…'
                        : 'Add an option…'
                  }
                />
              );
            }
            // Duration poll → chips when planner provided options, free-form
            // numeric input when they didn't (legacy: pre-write-in polls).
            if (isDurationPoll(poll)) {
              return (
                <DurationPollCard
                  key={poll.id}
                  poll={poll}
                  selectedOptions={responses[poll.id] ?? []}
                  numericValue={numericResponses[poll.id] ?? null}
                  onSelect={(optionId) => handleSelect(poll.id, optionId, poll.allow_multi_select)}
                  onNumericChange={(n) => setNumericResponses((prev) => ({ ...prev, [poll.id]: n }))}
                />
              );
            }
            return isDateRangeLabel(poll.poll_options[0]?.label ?? '') ? (
              <DatesPollCard
                key={poll.id}
                poll={poll}
                selectedOptions={responses[poll.id] ?? []}
                onSelect={(optionId) => handleSelect(poll.id, optionId, poll.allow_multi_select)}
                onSetSelections={(ids) => setResponses((prev) => ({ ...prev, [poll.id]: ids }))}
                tripDuration={trip.trip_duration}
              />
            ) : (
              <PollResponseCard
                key={poll.id}
                poll={poll}
                selectedOptions={responses[poll.id] ?? []}
                onSelect={(optionId) => handleSelect(poll.id, optionId, poll.allow_multi_select)}
              />
            );
          })
        )}
      </ScrollView>

      {/* Submit bar */}
      {polls.length > 0 ? (
        <View
          className="border-t border-line bg-card px-6 pt-3"
          style={{ paddingBottom: IS_WEB ? 16 : insets.bottom + 12 }}
        >
          {!allAnswered ? (
            <Text className="mb-2 text-center text-xs text-muted">
              Answer all {polls.length} poll{polls.length !== 1 ? 's' : ''} to submit
            </Text>
          ) : null}
          <Button
            onPress={handleSubmit}
            loading={submitting}
            disabled={!allAnswered}
            fullWidth
            size="lg"
          >
            {hasExistingResponses ? 'Update responses' : 'Submit responses'}
          </Button>
        </View>
      ) : null}
    </KeyboardAvoidingView>
    </WebPageShell>
  );
}
