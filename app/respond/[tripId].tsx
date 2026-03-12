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
import { Button } from '@/components/ui';
import { getTripByShareToken } from '@/lib/api/trips';
import {
  getOrCreateRespondent,
  getExistingRespondentForTrip,
  getExistingResponses,
  submitPollResponses,
  clearTripSession,
} from '@/lib/api/respondents';
import { getResponseCountsForTrip } from '@/lib/api/responses';
import { capture, Events } from '@/lib/analytics';
import type { TripWithPolls, PollWithOptions, Respondent } from '@/types/database';

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

  // "Mar 15 – Apr 2" (cross-month) or "Mar 15 – Mar 20" (same month)
  const rangeMatch = label.match(/^([A-Z][a-z]+)\s+(\d+)\s*[–\-]\s*([A-Z][a-z]+)\s+(\d+)$/);
  if (rangeMatch) {
    const start = dateFor(rangeMatch[1], parseInt(rangeMatch[2], 10));
    const end = dateFor(rangeMatch[3], parseInt(rangeMatch[4], 10));
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
      <Text className="mb-3 text-lg font-semibold text-neutral-800">{poll.title}</Text>
      {poll.allow_multi_select ? (
        <Text className="mb-2 text-xs text-neutral-400">Select all that apply</Text>
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
                  ? 'border-coral-400 bg-coral-50'
                  : 'border-neutral-200 bg-white',
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
                  selected ? 'border-coral-500 bg-coral-500' : 'border-neutral-300 bg-white',
                ].join(' ')}
              >
                {selected ? (
                  poll.allow_multi_select ? (
                    <Ionicons name="checkmark" size={12} color="white" />
                  ) : (
                    <View className="h-2 w-2 rounded-full bg-white" />
                  )
                ) : null}
              </View>
              <Text
                className={['flex-1 text-base', selected ? 'font-medium text-neutral-800' : 'text-neutral-700'].join(' ')}
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

// ─── Calendar card for availability-style dates polls ─────────────────────────

function DatesPollCard({
  poll,
  selectedOptions,
  onSelect,
}: {
  poll: PollWithOptions;
  selectedOptions: string[];
  onSelect: (optionId: string) => void;
}) {
  const parsedOptions = poll.poll_options
    .map((opt) => ({ ...opt, range: parseDateRangeLabel(opt.label) }))
    .filter((opt): opt is typeof opt & { range: { start: Date; end: Date } } => opt.range !== null);

  // Fall back to list UI if none of the labels parsed as dates (e.g. duration poll)
  if (parsedOptions.length === 0) {
    return (
      <PollResponseCard poll={poll} selectedOptions={selectedOptions} onSelect={onSelect} />
    );
  }

  const allDates = parsedOptions.flatMap((o) => [o.range.start, o.range.end]);
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
      const e = new Date(o.range.end.getFullYear(), o.range.end.getMonth(), o.range.end.getDate()).getTime() + 86399999;
      return t >= s && t <= e;
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

  return (
    <View className="mb-5">
      <Text className="mb-3 text-lg font-semibold text-neutral-800">{poll.title}</Text>
      {poll.allow_multi_select ? (
        <Text className="mb-2 text-xs text-neutral-400">Tap all dates you're available</Text>
      ) : null}

      <View className="rounded-2xl border border-neutral-200 bg-white p-4">
        {/* Month navigation */}
        <View className="mb-3 flex-row items-center justify-between">
          <Pressable
            onPress={() => {
              const d = new Date(viewYear, viewMonth - 1, 1);
              setViewYear(d.getFullYear());
              setViewMonth(d.getMonth());
            }}
            disabled={!canGoPrev}
            className="rounded-lg p-1.5 active:bg-neutral-100"
            accessibilityRole="button"
            accessibilityLabel="Previous month"
          >
            <Ionicons name="chevron-back" size={18} color={canGoPrev ? '#6B7280' : '#D1D5DB'} />
          </Pressable>
          <Text className="text-sm font-semibold text-neutral-700">{monthLabel}</Text>
          <Pressable
            onPress={() => {
              const d = new Date(viewYear, viewMonth + 1, 1);
              setViewYear(d.getFullYear());
              setViewMonth(d.getMonth());
            }}
            disabled={!canGoNext}
            className="rounded-lg p-1.5 active:bg-neutral-100"
            accessibilityRole="button"
            accessibilityLabel="Next month"
          >
            <Ionicons name="chevron-forward" size={18} color={canGoNext ? '#6B7280' : '#D1D5DB'} />
          </Pressable>
        </View>

        {/* Day headers */}
        <View className="mb-1 flex-row">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
            <Text key={d} className="flex-1 text-center text-xs font-medium text-neutral-400">
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
            const isHighlighted = opt !== undefined;
            const isSelected = opt ? selectedOptions.includes(opt.id) : false;
            return (
              <Pressable
                key={date.toISOString()}
                onPress={() => opt && onSelect(opt.id)}
                disabled={!isHighlighted}
                style={{ width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}
                accessibilityRole={isHighlighted ? (poll.allow_multi_select ? 'checkbox' : 'radio') : 'none'}
                accessibilityState={isHighlighted ? { checked: isSelected, selected: isSelected } : undefined}
                accessibilityLabel={isHighlighted && opt ? opt.label : undefined}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isSelected ? '#FF6B5B' : isHighlighted ? '#FFF0EE' : 'transparent',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: isHighlighted ? '600' : '400',
                      color: isSelected ? '#FFFFFF' : isHighlighted ? '#FF6B5B' : '#D1D5DB',
                    }}
                  >
                    {date.getDate()}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Selected range chips */}
      {selectedOptions.length > 0 ? (
        <View className="mt-3 flex-row flex-wrap gap-2">
          {poll.poll_options
            .filter((o) => selectedOptions.includes(o.id))
            .map((o) => (
              <View key={o.id} className="flex-row items-center gap-1 rounded-full bg-coral-50 px-3 py-1">
                <Ionicons name="checkmark-circle" size={13} color="#FF6B5B" />
                <Text className="text-xs font-medium text-coral-600">{o.label}</Text>
              </View>
            ))}
        </View>
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

  return (
    <View className="mb-5">
      <Text className="mb-3 text-sm font-semibold text-neutral-700">{poll.title}</Text>
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
                    isLeading ? 'font-semibold text-neutral-800' : 'text-neutral-600',
                  ].join(' ')}
                  numberOfLines={1}
                >
                  {opt.label}
                </Text>
                {isMyPick ? (
                  <View className="ml-2 rounded-full bg-coral-100 px-2 py-0.5">
                    <Text className="text-xs font-medium text-coral-600">Your pick</Text>
                  </View>
                ) : null}
                <Text className="ml-2 text-xs text-neutral-400">
                  {votes} vote{votes !== 1 ? 's' : ''}
                </Text>
              </View>
              <View className="h-2 overflow-hidden rounded-full bg-neutral-100">
                <View
                  className={[
                    'h-full rounded-full',
                    isMyPick || isLeading ? 'bg-coral-500' : 'bg-neutral-300',
                  ].join(' ')}
                  style={{ width: pct > 0 ? `${pct}%` : '2%' }}
                />
              </View>
            </View>
          );
        })}
      </View>
      <Text className="mt-2 text-xs text-neutral-400">
        {totalVotes === 0
          ? "You're the first — results will appear as others respond."
          : `${totalVotes} vote${totalVotes !== 1 ? 's' : ''} so far`}
      </Text>
    </View>
  );
}

// ─── Download prompt (post-submission) ────────────────────────────────────────

function DownloadPrompt({ tripName }: { tripName?: string }) {
  const APP_STORE_URL = 'https://apps.apple.com/app/rally/id0000000000'; // replace at launch
  const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.rally.app';

  function handleDownload(store: 'ios' | 'android') {
    capture(Events.DOWNLOAD_PROMPT_TAPPED, { store });
    Linking.openURL(store === 'ios' ? APP_STORE_URL : PLAY_STORE_URL);
  }

  return (
    <View className="mt-6 rounded-3xl bg-coral-500 px-6 py-8">
      <Text className="text-center text-xl font-bold text-white">
        Results are coming in 👀
      </Text>
      <Text className="mt-2 text-center text-sm text-coral-100">
        Download rally to watch the votes roll in and get notified when{' '}
        {tripName ? `the group decides on ${tripName}` : 'the group makes a decision'}.
      </Text>
      <View className="mt-5 gap-3">
        <Pressable
          onPress={() => handleDownload('ios')}
          className="flex-row items-center justify-center gap-2 rounded-2xl bg-white py-3.5"
          accessibilityRole="button"
          accessibilityLabel="Download on the App Store"
        >
          <Ionicons name="logo-apple" size={20} color="#222222" />
          <Text className="font-semibold text-neutral-800">App Store</Text>
        </Pressable>
        <Pressable
          onPress={() => handleDownload('android')}
          className="flex-row items-center justify-center gap-2 rounded-2xl bg-white py-3.5"
          accessibilityRole="button"
          accessibilityLabel="Get it on Google Play"
        >
          <Ionicons name="logo-google-playstore" size={20} color="#222222" />
          <Text className="font-semibold text-neutral-800">Google Play</Text>
        </Pressable>
      </View>
      <Text className="mt-4 text-center text-xs text-coral-200">
        Or plan your own trip — it's free.
      </Text>
    </View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────

type Step = 'name' | 'polls' | 'done';

export default function RespondScreen() {
  const { tripId: shareToken } = useLocalSearchParams<{ tripId: string }>();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [trip, setTrip] = useState<TripWithPolls | null>(null);
  const [loadError, setLoadError] = useState<'not_found' | 'closed' | 'error' | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [hasExistingResponses, setHasExistingResponses] = useState(false);
  const [existingRespondent, setExistingRespondent] = useState<Respondent | null>(null);

  // responses: { [pollId]: optionId[] }
  const [responses, setResponses] = useState<Record<string, string[]>>({});
  // live vote counts fetched after submission: { [pollId]: { [optionId]: count } }
  const [resultCounts, setResultCounts] = useState<Record<string, Record<string, number>>>({});
  const nameInputRef = useRef<TextInput>(null);

  // ─── Load trip ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const data = await getTripByShareToken(shareToken);
        setTrip(data);

        // Pre-fill name from storage (convenience — user still sees the name step)
        const stored = await getStoredName();
        if (stored) setName(stored);

        // Load any existing responses for this device+trip without auto-skipping.
        // This lets a returning user update their picks, while still allowing a
        // *different* person on the same device to enter their own name and respond.
        try {
          const respondent = await getExistingRespondentForTrip(data.id);
          if (respondent) {
            setExistingRespondent(respondent);
            setName(respondent.name); // Pre-fill with their actual stored name
            const existing = await getExistingResponses(data.id, respondent.id);
            const anyExisting = Object.values(existing).some((arr) => arr.length > 0);
            if (anyExisting) {
              setResponses(existing);
              setHasExistingResponses(true);
            }
          } else if (stored) {
            setName(stored);
          }
        } catch {
          // No existing respondent — fine, fresh start
          if (stored) setName(stored);
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
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Please enter your first name');
      return;
    }
    await storeName(trimmed);
    setNameError('');

    // If they entered a different name than the existing respondent, clear the
    // trip session so a new respondent gets created on submit. This allows a
    // different person on the same device to respond independently.
    if (existingRespondent && existingRespondent.name !== trimmed) {
      await clearTripSession(trip!.id);
      setExistingRespondent(null);
      setHasExistingResponses(false);
      setResponses({});
    }

    setStep('polls');
  }

  // ─── Respond as someone else (clears stored session for this trip) ─────────
  async function handleRespondAsDifferentPerson() {
    if (!trip) return;
    await clearTripSession(trip.id);
    setExistingRespondent(null);
    setHasExistingResponses(false);
    setResponses({});
    setName('');
    setNameError('');
  }

  // ─── Submit all responses ──────────────────────────────────────────────────
  async function handleSubmit() {
    if (!trip) return;
    setSubmitting(true);
    try {
      const respondent = await getOrCreateRespondent(trip.id, name.trim());
      const polls = trip.polls ?? [];
      for (const poll of polls) {
        const optionIds = responses[poll.id] ?? [];
        await submitPollResponses(poll.id, respondent.id, optionIds);
      }
      capture(Events.RESPONDENT_SUBMITTED, { trip_id: trip.id, poll_count: polls.length });
      // Fetch live counts so the confirmation screen can show a results visual
      try {
        const counts = await getResponseCountsForTrip(trip.id);
        setResultCounts(counts);
      } catch {
        // non-fatal — confirmation screen will just show empty bars
      }
      setStep('done');
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

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-neutral-50">
        <ActivityIndicator size="large" color="#FF6B5B" />
      </View>
    );
  }

  if (loadError === 'not_found') {
    return (
      <View className="flex-1 items-center justify-center bg-neutral-50 px-8">
        <Text className="text-5xl">🔗</Text>
        <Text className="mt-4 text-center text-xl font-semibold text-neutral-800">
          This rally no longer exists.
        </Text>
        <Text className="mt-2 text-center text-sm text-neutral-400">
          The trip planner may have deleted it.
        </Text>
      </View>
    );
  }

  if (loadError === 'closed' || (trip && trip.status !== 'active')) {
    return (
      <View className="flex-1 items-center justify-center bg-neutral-50 px-8">
        <Text className="text-5xl">🔒</Text>
        <Text className="mt-4 text-center text-xl font-semibold text-neutral-800">
          This rally is no longer accepting responses.
        </Text>
        <Text className="mt-2 text-center text-sm text-neutral-400">
          The planner has closed it.
        </Text>
      </View>
    );
  }

  if (loadError === 'error') {
    return (
      <View className="flex-1 items-center justify-center bg-neutral-50 px-8">
        <Text className="text-5xl">⚠️</Text>
        <Text className="mt-4 text-center text-xl font-semibold text-neutral-800">
          Something went wrong.
        </Text>
        <Text className="mt-2 text-center text-sm text-neutral-400">
          Check your connection and try again.
        </Text>
      </View>
    );
  }

  if (!trip) return null;

  const polls: PollWithOptions[] = trip.polls ?? [];
  const plannerLabel = 'Your trip planner';

  // ─── Name step ─────────────────────────────────────────────────────────────
  if (step === 'name') {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-neutral-50"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View
          className="flex-1 justify-center px-6"
          style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
        >
          {/* Rally wordmark */}
          <Text className="mb-1 text-3xl font-bold text-coral-500">rally</Text>

          {/* Trip header */}
          <Text className="text-2xl font-bold text-neutral-800">{trip.name}</Text>
          <Text className="mt-1 text-base text-neutral-500">
            {plannerLabel} is planning a trip and wants your input.
          </Text>

          <View className="mt-8 gap-4">
            {/* Returning user banner */}
            {existingRespondent && hasExistingResponses ? (
              <View className="flex-row items-center justify-between rounded-2xl bg-coral-50 px-4 py-3">
                <Text className="text-sm text-coral-700">
                  Updating your previous responses
                </Text>
                <Pressable
                  onPress={handleRespondAsDifferentPerson}
                  accessibilityRole="button"
                  accessibilityLabel="Respond as a different person"
                  hitSlop={8}
                >
                  <Text className="text-sm font-medium text-coral-500">Not you?</Text>
                </Pressable>
              </View>
            ) : null}

            <View className="gap-1">
              <Text className="text-sm font-medium text-neutral-700">What's your first name?</Text>
              <TextInput
                ref={nameInputRef}
                value={name}
                onChangeText={(t) => {
                  setName(t.slice(0, 30));
                  if (nameError) setNameError('');
                }}
                placeholder="First name"
                maxLength={30}
                autoFocus
                autoCapitalize="words"
                autoComplete="given-name"
                returnKeyType="go"
                onSubmitEditing={handleNameContinue}
                className="min-h-[52px] rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-lg text-neutral-800"
                placeholderTextColor="#A8A8A8"
              />
              {nameError ? (
                <Text className="text-sm text-red-500">{nameError}</Text>
              ) : null}
            </View>

            <Button onPress={handleNameContinue} fullWidth size="lg">
              {existingRespondent && hasExistingResponses ? 'Update my responses →' : 'See polls →'}
            </Button>

            <Text className="text-center text-xs text-neutral-400">
              No account needed. Your name is only used to label your responses.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ─── Done step ─────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <ScrollView
        className="flex-1 bg-neutral-50"
        contentContainerStyle={{
          paddingTop: insets.top + 24,
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <Text className="text-3xl font-bold text-coral-500">rally</Text>

        <View className="mt-8 items-center">
          <Text className="text-4xl">🎉</Text>
          <Text className="mt-4 text-center text-2xl font-bold text-neutral-800">
            {hasExistingResponses ? 'Responses updated!' : 'Responses sent!'}
          </Text>
          <Text className="mt-2 text-center text-base text-neutral-500">
            You're in. Here's where the group stands so far.
          </Text>
        </View>

        {/* Live poll results visual */}
        {polls.length > 0 ? (
          <View className="mt-6 rounded-2xl border border-neutral-100 bg-white p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-neutral-700">Live results</Text>
              <View className="flex-row items-center gap-1">
                <View className="h-1.5 w-1.5 rounded-full bg-green-400" />
                <Text className="text-xs text-neutral-400">Updating live</Text>
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

        {/* Download prompt */}
        <DownloadPrompt tripName={trip.name} />
      </ScrollView>
    );
  }

  // ─── Polls step ────────────────────────────────────────────────────────────
  const answeredCount = polls.filter((p) => (responses[p.id] ?? []).length > 0).length;
  const allAnswered = polls.length > 0 && answeredCount === polls.length;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-neutral-50"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View
        className="border-b border-neutral-100 bg-white px-6 pb-4"
        style={{ paddingTop: insets.top + 16 }}
      >
        <Text className="text-sm font-medium text-coral-500">rally · {trip.name}</Text>
        <Text className="mt-0.5 text-lg font-bold text-neutral-800">
          {hasExistingResponses ? `Hey ${name}, update your picks 👇` : `Hey ${name}, weigh in 👇`}
        </Text>
        {hasExistingResponses ? (
          <Text className="mt-0.5 text-xs text-neutral-400">
            Your previous responses are pre-loaded — update anything below.
          </Text>
        ) : null}
        <View className="mt-2 flex-row items-center gap-2">
          <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
            <View
              className="h-full rounded-full bg-coral-500"
              style={{ width: polls.length > 0 ? `${(answeredCount / polls.length) * 100}%` : '0%' }}
            />
          </View>
          <Text className="text-xs text-neutral-400">
            {answeredCount}/{polls.length} answered
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: insets.bottom + 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {polls.length === 0 ? (
          <View className="items-center py-12">
            <Text className="text-base text-neutral-500">No polls yet — check back soon.</Text>
          </View>
        ) : (
          polls.map((poll) =>
            isDateRangeLabel(poll.poll_options[0]?.label ?? '') ? (
              <DatesPollCard
                key={poll.id}
                poll={poll}
                selectedOptions={responses[poll.id] ?? []}
                onSelect={(optionId) => handleSelect(poll.id, optionId, poll.allow_multi_select)}
              />
            ) : (
              <PollResponseCard
                key={poll.id}
                poll={poll}
                selectedOptions={responses[poll.id] ?? []}
                onSelect={(optionId) => handleSelect(poll.id, optionId, poll.allow_multi_select)}
              />
            )
          )
        )}
      </ScrollView>

      {/* Submit bar */}
      {polls.length > 0 ? (
        <View
          className="border-t border-neutral-100 bg-white px-6 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          {!allAnswered ? (
            <Text className="mb-2 text-center text-xs text-neutral-400">
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
  );
}
