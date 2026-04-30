/**
 * AggregateResultsCard — live vote totals across every poll on the trip.
 *
 * Section 4 of the gap report — aggregate live results on the planner
 * dashboard. Renders a compact horizontal bar chart per poll. Decided
 * polls show their lock; live polls show ranked options + counts.
 *
 * Stays under the decision queue + cadence cards because it's
 * informational, not an action surface.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { getPollsForTrip } from '@/lib/api/polls';
import {
  getResponseCountsForTrip,
  getNumericResponseCountsForTrip,
  getRespondentCountsForTrip,
} from '@/lib/api/responses';
import {
  comparePollsByFormOrder,
  DURATION_POLL_TITLE,
  parseDateRangeLabel,
} from '@/lib/pollFormUtils';
import { DateHeatmap } from './DateHeatmap';
import type { PollOption, PollWithOptions } from '@/types/database';

interface Props {
  tripId: string;
}

const POLL_TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  destination: 'location-outline',
  dates: 'calendar-outline',
  budget: 'cash-outline',
  custom: 'help-circle-outline',
};

export function AggregateResultsCard({ tripId }: Props) {
  const { data: polls = [] } = useQuery<PollWithOptions[]>({
    queryKey: ['polls', tripId, 'aggregate'],
    queryFn: () => getPollsForTrip(tripId),
    enabled: Boolean(tripId),
    refetchOnWindowFocus: true,
    // Polls themselves change infrequently (planner-driven). Counts below
    // are the hot path that needs to feel live.
    refetchInterval: 30_000,
  });

  const { data: counts = {} } = useQuery<Record<string, Record<string, number>>>({
    queryKey: ['poll_counts', tripId],
    queryFn: () => getResponseCountsForTrip(tripId),
    enabled: Boolean(tripId),
    refetchOnWindowFocus: true,
    // Tight polling so votes appear within ~5s of submission. Each fetch
    // is two cheap queries; OK for a planner-side dashboard. If we ever
    // need true real-time we'll switch to a Supabase Realtime subscription
    // on poll_responses.
    refetchInterval: 5_000,
  });

  // Free-form numeric counts (currently only the duration poll). Same
  // refetch cadence as the option counts so both feel live together.
  const { data: numericCounts = {} } = useQuery<Record<string, Record<number, number>>>({
    queryKey: ['poll_numeric_counts', tripId],
    queryFn: () => getNumericResponseCountsForTrip(tripId),
    enabled: Boolean(tripId),
    refetchOnWindowFocus: true,
    refetchInterval: 5_000,
  });

  // Distinct-respondent counts: people-not-votes. Used for the header
  // total and the per-poll badge so multi-select polls (dates,
  // destination) don't inflate the headline number.
  const { data: respondentCounts = { totalRespondents: 0, perPoll: {} } } = useQuery<{
    totalRespondents: number;
    perPoll: Record<string, number>;
  }>({
    queryKey: ['poll_respondent_counts', tripId],
    queryFn: () => getRespondentCountsForTrip(tripId),
    enabled: Boolean(tripId),
    refetchOnWindowFocus: true,
    refetchInterval: 5_000,
  });

  // Sort to match the order fields appear on the new-trip form. Default
  // poll `position` is insertion order (live first, decided appended via
  // syncTripFieldsToPolls), which doesn't reflect the form layout.
  const visiblePolls = useMemo(
    () =>
      polls
        .filter((p) => p.status === 'live' || p.status === 'decided')
        .slice()
        .sort(comparePollsByFormOrder),
    [polls],
  );

  const totalResponses = respondentCounts.totalRespondents;

  if (!tripId || visiblePolls.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="bar-chart-outline" size={16} color="#163026" />
        <Text style={styles.title}>Live results</Text>
        {totalResponses > 0 ? (
          <Text style={styles.totalCount}>· {totalResponses} {totalResponses === 1 ? 'respondent' : 'respondents'}</Text>
        ) : null}
      </View>

      {visiblePolls.map((poll) => (
        <PollBars
          key={poll.id}
          poll={poll}
          counts={counts[poll.id] ?? {}}
          numericCounts={numericCounts[poll.id] ?? {}}
          pollRespondents={respondentCounts.perPoll[poll.id] ?? 0}
        />
      ))}
    </View>
  );
}

interface PollBarsProps {
  poll: PollWithOptions;
  counts: Record<string, number>;
  numericCounts?: Record<number, number>;
  /** Distinct people who responded to this poll (not raw vote count).
   *  Drives the per-poll badge ("· 5 voters") and the percent denominator
   *  for option bars so multi-select polls don't produce nonsense %s. */
  pollRespondents: number;
}

function PollBars({ poll, counts, numericCounts = {}, pollRespondents }: PollBarsProps) {
  const [userOpen, setUserOpen] = useState(false);
  const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
  const numericTotal = Object.values(numericCounts).reduce((a, b) => a + b, 0);
  const maxVotes = Math.max(1, ...Object.values(counts));
  const ranked = useMemo(
    () =>
      [...poll.poll_options]
        .map((opt) => ({ opt, votes: counts[opt.id] ?? 0 }))
        .sort((a, b) => b.votes - a.votes || a.opt.position - b.opt.position),
    [poll.poll_options, counts],
  );

  // Free-form duration poll: planner provided no preset chips, so
  // respondents submit numeric night counts. Render those as a small
  // sorted histogram instead of the option-bar list.
  const isFreeFormDuration =
    poll.type === 'custom' &&
    poll.title === DURATION_POLL_TITLE &&
    poll.poll_options.length === 0;

  const numericRanked = useMemo(() => {
    return Object.entries(numericCounts)
      .map(([nights, votes]) => ({ nights: Number(nights), votes }))
      .sort((a, b) => b.votes - a.votes || a.nights - b.nights);
  }, [numericCounts]);
  const maxNumericVotes = Math.max(1, ...Object.values(numericCounts));

  const isDecided = poll.status === 'decided';
  const decidedId = poll.decided_option_id;
  // Locked polls are always expanded — collapsing them would hide
  // the planner-locked answer that's the whole point of the row.
  const open = isDecided || userOpen;

  // Detect per-day dates polls — every option label parses to a single
  // day. When that's true, render a heat map instead of bars (bars are
  // useless when there are 16+ thin one-vote-each lines).
  const isPerDayDates = useMemo(() => {
    if (poll.type !== 'dates' || poll.poll_options.length === 0) return false;
    return poll.poll_options.every((o) => {
      const r = parseDateRangeLabel(o.label);
      if (!r) return false;
      return r.start.getFullYear() === r.end.getFullYear()
        && r.start.getMonth() === r.end.getMonth()
        && r.start.getDate() === r.end.getDate();
    });
  }, [poll.type, poll.poll_options]);

  return (
    <View style={styles.pollBlock}>
      <Pressable
        onPress={isDecided ? undefined : () => setUserOpen((v) => !v)}
        style={styles.pollHeader}
        accessibilityRole={isDecided ? 'text' : 'button'}
        accessibilityState={isDecided ? undefined : { expanded: userOpen }}
        accessibilityLabel={isDecided ? poll.title : (userOpen ? `Collapse ${poll.title}` : `Expand ${poll.title}`)}
      >
        <Ionicons name={POLL_TYPE_ICON[poll.type] ?? 'help-circle-outline'} size={13} color="#5F685F" />
        <Text style={styles.pollTitle} numberOfLines={1}>
          {poll.title}
        </Text>
        {isDecided ? (
          <View style={styles.lockedPill}>
            <Text style={styles.lockedPillText}>Locked</Text>
          </View>
        ) : pollRespondents > 0 ? (
          <Text style={styles.totalCount}>· {pollRespondents} {pollRespondents === 1 ? 'voter' : 'voters'}</Text>
        ) : null}
        {/* Chevron only when collapsible — locked polls always expanded. */}
        {isDecided ? null : (
          <Ionicons name={userOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#5F685F" />
        )}
      </Pressable>

      {!open ? null : isFreeFormDuration ? (
        numericTotal === 0 ? (
          <Text style={styles.emptyHint}>No responses yet</Text>
        ) : (
          numericRanked.slice(0, 8).map(({ nights, votes }) => {
            const pct = (votes / numericTotal) * 100;
            const widthPct = (votes / maxNumericVotes) * 100;
            const isWinner = votes === maxNumericVotes && votes > 0;
            return (
              <View key={nights} style={styles.optionRow}>
                <View style={styles.optionLabelRow}>
                  <Text
                    style={[styles.optionLabel, isWinner && styles.optionLabelWinner]}
                    numberOfLines={1}
                  >
                    {nights} {nights === 1 ? 'night' : 'nights'}
                  </Text>
                  <Text style={styles.optionCount}>
                    {votes} · {Math.round(pct)}%
                  </Text>
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${widthPct}%` },
                      isWinner && styles.barFillWinner,
                    ]}
                  />
                </View>
              </View>
            );
          })
        )
      ) : isPerDayDates ? (
        <DateHeatmap options={poll.poll_options} counts={counts} />
      ) : totalVotes === 0 && isDecided && decidedId ? (
        // Planner locked the poll without votes — show the winner directly
        // instead of "No votes yet" (which makes the locked state look broken).
        (() => {
          const winner = poll.poll_options.find((o) => o.id === decidedId);
          return (
            <View style={styles.decidedNoVotesRow}>
              <Ionicons name="checkmark-circle" size={14} color="#0F3F2E" />
              <Text style={styles.decidedNoVotesLabel} numberOfLines={1}>
                {winner?.label ?? 'Locked'}
              </Text>
              <Text style={styles.decidedNoVotesHint}>planner pick</Text>
            </View>
          );
        })()
      ) : totalVotes === 0 ? (
        <Text style={styles.emptyHint}>No votes yet</Text>
      ) : (
        ranked.slice(0, 5).map(({ opt, votes }: { opt: PollOption; votes: number }) => {
          // Percent denominator is *people who voted on this poll*, not
          // raw vote count — so multi-select polls show "60% of voters
          // picked this" rather than the meaningless "vote share".
          const pct = pollRespondents > 0 ? (votes / pollRespondents) * 100 : 0;
          const widthPct = (votes / maxVotes) * 100;
          const isWinner = isDecided ? opt.id === decidedId : votes === maxVotes && votes > 0;
          return (
            <View key={opt.id} style={styles.optionRow}>
              <View style={styles.optionLabelRow}>
                <Text
                  style={[styles.optionLabel, isWinner && styles.optionLabelWinner]}
                  numberOfLines={1}
                >
                  {opt.label}
                </Text>
                <Text style={styles.optionCount}>
                  {votes} · {Math.round(pct)}%
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${widthPct}%` },
                    isWinner && styles.barFillWinner,
                  ]}
                />
              </View>
            </View>
          );
        })
      )}
      {open && !isPerDayDates && ranked.length > 5 ? (
        <Text style={styles.moreHint}>+ {ranked.length - 5} more options</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'white',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EBEBEB',
    padding: 14,
    marginBottom: 18,
    gap: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '700', color: '#163026' },
  totalCount: { fontSize: 13, color: '#888' },

  pollBlock: { gap: 6 },
  pollHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  pollTitle: { fontSize: 13, fontWeight: '600', color: '#404040', flex: 1 },
  lockedPill: {
    backgroundColor: '#DFE8D2',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  lockedPillText: { fontSize: 10, fontWeight: '700', color: '#0F3F2E' },

  emptyHint: { fontSize: 12, color: '#A0A0A0', fontStyle: 'italic', paddingLeft: 4 },
  decidedNoVotesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingLeft: 4,
  },
  decidedNoVotesLabel: { fontSize: 13, fontWeight: '700', color: '#0F3F2E', flexShrink: 1 },
  decidedNoVotesHint: { fontSize: 11, color: '#888', fontStyle: 'italic' },
  moreHint: { fontSize: 11, color: '#888', textAlign: 'center', paddingTop: 2 },

  optionRow: { gap: 3 },
  optionLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  optionLabel: { fontSize: 12, color: '#404040', flex: 1 },
  optionLabelWinner: { fontWeight: '700', color: '#0F3F2E' },
  optionCount: { fontSize: 11, color: '#888', fontVariant: ['tabular-nums'] },

  barTrack: {
    height: 6,
    backgroundColor: '#F3F1EC',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#A0C0B2',
    borderRadius: 3,
  },
  barFillWinner: { backgroundColor: '#0F3F2E' },
});
