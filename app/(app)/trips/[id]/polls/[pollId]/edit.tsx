import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
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
import { Button, Divider, Input, Pill, Toggle } from '@/components/ui';
import { POPULAR_DESTINATIONS } from '@/lib/constants/destinations';
import { usePolls } from '@/hooks/usePolls';
import { pollKeys } from '@/hooks/usePolls';
import { useResponseCounts } from '@/hooks/useResponseCounts';
import { updatePoll, updatePollOptions } from '@/lib/api/polls';
import { capture, Events } from '@/lib/analytics';
import { useQueryClient } from '@tanstack/react-query';
import type { PollWithOptions } from '@/types/database';
import type { BudgetRange, DateRange } from '@/types/polls';
import {
  chunkArray,
  DAY_NAMES,
  DURATION_OPTIONS,
  fmtRange,
  fmtShort,
  generateRangeLabel,
  getMinForRange,
  isSameDay,
  MONTH_NAMES,
  parseBudgetMax,
  parseDateRangeLabel,
  stripTime,
} from '@/lib/pollFormUtils';

// ── Local helpers ─────────────────────────────────────────────────────────────

/** True when a poll-option label encodes a calendar date range. */
function isDateRangeLabel(label: string): boolean {
  return parseDateRangeLabel(label) !== null;
}

// ── BoundaryInput ──────────────────────────────────────────────────────────────

function BoundaryInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  function handleCommit() {
    const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(num) && num > 0) { onCommit(num); } else { setText(String(value)); }
  }
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onBlur={handleCommit}
      onSubmitEditing={handleCommit}
      keyboardType="number-pad"
      selectTextOnFocus
      className="min-w-[56px] rounded-lg border border-line bg-cream px-2 py-1 text-center text-sm font-medium text-ink"
      accessibilityLabel="budget boundary"
    />
  );
}

// ── DestinationInput ───────────────────────────────────────────────────────────

function DestinationInput({
  value,
  onChangeText,
  placeholder,
  maxLength,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  maxLength?: number;
}) {
  const [focused, setFocused] = useState(false);
  const trimmed = value.trim().toLowerCase();
  const suggestions =
    focused && trimmed.length >= 1
      ? POPULAR_DESTINATIONS.filter((d) => d.toLowerCase().includes(trimmed)).slice(0, 5)
      : [];

  return (
    <View>
      <TextInput
        value={value}
        onChangeText={(v) => onChangeText(maxLength ? v.slice(0, maxLength) : v)}
        placeholder={placeholder}
        maxLength={maxLength}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        className="min-h-[48px] rounded-2xl border border-line bg-card px-4 py-3 text-base text-ink"
        placeholderTextColor="#A8A8A8"
      />
      {suggestions.length > 0 ? (
        <View className="mt-1 overflow-hidden rounded-xl border border-line bg-card">
          {suggestions.map((s, i) => (
            <Pressable
              key={s}
              onPress={() => { onChangeText(maxLength ? s.slice(0, maxLength) : s); setFocused(false); }}
              className={['flex-row items-center gap-2 px-4 py-3', i < suggestions.length - 1 ? 'border-b border-line' : ''].join(' ')}
            >
              <Ionicons name="location-outline" size={15} color="#A8A8A8" />
              <Text className="text-sm text-ink">{s}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ── CalendarPicker ─────────────────────────────────────────────────────────────

function CalendarPicker({ ranges, onRangesChange }: { ranges: DateRange[]; onRangesChange: (r: DateRange[]) => void }) {
  const today = stripTime(new Date());
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [pendingStart, setPendingStart] = useState<Date | null>(null);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); } else { setViewMonth((m) => m - 1); }
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); } else { setViewMonth((m) => m + 1); }
  }

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const trailingNulls = (7 - ((firstDayOfWeek + daysInMonth) % 7)) % 7;
  const cells: (Date | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(viewYear, viewMonth, i + 1)),
    ...Array(trailingNulls).fill(null),
  ];
  const weeks = chunkArray(cells, 7);

  type DayState = 'start' | 'end' | 'inRange' | 'single' | 'pending' | 'none';
  function getDayState(d: Date): DayState {
    if (pendingStart && isSameDay(d, pendingStart)) return 'pending';
    for (const r of ranges) {
      if (isSameDay(d, r.start) && isSameDay(d, r.end)) return 'single';
      if (isSameDay(d, r.start)) return 'start';
      if (isSameDay(d, r.end)) return 'end';
      if (d.getTime() > r.start.getTime() && d.getTime() < r.end.getTime()) return 'inRange';
    }
    return 'none';
  }

  function handleDayPress(d: Date) {
    const clean = stripTime(d);
    if (!pendingStart) {
      setPendingStart(clean);
    } else {
      const start = clean < pendingStart ? clean : pendingStart;
      const end = clean < pendingStart ? pendingStart : clean;
      onRangesChange([...ranges, { start, end }]);
      setPendingStart(null);
    }
  }

  return (
    <View className="rounded-2xl border border-line bg-card p-4">
      <View className="mb-3 flex-row items-center justify-between">
        <Pressable onPress={prevMonth} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} className="p-1">
          <Ionicons name="chevron-back" size={20} color="#6B6B6B" />
        </Pressable>
        <Text className="text-sm font-semibold text-ink">{MONTH_NAMES[viewMonth]} {viewYear}</Text>
        <Pressable onPress={nextMonth} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} className="p-1">
          <Ionicons name="chevron-forward" size={20} color="#6B6B6B" />
        </Pressable>
      </View>
      <View className="mb-1 flex-row">
        {DAY_NAMES.map((d) => (
          <View key={d} style={{ flex: 1 }} className="items-center">
            <Text className="text-xs font-medium text-muted">{d}</Text>
          </View>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} className="flex-row">
          {week.map((day, di) => {
            if (!day) return <View key={di} style={{ flex: 1 }} />;
            const state = getDayState(day);
            const isEndpoint = ['start', 'end', 'single', 'pending'].includes(state);
            const isIn = state === 'inRange';
            return (
              <Pressable key={di} onPress={() => handleDayPress(day)} style={{ flex: 1 }} className="items-center py-0.5">
                <View className={['h-8 w-8 items-center justify-center rounded-full', isEndpoint ? 'bg-green' : isIn ? 'bg-green-soft' : ''].join(' ')}>
                  <Text className={['text-xs', isEndpoint ? 'font-bold text-white' : isIn ? 'text-green-dark' : 'text-ink'].join(' ')}>
                    {day.getDate()}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
      <Text className="mt-2 text-center text-xs text-muted">
        {pendingStart ? `Now tap an end date (started ${fmtShort(pendingStart)})` : 'Tap a start date to add a period'}
      </Text>
      {ranges.length > 0 ? (
        <View className="mt-3 flex-row flex-wrap gap-2">
          {ranges.map((r, i) => (
            <View key={i} className="flex-row items-center gap-1 rounded-full border border-line bg-green-soft px-3 py-1.5">
              <Text className="text-sm text-green-dark">{fmtRange(r)}</Text>
              <Pressable onPress={() => onRangesChange(ranges.filter((_, j) => j !== i))} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
                <Ionicons name="close" size={13} color="#0F3F2E" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function EditPollScreen() {
  const { id: tripId, pollId } = useLocalSearchParams<{ id: string; pollId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data: polls = [] } = usePolls(tripId);
  const { data: responseCounts = {} } = useResponseCounts(tripId);
  const poll = polls.find((p) => p.id === pollId) as PollWithOptions | undefined;

  const pollVotes = poll
    ? Object.values(responseCounts[poll.id] ?? {}).reduce((s: number, n: number) => s + n, 0)
    : 0;
  const hasResponses = pollVotes > 0;

  // ── Destination state ──
  const [destTitle, setDestTitle] = useState('');
  const [destOptions, setDestOptions] = useState<string[]>(['', '']);
  const [destAllowMulti, setDestAllowMulti] = useState(false);

  // ── Custom state ──
  const [customTitle, setCustomTitle] = useState('');
  const [customOptions, setCustomOptions] = useState<string[]>(['', '']);
  const [customAllowMulti, setCustomAllowMulti] = useState(false);

  // ── Dates state — detect availability vs duration ──
  const [datesTitle, setDatesTitle] = useState('');
  const [dateRanges, setDateRanges] = useState<DateRange[]>([]);
  const [isDatesAvailability, setIsDatesAvailability] = useState(true);
  // Duration-mode state
  const [selectedDurations, setSelectedDurations] = useState<string[]>([]);
  const [customDurationInput, setCustomDurationInput] = useState('');
  const [customDurationUnit, setCustomDurationUnit] = useState<'days' | 'weeks' | 'months'>('days');

  // ── Budget state ──
  const [budgetTitle, setBudgetTitle] = useState('');
  const [budgetRanges, setBudgetRanges] = useState<BudgetRange[]>([]);

  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Populate form from existing poll on load
  useEffect(() => {
    if (!poll || initialized) return;
    setInitialized(true);

    if (poll.type === 'destination') {
      setDestTitle(poll.title);
      setDestAllowMulti(poll.allow_multi_select);
      setDestOptions(
        poll.poll_options.length >= 2
          ? poll.poll_options.map((o) => o.label)
          : [...poll.poll_options.map((o) => o.label), ...Array(Math.max(0, 2 - poll.poll_options.length)).fill('')]
      );
    } else if (poll.type === 'dates') {
      setDatesTitle(poll.title);
      const firstLabel = poll.poll_options[0]?.label ?? '';
      const isAvail = isDateRangeLabel(firstLabel);
      setIsDatesAvailability(isAvail);
      if (isAvail) {
        // Parse date range labels back to DateRange[]
        const parsed = poll.poll_options
          .map((o) => parseDateRangeLabel(o.label))
          .filter((r): r is DateRange => r !== null);
        setDateRanges(parsed);
      } else {
        // Duration poll — restore selected durations
        setSelectedDurations(poll.poll_options.map((o) => o.label));
      }
    } else if (poll.type === 'budget') {
      setBudgetTitle(poll.title);
      setBudgetRanges(
        poll.poll_options.map((opt, i) => ({
          id: opt.id,
          label: opt.label,
          max: parseBudgetMax(opt.label),
          selected: true,
          labelOverridden: true,
        }))
      );
    } else if (poll.type === 'custom') {
      setCustomTitle(poll.title);
      setCustomAllowMulti(poll.allow_multi_select);
      setCustomOptions(
        poll.poll_options.length >= 2
          ? poll.poll_options.map((o) => o.label)
          : [...poll.poll_options.map((o) => o.label), ...Array(Math.max(0, 2 - poll.poll_options.length)).fill('')]
      );
    }
  }, [poll, initialized]);

  if (!poll) return null;
  // Reassign with narrowed type so closures below don't require null checks
  const p = poll;

  // ── Destination helpers ──
  function addDestOption() {
    if (destOptions.length >= 6) return;
    setDestOptions([...destOptions, '']);
  }
  function updateDestOption(i: number, v: string) {
    const u = [...destOptions]; u[i] = v.slice(0, 40); setDestOptions(u);
  }
  function removeDestOption(i: number) {
    if (destOptions.length <= 2) return;
    setDestOptions(destOptions.filter((_, j) => j !== i));
  }

  // ── Duration helpers ──
  function toggleDuration(d: string) {
    setSelectedDurations((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  }
  function addCustomDuration() {
    const num = parseInt(customDurationInput, 10);
    if (!customDurationInput || isNaN(num) || num < 1) return;
    const val = `${num} ${customDurationUnit}`;
    if (!selectedDurations.includes(val)) setSelectedDurations((prev) => [...prev, val]);
    setCustomDurationInput('');
  }

  // ── Budget helpers ──
  function updateBoundary(i: number, newMax: number) {
    setBudgetRanges((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], max: newMax };
      if (!next[i].labelOverridden) {
        next[i] = { ...next[i], label: generateRangeLabel(getMinForRange(i, next), newMax) };
      }
      if (i + 1 < next.length && !next[i + 1].labelOverridden) {
        next[i + 1] = { ...next[i + 1], label: generateRangeLabel(newMax, next[i + 1].max) };
      }
      return next;
    });
  }
  function toggleBudgetRange(id: string) {
    setBudgetRanges((prev) => prev.map((r) => r.id === id ? { ...r, selected: !r.selected } : r));
  }
  function updateRangeLabel(id: string, label: string) {
    setBudgetRanges((prev) => prev.map((r) => r.id === id ? { ...r, label, labelOverridden: true } : r));
  }
  function addBudgetTier() {
    setBudgetRanges((prev) => {
      if (prev.length >= 6) return prev;
      const secondToLast = prev[prev.length - 2];
      const lastMax = secondToLast?.max ?? 1000;
      const newMax = lastMax * 2;
      const newTier: BudgetRange = { id: `b${Date.now()}`, label: generateRangeLabel(lastMax, newMax), max: newMax, selected: true, labelOverridden: false };
      const next = [...prev.slice(0, -1), newTier, prev[prev.length - 1]];
      const lastIdx = next.length - 1;
      if (!next[lastIdx].labelOverridden) next[lastIdx] = { ...next[lastIdx], label: generateRangeLabel(newMax, null) };
      return next;
    });
  }
  function removeBudgetTier(id: string) {
    setBudgetRanges((prev) => {
      if (prev.length <= 2) return prev;
      const next = prev.filter((r) => r.id !== id);
      return next.map((r, i) => {
        if (r.labelOverridden) return r;
        return { ...r, label: generateRangeLabel(getMinForRange(i, next), r.max) };
      });
    });
  }

  // ── Custom helpers ──
  function addCustomOption() {
    if (customOptions.length >= 6) return;
    setCustomOptions([...customOptions, '']);
  }
  function updateCustomOption(i: number, v: string) {
    const u = [...customOptions]; u[i] = v.slice(0, 60); setCustomOptions(u);
  }
  function removeCustomOption(i: number) {
    if (customOptions.length <= 2) return;
    setCustomOptions(customOptions.filter((_, j) => j !== i));
  }

  // ── Build save payload ──
  function buildOptions(): { label: string; position: number }[] {
    if (p.type === 'destination') {
      return destOptions.filter((o) => o.trim()).map((o, i) => ({ label: o.trim(), position: i }));
    }
    if (p.type === 'dates') {
      if (isDatesAvailability) {
        return dateRanges.map((r, i) => ({ label: fmtRange(r), position: i }));
      }
      return selectedDurations.map((d, i) => ({ label: d, position: i }));
    }
    if (p.type === 'budget') {
      return budgetRanges.filter((r) => r.selected).map((r, i) => ({ label: r.label, position: i }));
    }
    if (p.type === 'custom') {
      return customOptions.filter((o) => o.trim()).map((o, i) => ({ label: o.trim(), position: i }));
    }
    return [];
  }

  function getTitle(): string {
    if (p.type === 'destination') return destTitle;
    if (p.type === 'dates') return datesTitle;
    if (p.type === 'custom') return customTitle;
    return budgetTitle;
  }

  async function handleSave() {
    if (hasResponses) return;
    const titleVal = getTitle().trim();
    if (!titleVal) { Alert.alert('Missing info', 'Poll question is required'); return; }
    const opts = buildOptions();
    if (opts.length < 2) { Alert.alert('Missing info', 'Add at least 2 options'); return; }

    setSaving(true);
    try {
      await updatePoll(p.id, {
        title: titleVal,
        allow_multi_select:
          p.type === 'destination' ? destAllowMulti :
          p.type === 'custom' ? customAllowMulti :
          p.allow_multi_select,
      });
      await updatePollOptions(p.id, opts);
      capture(Events.POLL_UPDATED, { poll_type: p.type, trip_id: tripId });
      qc.invalidateQueries({ queryKey: pollKeys.forTrip(tripId) });
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save changes. Try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ──
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-cream"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="flex-row items-center justify-between px-6 pb-4" style={{ paddingTop: insets.top + 16 }}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text className="text-base text-green">Cancel</Text>
        </TouchableOpacity>
        <Text className="text-lg font-semibold text-ink">Edit poll</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-5">

          {/* ── Destination ──────────────────────────────────────────────── */}
          {poll.type === 'destination' && (
            <>
              <Input
                label="Question"
                value={destTitle}
                onChangeText={setDestTitle}
              />
              <Divider />
              <View className="gap-2">
                <Text className="text-sm font-medium text-ink">
                  Options <Text className="font-normal text-muted">({destOptions.length}/6)</Text>
                </Text>
                <Text className="text-xs text-muted -mt-1">Type to search cities & countries</Text>
                {destOptions.map((opt, i) => (
                  <View key={i} className="flex-row items-center gap-2">
                    <View className="flex-1">
                      <DestinationInput
                        value={opt}
                        onChangeText={(v) => updateDestOption(i, v)}
                        placeholder={`Option ${i + 1}${i < 2 ? ' *' : ''}`}
                        maxLength={40}
                      />
                    </View>
                    {destOptions.length > 2 ? (
                      <Pressable onPress={() => removeDestOption(i)} className="p-2" accessibilityRole="button">
                        <Ionicons name="close-circle" size={22} color="#A8A8A8" />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                {destOptions.length < 6 ? (
                  <Pressable onPress={addDestOption} className="flex-row items-center gap-2 py-2" accessibilityRole="button">
                    <Ionicons name="add-circle-outline" size={20} color="#0F3F2E" />
                    <Text className="text-base text-green">Add option</Text>
                  </Pressable>
                ) : null}
              </View>
              <Divider />
              <View className="flex-row items-center justify-between">
                <View className="flex-1 gap-0.5">
                  <Text className="text-base font-medium text-ink">Allow multiple choices</Text>
                  <Text className="text-sm text-muted">Group members can select more than one</Text>
                </View>
                <Toggle value={destAllowMulti} onValueChange={setDestAllowMulti} />
              </View>
            </>
          )}

          {/* ── Dates ────────────────────────────────────────────────────── */}
          {poll.type === 'dates' && (
            <>
              <Input
                label="Question"
                value={datesTitle}
                onChangeText={setDatesTitle}
              />
              <Divider />
              {isDatesAvailability ? (
                <>
                  <Text className="text-sm font-medium text-ink">Date ranges</Text>
                  <CalendarPicker ranges={dateRanges} onRangesChange={setDateRanges} />
                </>
              ) : (
                <View className="gap-3">
                  <Text className="text-sm font-medium text-ink">Duration options</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {DURATION_OPTIONS.map((dur) => (
                      <Pill
                        key={dur}
                        onPress={() => toggleDuration(dur)}
                        selected={selectedDurations.includes(dur)}
                      >
                        {dur}
                      </Pill>
                    ))}
                    {selectedDurations.filter((d) => !DURATION_OPTIONS.includes(d)).map((dur) => (
                      <Pill key={dur} selected onPress={() => toggleDuration(dur)}>
                        {`${dur}  ✕`}
                      </Pill>
                    ))}
                  </View>
                  <View className="flex-row items-center gap-2">
                    <TextInput
                      value={customDurationInput}
                      onChangeText={(t) => setCustomDurationInput(t.replace(/[^0-9]/g, ''))}
                      onSubmitEditing={addCustomDuration}
                      returnKeyType="done"
                      keyboardType="number-pad"
                      placeholder="e.g. 5"
                      maxLength={3}
                      className="w-20 min-h-[44px] rounded-2xl border border-line bg-card px-4 py-2 text-sm text-ink text-center"
                      placeholderTextColor="#A8A8A8"
                    />
                    {(['days', 'weeks', 'months'] as const).map((u) => (
                      <View key={u} style={{ flex: 1 }}>
                        <Pill
                          onPress={() => setCustomDurationUnit(u)}
                          selected={customDurationUnit === u}
                          size="sm"
                          accessibilityRole="radio"
                          accessibilityState={{ selected: customDurationUnit === u }}
                        >
                          {u}
                        </Pill>
                      </View>
                    ))}
                    <Pressable
                      onPress={addCustomDuration}
                      disabled={!customDurationInput.trim()}
                      className={['h-11 w-11 items-center justify-center rounded-full', customDurationInput.trim() ? 'bg-green' : 'bg-line'].join(' ')}
                      accessibilityRole="button"
                    >
                      <Ionicons name="add" size={22} color={customDurationInput.trim() ? 'white' : '#A8A8A8'} />
                    </Pressable>
                  </View>
                </View>
              )}
            </>
          )}

          {/* ── Budget ───────────────────────────────────────────────────── */}
          {poll.type === 'budget' && (
            <>
              <Input
                label="Question"
                value={budgetTitle}
                onChangeText={setBudgetTitle}
              />
              <Divider />
              <View className="gap-2">
                <Text className="text-sm font-medium text-ink">Budget tiers</Text>
                <Text className="text-xs text-muted -mt-1">Tap a label to rename · tap a number to change the boundary</Text>
                {budgetRanges.map((r, i) => {
                  const isLast = i === budgetRanges.length - 1;
                  return (
                    <View
                      key={r.id}
                      className={['flex-row items-center gap-2 rounded-xl border px-3 py-3', r.selected ? 'border-green bg-green-soft' : 'border-line bg-card'].join(' ')}
                    >
                      <Pressable onPress={() => toggleBudgetRange(r.id)} accessibilityRole="checkbox" accessibilityState={{ checked: r.selected }}>
                        <View className={['h-5 w-5 items-center justify-center rounded-md border-2', r.selected ? 'border-green bg-green' : 'border-line bg-card'].join(' ')}>
                          {r.selected ? <Ionicons name="checkmark" size={12} color="white" /> : null}
                        </View>
                      </Pressable>
                      <TextInput value={r.label} onChangeText={(v) => updateRangeLabel(r.id, v)} className="flex-1 text-sm text-ink" maxLength={40} />
                      {!isLast ? (
                        <View className="flex-row items-center gap-1">
                          <Text className="text-xs text-muted">Up to</Text>
                          <BoundaryInput value={r.max!} onCommit={(n) => updateBoundary(i, n)} />
                        </View>
                      ) : null}
                      {budgetRanges.length > 2 ? (
                        <Pressable onPress={() => removeBudgetTier(r.id)} accessibilityRole="button">
                          <Ionicons name="close-circle" size={20} color="#A8A8A8" />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
                {budgetRanges.length < 6 ? (
                  <Pressable onPress={addBudgetTier} className="flex-row items-center gap-2 py-2" accessibilityRole="button">
                    <Ionicons name="add-circle-outline" size={20} color="#0F3F2E" />
                    <Text className="text-base text-green">Add tier</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          )}

          {/* ── Custom ───────────────────────────────────────────────────── */}
          {poll.type === 'custom' && (
            <>
              <Input
                label="Question"
                value={customTitle}
                onChangeText={setCustomTitle}
                placeholder="e.g. What activities do you want?"
              />
              <Divider />
              <View className="gap-2">
                <Text className="text-sm font-medium text-ink">
                  Options <Text className="font-normal text-muted">({customOptions.length}/6)</Text>
                </Text>
                {customOptions.map((opt, i) => (
                  <View key={i} className="flex-row items-center gap-2">
                    <View style={{ flex: 1 }}>
                      <Input
                        value={opt}
                        onChangeText={(v) => updateCustomOption(i, v)}
                        placeholder={`Option ${i + 1}${i < 2 ? ' *' : ''}`}
                        maxLength={60}
                      />
                    </View>
                    {customOptions.length > 2 ? (
                      <Pressable onPress={() => removeCustomOption(i)} className="p-2" accessibilityRole="button">
                        <Ionicons name="close-circle" size={22} color="#A8A8A8" />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                {customOptions.length < 6 ? (
                  <Pressable onPress={addCustomOption} className="flex-row items-center gap-2 py-2" accessibilityRole="button">
                    <Ionicons name="add-circle-outline" size={20} color="#0F3F2E" />
                    <Text className="text-base text-green">Add option</Text>
                  </Pressable>
                ) : null}
              </View>
              <Divider />
              <View className="flex-row items-center justify-between">
                <View className="flex-1 gap-0.5">
                  <Text className="text-base font-medium text-ink">Allow multiple choices</Text>
                  <Text className="text-sm text-muted">Group members can select more than one</Text>
                </View>
                <Toggle value={customAllowMulti} onValueChange={setCustomAllowMulti} />
              </View>
            </>
          )}

          <Divider />

          {hasResponses ? (
            <View className="rounded-2xl bg-amber-50 px-4 py-3">
              <Text className="text-sm font-semibold text-amber-700">
                This poll has responses and can no longer be edited.
              </Text>
              <Text className="mt-1 text-xs text-amber-600">
                Close it or use "Clone" on the trip screen to start a fresh version.
              </Text>
            </View>
          ) : (
            <Button onPress={handleSave} loading={saving} fullWidth>
              Save changes
            </Button>
          )}

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
