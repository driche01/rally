import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Divider } from '@/components/ui';
import { useCreatePoll, usePolls, useUpdateCustomPoll } from '@/hooks/usePolls';
import { useTrip } from '@/hooks/useTrips';
import { capture, Events } from '@/lib/analytics';
import { getTripStage, STAGE_ACCENT } from '@/lib/tripStage';
import { DEFAULT_BUDGET_RANGES, generateRangeLabel, getMinForRange } from '@/lib/pollFormUtils';
import type { PollType } from '@/types/database';
import type { BudgetRange, CustomPoll, DateRange } from '@/types/polls';
import { BudgetSection } from '@/components/polls/BudgetSection';
import { CustomSection } from '@/components/polls/CustomSection';
import { DatesSection } from '@/components/polls/DatesSection';
import { DestinationSection } from '@/components/polls/DestinationSection';

// ── Types ──────────────────────────────────────────────────────────────────────

type TabType = PollType;

// ── Tab styles ─────────────────────────────────────────────────────────────────

const tabStyles = StyleSheet.create({
  base: {
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  inactive: { borderColor: '#E5E5E5', backgroundColor: '#FFFFFF' },
  taken:    { borderColor: '#E5E5E5', backgroundColor: '#F5F5F5' },
  textActive:   { fontSize: 14, fontWeight: '500', color: '#FFFFFF' },
  textInactive: { fontSize: 14, fontWeight: '500', color: '#525252' },
  textTaken:    { fontSize: 14, fontWeight: '500', color: '#A3A3A3' },
});

// ── Helpers ────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtShort(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Expand a date range into individual day option labels (one per day). */
function expandRangeToDayLabels(r: DateRange): string[] {
  const labels: string[] = [];
  const cur = new Date(r.start.getFullYear(), r.start.getMonth(), r.start.getDate());
  const end = new Date(r.end.getFullYear(), r.end.getMonth(), r.end.getDate());
  while (cur <= end) {
    labels.push(fmtShort(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return labels;
}

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function NewPollScreen() {
  const { id: tripId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: trip } = useTrip(tripId);
  const accentColor = STAGE_ACCENT[trip ? getTripStage(trip) : 'deciding'];
  const createPoll = useCreatePoll(tripId);
  const updateCustomPoll = useUpdateCustomPoll(tripId);

  // Fetch existing polls to know which types are already taken.
  const { data: existingPolls = [], isSuccess: pollsLoaded } = usePolls(tripId);
  const SINGLE_USE_TYPES: PollType[] = ['destination', 'dates', 'budget'];
  const takenTypes = new Set(
    existingPolls
      .filter((p) => (SINGLE_USE_TYPES as string[]).includes(p.type) && p.status !== 'closed')
      .map((p) => p.type)
  );
  const liveOrDecidedTypes = new Set(
    existingPolls
      .filter((p) => (SINGLE_USE_TYPES as string[]).includes(p.type) && (p.status === 'live' || p.status === 'decided'))
      .map((p) => p.type)
  );
  const activeCustomCount = existingPolls.filter(
    (p) => p.type === 'custom' && (p.status === 'live' || p.status === 'decided')
  ).length;
  const savedDraftCustomCount = existingPolls.filter(
    (p) => p.type === 'custom' && p.status === 'draft'
  ).length;
  const customTaken = activeCustomCount >= 3 && savedDraftCustomCount === 0;
  const totalCustomActive = activeCustomCount + savedDraftCustomCount;

  const [activeTab, setActiveTab] = useState<TabType>('destination');
  const [tabFontSize, setTabFontSize] = useState(14);

  const takenCount = takenTypes.size + (customTaken ? 1 : 0);
  const allTaken = takenTypes.size >= 3 && (totalCustomActive === 0 || customTaken);
  const allLiveOrDecided = liveOrDecidedTypes.size >= 3 && savedDraftCustomCount === 0;
  const showActions = !(takenTypes.size >= 3 && customTaken);

  useEffect(() => {
    const isCurrentTabTaken = takenTypes.has(activeTab) || (activeTab === 'custom' && customTaken);
    if (isCurrentTabTaken) {
      const first = (['destination', 'dates', 'budget', 'custom'] as TabType[]).find(
        (t) => !takenTypes.has(t) && !(t === 'custom' && customTaken)
      );
      if (first) setActiveTab(first);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takenCount]);

  // ── Destination state ──
  const [destTitle, setDestTitle] = useState('Where are we headed?');
  const [destOptions, setDestOptions] = useState(['', '']);
  const [destAllowMulti, setDestAllowMulti] = useState(false);

  // ── Dates state ──
  const [datesTitle, setDatesTitle] = useState('When can ya make it?');
  const [dateRanges, setDateRanges] = useState<DateRange[]>([]);
  const [durationTitle, setDurationTitle] = useState("How long's the trip?");
  const [selectedDurations, setSelectedDurations] = useState<string[]>([]);
  const [customDurationInput, setCustomDurationInput] = useState('');
  const [customDurationUnit, setCustomDurationUnit] = useState<'days' | 'weeks' | 'months'>('days');

  // ── Budget state ──
  const [budgetTitle, setBudgetTitle] = useState("What's the spend looking like?");
  const [budgetRanges, setBudgetRanges] = useState<BudgetRange[]>(DEFAULT_BUDGET_RANGES);

  // ── Custom polls state ──
  const [customPolls, setCustomPolls] = useState<CustomPoll[]>([
    { id: 'c0', question: '', options: ['', ''], allowMulti: false },
  ]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);

  // Populate custom polls form from existing DB polls on first load.
  useEffect(() => {
    if (draftsLoaded || !pollsLoaded) return;
    const existing = existingPolls.filter(
      (p) => p.type === 'custom' && p.status !== 'closed'
    );
    if (existing.length > 0) {
      setCustomPolls(
        existing.map((p) => ({
          id: p.id,
          pollId: p.id,
          status: p.status as 'draft' | 'live' | 'decided',
          question: p.title,
          options:
            p.poll_options.length >= 2
              ? p.poll_options.map((o) => o.label)
              : [...p.poll_options.map((o) => o.label), ...Array(2 - p.poll_options.length).fill('')],
          allowMulti: p.allow_multi_select,
        }))
      );
    }
    setDraftsLoaded(true);
  }, [pollsLoaded, draftsLoaded, existingPolls]);

  // ── Incomplete modal state ──
  const [showIncompleteModal, setShowIncompleteModal] = useState(false);
  const [incompleteSections, setIncompleteSections] = useState<string[]>([]);

  // ── Destination helpers ──
  function addDestOption() {
    if (destOptions.length >= 6) return;
    setDestOptions([...destOptions, '']);
  }
  function updateDestOption(i: number, v: string) {
    const u = [...destOptions];
    u[i] = v.slice(0, 40);
    setDestOptions(u);
  }
  function removeDestOption(i: number) {
    if (destOptions.length <= 2) return;
    setDestOptions(destOptions.filter((_, j) => j !== i));
  }

  // ── Duration helpers ──
  function toggleDuration(d: string) {
    setSelectedDurations((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
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
        const maxNext = next[i + 1].max;
        next[i + 1] = { ...next[i + 1], label: generateRangeLabel(newMax, maxNext) };
      }
      return next;
    });
  }
  function toggleBudgetRange(id: string) {
    setBudgetRanges((prev) =>
      prev.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r))
    );
  }
  function updateRangeLabel(id: string, label: string) {
    setBudgetRanges((prev) =>
      prev.map((r) => (r.id === id ? { ...r, label, labelOverridden: true } : r))
    );
  }
  function addBudgetTier() {
    setBudgetRanges((prev) => {
      if (prev.length >= 6) return prev;
      const secondToLast = prev[prev.length - 2];
      const lastMax = secondToLast?.max ?? 1000;
      const newMax = lastMax * 2;
      const newId = `b${Date.now()}`;
      const newTier: BudgetRange = {
        id: newId,
        label: generateRangeLabel(lastMax, newMax),
        max: newMax,
        selected: true,
        labelOverridden: false,
      };
      const next = [...prev.slice(0, -1), newTier, prev[prev.length - 1]];
      const lastIdx = next.length - 1;
      if (!next[lastIdx].labelOverridden) {
        next[lastIdx] = { ...next[lastIdx], label: generateRangeLabel(newMax, null) };
      }
      return next;
    });
  }
  function removeBudgetTier(id: string) {
    setBudgetRanges((prev) => {
      if (prev.length <= 2) return prev;
      const next = prev.filter((r) => r.id !== id);
      return next.map((r, i) => {
        if (r.labelOverridden) return r;
        const min = getMinForRange(i, next);
        return { ...r, label: generateRangeLabel(min, r.max) };
      });
    });
  }

  // ── Custom poll helpers ──
  function addCustomPoll() {
    if (customPolls.length >= 3) return;
    setCustomPolls((prev) => [
      ...prev,
      { id: `c${Date.now()}`, question: '', options: ['', ''], allowMulti: false },
    ]);
  }
  function removeCustomPoll(id: string) {
    setCustomPolls((prev) => {
      if (prev.length <= 1) return [{ id: 'c0', question: '', options: ['', ''], allowMulti: false }];
      return prev.filter((p) => p.id !== id);
    });
  }
  function updateCustomQuestion(id: string, question: string) {
    setCustomPolls((prev) => prev.map((p) => (p.id === id ? { ...p, question } : p)));
  }
  function addCustomOption(id: string) {
    setCustomPolls((prev) =>
      prev.map((p) => {
        if (p.id !== id || p.options.length >= 6) return p;
        return { ...p, options: [...p.options, ''] };
      })
    );
  }
  function updateCustomOption(id: string, optIdx: number, value: string) {
    setCustomPolls((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const options = [...p.options];
        options[optIdx] = value.slice(0, 60);
        return { ...p, options };
      })
    );
  }
  function removeCustomOption(id: string, optIdx: number) {
    setCustomPolls((prev) =>
      prev.map((p) => {
        if (p.id !== id || p.options.length <= 2) return p;
        return { ...p, options: p.options.filter((_, j) => j !== optIdx) };
      })
    );
  }
  function toggleCustomMulti(id: string) {
    setCustomPolls((prev) =>
      prev.map((p) => (p.id === id ? { ...p, allowMulti: !p.allowMulti } : p))
    );
  }

  // ── Section completion ──
  function isSectionComplete(tab: TabType): boolean {
    if (tab === 'destination') return destOptions.filter((o) => o.trim()).length >= 2;
    if (tab === 'dates') return dateRanges.length > 0 || selectedDurations.length > 0;
    if (tab === 'budget') return budgetRanges.filter((r) => r.selected).length >= 2;
    if (tab === 'custom')
      return customPolls.some(
        (p) => p.question.trim() && p.options.filter((o) => o.trim()).length >= 2
      );
    return false;
  }

  function getIncompleteSections(): string[] {
    const incomplete: TabType[] = (['destination', 'dates', 'budget'] as TabType[]).filter(
      (t) => !takenTypes.has(t) && !isSectionComplete(t)
    );
    const customStarted = customPolls.some(
      (p) => p.question.trim() || p.options.some((o) => o.trim())
    );
    if (customStarted && !isSectionComplete('custom')) incomplete.push('custom');
    return incomplete.map((t) => t.charAt(0).toUpperCase() + t.slice(1));
  }

  // ── Save all polls ──
  async function doSave(status: 'draft' | 'live') {
    const mutations: Promise<unknown>[] = [];

    const destOpts = destOptions
      .filter((o) => o.trim())
      .map((o, i) => ({ label: o.trim(), position: i }));
    if (!takenTypes.has('destination') && destOpts.length >= 2) {
      mutations.push(
        createPoll.mutateAsync({
          trip_id: tripId, type: 'destination', title: destTitle.trim(),
          status, allow_multi_select: destAllowMulti, position: 0, options: destOpts,
        })
      );
    }

    if (!takenTypes.has('dates') && dateRanges.length >= 1) {
      // Expand each date range into individual day options for per-day availability selection
      const dayLabels = dateRanges.flatMap(expandRangeToDayLabels);
      // Deduplicate in case ranges overlap
      const uniqueLabels = [...new Set(dayLabels)];
      mutations.push(
        createPoll.mutateAsync({
          trip_id: tripId, type: 'dates', title: datesTitle.trim(),
          status, allow_multi_select: true, position: 1,
          options: uniqueLabels.map((label, i) => ({ label, position: i })),
        })
      );
    }

    if (!takenTypes.has('dates') && selectedDurations.length >= 1) {
      mutations.push(
        createPoll.mutateAsync({
          trip_id: tripId, type: 'dates', title: durationTitle.trim(),
          status, allow_multi_select: false, position: 2,
          options: selectedDurations.map((d, i) => ({ label: d, position: i })),
        })
      );
    }

    const budgetOpts = budgetRanges
      .filter((r) => r.selected)
      .map((r, i) => ({ label: r.label, position: i }));
    if (!takenTypes.has('budget') && budgetOpts.length >= 2) {
      mutations.push(
        createPoll.mutateAsync({
          trip_id: tripId, type: 'budget', title: budgetTitle.trim(),
          status, allow_multi_select: false, position: 3, options: budgetOpts,
        })
      );
    }

    customPolls.forEach((cp, idx) => {
      if (cp.status === 'live' || cp.status === 'decided') return;
      const opts = cp.options
        .filter((o) => o.trim())
        .map((o, i) => ({ label: o.trim(), position: i }));
      if (cp.question.trim() && opts.length >= 2) {
        if (cp.pollId) {
          mutations.push(
            updateCustomPoll.mutateAsync({
              pollId: cp.pollId, title: cp.question.trim(),
              status, allow_multi_select: cp.allowMulti, options: opts,
            })
          );
        } else {
          mutations.push(
            createPoll.mutateAsync({
              trip_id: tripId, type: 'custom', title: cp.question.trim(),
              status, allow_multi_select: cp.allowMulti, position: 4 + idx, options: opts,
            })
          );
        }
      }
    });

    if (mutations.length === 0) {
      Alert.alert('Nothing to save', 'Fill in at least one section to save.');
      return;
    }

    try {
      await Promise.all(mutations);
      capture(Events.POLL_CREATED, { trip_id: tripId, status, poll_count: mutations.length });
      router.back();
    } catch {
      Alert.alert('Error', 'Could not create polls. Try again.');
    }
  }

  async function handleSave(status: 'draft' | 'live') {
    if (status === 'live') {
      const incomplete = getIncompleteSections();
      if (incomplete.length > 0) {
        setIncompleteSections(incomplete);
        setShowIncompleteModal(true);
        return;
      }
      Alert.alert(
        'Ready to send it?',
        'Once the crew responds, polls can no longer be edited — only closed or cloned.',
        [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Send it!', onPress: () => doSave('live') },
        ]
      );
    } else {
      doSave('draft');
    }
  }

  const tabs: TabType[] = ['destination', 'dates', 'budget', 'custom'];

  return (
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
          <Text className="text-base" style={{ color: accentColor }}>{allTaken ? 'Back' : 'Cancel'}</Text>
        </TouchableOpacity>
        <Text className="text-lg font-semibold text-ink">Add poll</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 24, paddingBottom: 16 }}>
        {tabs.map((tab) => {
          const active = activeTab === tab;
          const isTaken =
            ((SINGLE_USE_TYPES as string[]).includes(tab) && takenTypes.has(tab)) ||
            (tab === 'custom' && customTaken);
          const label =
            tab === 'destination' ? 'Destination'
            : tab === 'dates' ? 'Dates'
            : tab === 'budget' ? 'Budget'
            : 'Custom';
          return (
            <TouchableOpacity
              key={tab}
              onPress={() => { if (!isTaken) setActiveTab(tab); }}
              activeOpacity={isTaken ? 1 : 0.85}
              disabled={isTaken}
              style={[
                tabStyles.base,
                isTaken ? tabStyles.taken : (active ? { borderColor: accentColor, backgroundColor: accentColor } : tabStyles.inactive),
                { flex: 1, alignItems: 'center' },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active, disabled: isTaken }}
              accessibilityLabel={isTaken ? `${label}, already added` : label}
            >
              <Text
                style={[
                  isTaken ? tabStyles.textTaken : (active ? tabStyles.textActive : tabStyles.textInactive),
                  { fontSize: tabFontSize },
                ]}
                onTextLayout={(e) => {
                  if (e.nativeEvent.lines.length > 1) {
                    setTabFontSize((prev) => Math.max(8, prev - 1));
                  }
                }}
              >
                {isTaken ? `✓ ${label}` : label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-5">

          {/* ── All polls complete — celebratory ── */}
          {allTaken && allLiveOrDecided && (
            <View className="items-center py-16 gap-5">
              <View className="items-center justify-center" style={{ width: 120, height: 120 }}>
                <View className="absolute rounded-full bg-green-soft" style={{ width: 120, height: 120, opacity: 0.5 }} />
                <View className="absolute rounded-full bg-coral-200" style={{ width: 88, height: 88, opacity: 0.6 }} />
                <View className="items-center justify-center rounded-full bg-green" style={{ width: 64, height: 64 }}>
                  <Ionicons name="airplane" size={30} color="white" />
                </View>
              </View>
              <View className="items-center gap-2">
                <Text className="text-2xl font-bold text-ink">Almost rallied!</Text>
                <Text className="text-sm font-semibold text-green">All polls are live or decided</Text>
                <Text className="text-sm text-center text-muted px-6" style={{ lineHeight: 20 }}>
                  Your group is voting — once results are in, lock in the trip!
                </Text>
              </View>
            </View>
          )}

          {/* ── All polls complete — drafted ── */}
          {allTaken && !allLiveOrDecided && (
            <View className="items-center py-16 gap-5">
              <View className="items-center justify-center" style={{ width: 120, height: 120 }}>
                <View className="absolute rounded-full bg-cream-warm" style={{ width: 120, height: 120, opacity: 0.6 }} />
                <View className="absolute rounded-full bg-neutral-200" style={{ width: 88, height: 88, opacity: 0.7 }} />
                <View className="items-center justify-center rounded-full bg-neutral-400" style={{ width: 64, height: 64 }}>
                  <Ionicons name="document-text" size={28} color="white" />
                </View>
              </View>
              <View className="items-center gap-2">
                <Text className="text-2xl font-bold text-ink">All polls drafted</Text>
                <Text className="text-sm font-semibold text-muted">Ready to go live</Text>
                <Text className="text-sm text-center text-muted px-6" style={{ lineHeight: 20 }}>
                  Head back and go live to start getting your group's votes.
                </Text>
              </View>
            </View>
          )}

          {/* ── Already-taken placeholder ── */}
          {!allTaken && activeTab !== 'custom' && takenTypes.has(activeTab) && (
            <View className="items-center py-16 gap-3">
              <Ionicons name="checkmark-circle" size={48} color="#D1D5DB" />
              <Text className="text-base font-semibold text-muted">
                {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} poll already added
              </Text>
              <Text className="text-sm text-center text-muted px-4">
                Edit or replace it from the polls screen.
              </Text>
            </View>
          )}

          {/* ── Destination tab ── */}
          {activeTab === 'destination' && !takenTypes.has('destination') && (
            <DestinationSection
              title={destTitle}
              onTitleChange={setDestTitle}
              options={destOptions}
              onOptionChange={updateDestOption}
              onOptionRemove={removeDestOption}
              onOptionAdd={addDestOption}
              allowMulti={destAllowMulti}
              onAllowMultiChange={setDestAllowMulti}
              accentColor={accentColor}
            />
          )}

          {/* ── Dates tab ── */}
          {activeTab === 'dates' && !takenTypes.has('dates') && (
            <DatesSection
              datesTitle={datesTitle}
              onDatesTitleChange={setDatesTitle}
              dateRanges={dateRanges}
              onDateRangesChange={setDateRanges}
              durationTitle={durationTitle}
              onDurationTitleChange={setDurationTitle}
              selectedDurations={selectedDurations}
              onDurationToggle={toggleDuration}
              customDurationInput={customDurationInput}
              onCustomDurationInputChange={setCustomDurationInput}
              customDurationUnit={customDurationUnit}
              onCustomDurationUnitChange={setCustomDurationUnit}
              onCustomDurationAdd={addCustomDuration}
              accentColor={accentColor}
            />
          )}

          {/* ── Budget tab ── */}
          {activeTab === 'budget' && !takenTypes.has('budget') && (
            <BudgetSection
              title={budgetTitle}
              onTitleChange={setBudgetTitle}
              budgetRanges={budgetRanges}
              onToggle={toggleBudgetRange}
              onBoundaryUpdate={updateBoundary}
              onLabelUpdate={updateRangeLabel}
              onTierAdd={addBudgetTier}
              onTierRemove={removeBudgetTier}
              accentColor={accentColor}
            />
          )}

          {/* ── Custom tab ── */}
          {activeTab === 'custom' && (
            <CustomSection
              customPolls={customPolls}
              onPollAdd={addCustomPoll}
              onPollRemove={removeCustomPoll}
              onQuestionChange={updateCustomQuestion}
              onOptionAdd={addCustomOption}
              onOptionChange={updateCustomOption}
              onOptionRemove={removeCustomOption}
              onMultiToggle={toggleCustomMulti}
              accentColor={accentColor}
            />
          )}

          {showActions && <Divider />}

          {/* Actions */}
          {showActions && (
            <View className="flex-row gap-3">
              <Button
                variant="secondary"
                onPress={() => handleSave('draft')}
                loading={createPoll.isPending || updateCustomPoll.isPending}
                className="flex-1"
              >
                Save as draft
              </Button>
              <Pressable
                onPress={() => handleSave('live')}
                disabled={createPoll.isPending || updateCustomPoll.isPending}
                className="flex-1 items-center justify-center rounded-2xl min-h-[48px] px-6 py-3"
                style={{ backgroundColor: accentColor, opacity: (createPoll.isPending || updateCustomPoll.isPending) ? 0.5 : 1 }}
              >
                <Text className="text-base font-semibold text-white">Send it!</Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Incomplete sections modal ── */}
      <Modal
        visible={showIncompleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowIncompleteModal(false)}
      >
        <View
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
        >
          <View className="mx-6 rounded-2xl bg-card p-6">
            <Text className="mb-2 text-lg font-bold text-ink">
              Not quite done, mate
            </Text>
            <Text className="mb-4 text-sm text-muted">
              These sections still need filling in:
            </Text>
            {incompleteSections.map((s) => (
              <View key={s} className="mb-1.5 flex-row items-center gap-2">
                <Ionicons name="alert-circle-outline" size={16} color="#0F3F2E" />
                <Text className="text-base text-ink">{s}</Text>
              </View>
            ))}
            <Text className="mt-4 text-sm text-muted">
              Only the completed ones will go live. Send it anyway?
            </Text>
            <View className="mt-5 flex-row gap-3">
              <Pressable
                onPress={() => setShowIncompleteModal(false)}
                className="flex-1 items-center rounded-xl border border-line bg-card py-3"
              >
                <Text className="text-base font-medium text-ink">Go back</Text>
              </Pressable>
              <Pressable
                onPress={() => { setShowIncompleteModal(false); doSave('live'); }}
                className="flex-1 items-center rounded-xl py-3"
                style={{ backgroundColor: accentColor }}
              >
                <Text className="text-base font-semibold text-white">Send it anyway</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
