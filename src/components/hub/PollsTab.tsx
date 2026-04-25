/**
 * PollsTab — renders the existing Phase 1 polls experience inside the hub.
 * Reuses the poll logic from the original trip detail screen.
 */
import { useRouter } from 'expo-router';
import { memo } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card, Badge, Button, useCelebration } from '@/components/ui';
import { usePolls, useUpdatePollStatus, useDecidePoll, useUndecidePoll, useDeletePoll, useDuplicatePoll } from '@/hooks/usePolls';
import { useRespondents } from '@/hooks/useRespondents';
import { useResponseCounts } from '@/hooks/useResponseCounts';
import { useTrip } from '@/hooks/useTrips';
import { getTripStage, STAGE_ACCENT } from '@/lib/tripStage';
import { getParticipationRate, type PollWithOptions, type GroupSizeBucket } from '@/types/database';
import { useState, useMemo, useCallback } from 'react';
import { capture, Events } from '@/lib/analytics';
import { parseDateRangeLabel } from '@/lib/pollFormUtils';

// ─── Per-day poll detection ───────────────────────────────────────────────────

function isPerDayPoll(poll: PollWithOptions): boolean {
  if (poll.poll_options.length === 0) return false;
  return poll.poll_options.every((opt) => {
    const r = parseDateRangeLabel(opt.label);
    if (!r) return false;
    return r.start.getFullYear() === r.end.getFullYear() &&
      r.start.getMonth() === r.end.getMonth() &&
      r.start.getDate() === r.end.getDate();
  });
}

// ─── Calendar heatmap for per-day polls (planner view) ───────────────────────

function PollCalendarView({
  poll,
  counts,
  onDecide,
}: {
  poll: PollWithOptions;
  counts: Record<string, number>;
  onDecide: (optionId: string, label: string) => void;
}) {
  const parsedOptions = poll.poll_options
    .map((opt) => ({ ...opt, range: parseDateRangeLabel(opt.label)! }))
    .filter((opt) => opt.range != null);

  const allDates = parsedOptions.map((o) => o.range.start);
  const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));
  const maxVotes = Math.max(...parsedOptions.map((o) => counts[o.id] ?? 0), 1);

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

  const canGoPrev = viewYear > minDate.getFullYear() || (viewYear === minDate.getFullYear() && viewMonth > minDate.getMonth());
  const canGoNext = viewYear < maxDate.getFullYear() || (viewYear === maxDate.getFullYear() && viewMonth < maxDate.getMonth());
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const canDecide = ['live', 'closed', 'decided'].includes(poll.status);

  return (
    <View>
      {/* Month navigation */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Pressable
          onPress={() => { const d = new Date(viewYear, viewMonth - 1, 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }}
          disabled={!canGoPrev}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={18} color={canGoPrev ? '#6B7280' : '#D1D5DB'} />
        </Pressable>
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151' }}>{monthLabel}</Text>
        <Pressable
          onPress={() => { const d = new Date(viewYear, viewMonth + 1, 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }}
          disabled={!canGoNext}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-forward" size={18} color={canGoNext ? '#6B7280' : '#D1D5DB'} />
        </Pressable>
      </View>

      {/* Day headers */}
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <Text key={d} style={{ flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '500', color: '#9CA3AF' }}>{d}</Text>
        ))}
      </View>

      {/* Calendar grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((date, i) => {
          if (!date) return <View key={`e-${i}`} style={{ width: `${100 / 7}%` as any, aspectRatio: 1 }} />;
          const opt = getOptionForDate(date);
          const isInRange = opt !== undefined;
          const votes = opt ? (counts[opt.id] ?? 0) : 0;
          const isDecided = opt ? poll.decided_option_id === opt.id : false;
          const intensity = isInRange && maxVotes > 0 ? votes / maxVotes : 0;
          const r = Math.round(255 - intensity * (255 - 216));
          const g = Math.round(240 - intensity * (240 - 90));
          const b = Math.round(238 - intensity * (238 - 48));
          const bgColor = isDecided ? '#D85A30' : isInRange ? (votes > 0 ? `rgb(${r},${g},${b})` : '#F5F5F4') : 'transparent';
          const textColor = isDecided ? '#FFFFFF' : isInRange ? (intensity > 0.5 ? '#FFFFFF' : '#6B7280') : '#D1D5DB';

          return (
            <Pressable
              key={date.toISOString()}
              onPress={isInRange && canDecide && opt ? () => onDecide(opt.id, opt.label) : undefined}
              disabled={!isInRange || !canDecide}
              style={{ width: `${100 / 7}%` as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}
            >
              <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: bgColor }}>
                {isDecided ? (
                  <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                ) : (
                  <Text style={{ fontSize: 12, fontWeight: isInRange ? '600' : '400', color: textColor }}>
                    {date.getDate()}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Legend */}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#F5F5F4' }} />
          <Text style={{ fontSize: 11, color: '#9CA3AF' }}>No votes</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#D85A30' }} />
          <Text style={{ fontSize: 11, color: '#9CA3AF' }}>Popular</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#D85A30' }} />
          <Text style={{ fontSize: 11, color: '#9CA3AF' }}>Decided</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Re-use PollResultBar from the existing screen ───────────────────────────

function PollResultBar({
  label,
  votes,
  total,
  isLeading,
  isDecided,
}: {
  label: string;
  votes: number;
  total: number;
  isLeading: boolean;
  isDecided: boolean;
}) {
  const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between">
        <Text
          className={[
            'flex-1 text-sm',
            isLeading || isDecided ? 'font-semibold text-neutral-800' : 'text-neutral-600',
          ].join(' ')}
          numberOfLines={1}
        >
          {label}{isDecided ? '  ✓' : ''}
        </Text>
        <Text className="ml-2 text-sm text-neutral-400">
          {votes} vote{votes !== 1 ? 's' : ''}
        </Text>
      </View>
      <View className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <View
          className={['h-full rounded-full', isLeading || isDecided ? 'bg-green' : 'bg-neutral-300'].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </View>
    </View>
  );
}

const PollCard = memo(function PollCard({
  poll,
  tripId,
  counts,
  groupSizeBucket,
  groupSizePrecise,
  router,
  onDecide,
}: {
  poll: PollWithOptions;
  tripId: string;
  counts: Record<string, number>;
  groupSizeBucket?: GroupSizeBucket;
  groupSizePrecise?: number | null;
  router: ReturnType<typeof useRouter>;
  onDecide?: () => void;
}) {
  const updateStatus = useUpdatePollStatus(tripId);
  const decide = useDecidePoll(tripId);
  const undecide = useUndecidePoll(tripId);
  const deletePoll = useDeletePoll(tripId);
  const duplicate = useDuplicatePoll(tripId);

  const totalVotes = Object.values(counts).reduce((s, n) => s + n, 0);
  const hasResponses = totalVotes > 0;
  const leadingOptionId =
    totalVotes > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] : null;
  const showCalendar = isPerDayPoll(poll);

  const statusBadge: Record<string, 'muted' | 'success' | 'default' | 'coral'> = {
    draft: 'muted', live: 'success', closed: 'default', decided: 'coral',
  };

  const mutationError = useCallback(
    (action: string) => () => Alert.alert('Error', `Could not ${action}. Please try again.`),
    []
  );

  const isEditable = poll.status === 'draft' || (poll.status === 'live' && !hasResponses);
  const showCopy = hasResponses || poll.status === 'closed' || poll.status === 'decided';
  const decidedLabel = poll.decided_option_id
    ? poll.poll_options.find((o) => o.id === poll.decided_option_id)?.label
    : null;

  function handleDecide(optionId: string, label: string) {
    if (poll.decided_option_id === optionId) return;
    const isChanging = poll.status === 'decided';
    Alert.alert(
      isChanging ? `Change decision to "${label}"?` : `Lock in "${label}"?`,
      isChanging ? 'This will replace the current decision.' : 'This marks the poll as decided.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isChanging ? 'Change' : 'Decide',
          onPress: () => {
            decide.mutate({ pollId: poll.id, optionId }, {
              onError: mutationError('save decision'),
              onSuccess: () => onDecide?.(),
            });
            capture(Events.POLL_DECIDED, { poll_type: poll.type, trip_id: tripId });
          },
        },
      ]
    );
  }

  return (
    <Card className="mb-3">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-1.5">
          <Text className="text-base font-semibold text-neutral-800">{poll.title}</Text>
          <Badge variant={statusBadge[poll.status] ?? 'default'}>
            {poll.status.charAt(0).toUpperCase() + poll.status.slice(1)}
          </Badge>
        </View>
        <View className="flex-row items-center gap-2">
          {isEditable && (
            <Pressable
              onPress={() => router.push(`/(app)/trips/${tripId}/polls/${poll.id}/edit`)}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5"
            >
              <Text className="text-xs font-medium text-neutral-600">Edit</Text>
            </Pressable>
          )}
          {poll.status === 'draft' && (
            <Pressable
              onPress={() => Alert.alert('Go live?', 'Once live with responses it cannot be edited.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Go live', onPress: () => updateStatus.mutate({ pollId: poll.id, status: 'live' }, { onError: mutationError('go live') }) },
              ])}
              className="rounded-xl bg-green px-3 py-1.5"
            >
              <Text className="text-xs font-semibold text-white">Go live</Text>
            </Pressable>
          )}
          {poll.status === 'live' && (
            <Pressable
              onPress={() => updateStatus.mutate({ pollId: poll.id, status: 'closed' }, { onSuccess: () => capture(Events.POLL_CLOSED, { poll_type: poll.type, trip_id: tripId }), onError: mutationError('close poll') })}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5"
            >
              <Text className="text-xs font-medium text-neutral-600">Close</Text>
            </Pressable>
          )}
          {poll.status === 'decided' && (
            <Pressable
              onPress={() => undecide.mutate(poll.id, { onError: mutationError('undo decision') })}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5"
            >
              <Text className="text-xs font-medium text-neutral-600">Undo</Text>
            </Pressable>
          )}
          {showCopy && (
            <Pressable
              onPress={() => Alert.alert('Clone poll?', 'Creates a new draft.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Clone', onPress: () => duplicate.mutate(poll.id, { onError: mutationError('clone poll') }) },
              ])}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5"
            >
              <Text className="text-xs font-medium text-neutral-600">Clone</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => Alert.alert('Delete this poll?', 'This cannot be undone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => deletePoll.mutate(poll.id, { onError: mutationError('delete poll') }) },
            ])}
            className="p-1"
          >
            <Ionicons name="trash-outline" size={16} color="#A8A8A8" />
          </Pressable>
        </View>
      </View>

      {poll.status === 'decided' && decidedLabel ? (
        <View className="mt-3 rounded-xl bg-gold/40 px-3 py-2.5">
          <Text className="text-sm font-semibold text-ink">✓ Decided: {decidedLabel}</Text>
        </View>
      ) : null}

      {poll.poll_options.length > 0 ? (
        <View className="mt-4 gap-3">
          {showCalendar ? (
            <PollCalendarView
              poll={poll}
              counts={counts}
              onDecide={handleDecide}
            />
          ) : (
            poll.poll_options.map((opt) => {
              const canDecide = ['live', 'closed', 'decided'].includes(poll.status);
              return (
                <Pressable
                  key={opt.id}
                  onPress={canDecide ? () => handleDecide(opt.id, opt.label) : undefined}
                  disabled={!canDecide}
                >
                  <PollResultBar
                    label={opt.label}
                    votes={counts[opt.id] ?? 0}
                    total={totalVotes}
                    isLeading={leadingOptionId === opt.id}
                    isDecided={poll.decided_option_id === opt.id}
                  />
                </Pressable>
              );
            })
          )}
          {poll.status !== 'draft' ? (
            <Text className="mt-1 text-xs text-neutral-400">
              {(() => {
                const p = groupSizeBucket ? getParticipationRate(totalVotes, groupSizeBucket, groupSizePrecise) : null;
                if (p) return `${p.count} of ${p.total} responded${['live', 'closed'].includes(poll.status) ? '  ·  Tap an option to decide.' : poll.status === 'decided' ? '  ·  Tap to change.' : ''}`;
                return `${totalVotes} response${totalVotes !== 1 ? 's' : ''}`;
              })()}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
});

export function PollsTab({ tripId, isPlanner = true }: { tripId: string; isPlanner?: boolean }) {
  const router = useRouter();
  const { data: trip } = useTrip(tripId);
  const accentColor = STAGE_ACCENT[trip ? getTripStage(trip) : 'deciding'];
  const { data: polls = [], refetch: refetchPolls } = usePolls(tripId);
  const { data: responseCounts = {}, refetch: refetchCounts } = useResponseCounts(tripId);
  const [refreshing, setRefreshing] = useState(false);
  const [sortNewest, setSortNewest] = useState(true);
  const { celebrate, CelebrationOverlay } = useCelebration();

  const sortedPolls = useMemo(
    () => [...polls].sort((a, b) => {
      const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return sortNewest ? diff : -diff;
    }),
    [polls, sortNewest]
  );

  async function handleRefresh() {
    setRefreshing(true);
    try { await Promise.all([refetchPolls(), refetchCounts()]); }
    finally { setRefreshing(false); }
  }

  const livePolls = useMemo(() => sortedPolls.filter((p) => p.status === 'live'), [sortedPolls]);
  const draftPolls = useMemo(() => sortedPolls.filter((p) => p.status === 'draft'), [sortedPolls]);
  const closedPolls = useMemo(() => sortedPolls.filter((p) => p.status === 'closed'), [sortedPolls]);
  const decidedPolls = useMemo(() => sortedPolls.filter((p) => p.status === 'decided'), [sortedPolls]);

  return (
    <View style={{ flex: 1 }}>
    {CelebrationOverlay}
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16 }}
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={accentColor} />
      }
    >
      <View className="flex-row items-center justify-between pt-4 pb-2">
        <Text className="text-base font-bold text-neutral-800">Polls</Text>
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={() => setSortNewest((p) => !p)}
            className="flex-row items-center gap-1"
          >
            <Ionicons name={sortNewest ? 'arrow-down' : 'arrow-up'} size={13} color="#A8A8A8" />
            <Text className="text-xs text-neutral-400">{sortNewest ? 'Newest' : 'Oldest'}</Text>
          </Pressable>
          {isPlanner ? (
            <Pressable
              onPress={() => router.push(`/(app)/trips/${tripId}/polls/new`)}
              className="flex-row items-center gap-1 rounded-xl px-3 py-1.5"
              style={{ backgroundColor: accentColor }}
            >
              <Ionicons name="add" size={14} color="white" />
              <Text className="text-xs font-semibold text-white">Add poll</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {polls.length === 0 ? (
        <View className="mt-8 items-center gap-3">
          <Text className="text-base font-semibold text-neutral-800">No polls yet</Text>
          <Text className="text-center text-sm text-neutral-400">
            Add a poll to ask your group about destinations, dates, or budget.
          </Text>
          {isPlanner ? (
            <Button onPress={() => router.push(`/(app)/trips/${tripId}/polls/new`)} className="mt-2">
              Add first poll
            </Button>
          ) : null}
        </View>
      ) : null}

      {[
        { label: 'Live', color: 'text-green-600', polls: livePolls },
        { label: 'Draft', color: 'text-neutral-500', polls: draftPolls },
        { label: 'Closed', color: 'text-neutral-700', polls: closedPolls },
      ].map(({ label, color, polls: group }) =>
        group.length > 0 ? (
          <View key={label} className="mb-1">
            <Text className={`mb-2 text-xs font-semibold uppercase tracking-wider ${color}`}>
              {label}
            </Text>
            {group.map((poll) => (
              <PollCard
                key={poll.id}
                poll={poll}
                tripId={tripId}
                counts={responseCounts[poll.id] ?? {}}
                groupSizeBucket={trip?.group_size_bucket}
                groupSizePrecise={trip?.group_size_precise}
                router={router}
                onDecide={celebrate}
              />
            ))}
          </View>
        ) : null
      )}

      {decidedPolls.length > 0 ? (
        <View className="mt-2">
          <View className="mb-2 flex-row items-center gap-2">
            <View className="h-px flex-1 bg-neutral-200" />
            <Text className="text-xs font-semibold uppercase tracking-wider" style={{ color: accentColor }}>Decided</Text>
            <View className="h-px flex-1 bg-neutral-200" />
          </View>
          {decidedPolls.map((poll) => (
            <PollCard
              key={poll.id}
              poll={poll}
              tripId={tripId}
              counts={responseCounts[poll.id] ?? {}}
              groupSizeBucket={trip?.group_size_bucket}
              groupSizePrecise={trip?.group_size_precise}
              router={router}
              onDecide={celebrate}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
    </View>
  );
}
