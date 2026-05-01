/**
 * Public live-results page.
 *
 * Stateless, no auth — anyone with the trip's share_token can see the
 * aggregate vote totals. Linked from the synthesis-update SMS Rally
 * sends planners + group members at milestones.
 *
 * Mirrors the planner dashboard's AggregateResultsCard view but
 * read-only and self-contained (no app shell).
 */
import React from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { supabaseAnon } from '@/lib/supabase';
import { daysUntil, formatCadenceDate } from '@/lib/cadence';
import { comparePollsByFormOrder, formatTripDateRange, parseDateRangeLabel } from '@/lib/pollFormUtils';
import { DateHeatmap } from '@/components/trips/DateHeatmap';

const IS_WEB = Platform.OS === 'web';

interface OptionResult {
  id: string;
  label: string;
  position: number;
  votes: number;
}
interface PollResult {
  id: string;
  title: string;
  type: 'destination' | 'dates' | 'budget' | 'custom';
  status: 'live' | 'decided';
  decided_option_id: string | null;
  options: OptionResult[];
}
interface AggregateResultsResponse {
  ok: boolean;
  reason?: string;
  trip?: {
    id: string;
    name: string;
    destination: string | null;
    book_by_date: string | null;
    responses_due_date: string | null;
    start_date?: string | null;
    end_date?: string | null;
  };
  polls?: PollResult[];
  total_responses?: number;
}

const POLL_TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  destination: 'location-outline',
  dates: 'calendar-outline',
  budget: 'cash-outline',
  custom: 'help-circle-outline',
};

function PageShell({ children }: { children: React.ReactNode }) {
  if (!IS_WEB) {
    return <View style={styles.nativeWrap}>{children}</View>;
  }
  return (
    <ScrollView style={styles.webWrap} contentContainerStyle={styles.webWrapContent}>
      <View style={styles.webCard}>{children}</View>
    </ScrollView>
  );
}

export default function ResultsPage() {
  const { token } = useLocalSearchParams<{ token: string }>();

  const { data, isLoading } = useQuery<AggregateResultsResponse>({
    queryKey: ['public_results', token],
    queryFn: async () => {
      const { data, error } = await supabaseAnon.rpc(
        'get_aggregate_results_by_share_token',
        { p_token: token },
      );
      if (error) return { ok: false, reason: error.message };
      return data as AggregateResultsResponse;
    },
    enabled: Boolean(token),
    // Tight polling so participants see vote totals update almost live
    // after they (or someone else) submit. The RPC behind this is one
    // query — cheap enough for a 5s cadence on a public read-only page.
    refetchInterval: 5_000,
  });

  if (isLoading) {
    return (
      <PageShell>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#0F3F2E" />
        </View>
      </PageShell>
    );
  }

  if (!data?.ok || !data.trip) {
    return (
      <PageShell>
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🔗</Text>
          <Text style={styles.emptyTitle}>Results unavailable</Text>
          <Text style={styles.emptyBody}>
            This link is invalid or the trip has been closed.
          </Text>
        </View>
      </PageShell>
    );
  }

  const { trip, polls = [], total_responses = 0 } = data;
  const dueDays = daysUntil(trip.responses_due_date);

  return (
    <PageShell>
      <View style={styles.headerBlock}>
        <Text style={styles.eyebrow}>LIVE RESULTS</Text>
        <Text style={styles.tripName} numberOfLines={2}>
          {trip.name}
        </Text>
        {trip.destination ? (
          <View style={styles.metaLine}>
            <Ionicons name="location-outline" size={13} color="#5F685F" />
            <Text style={styles.metaText}>{trip.destination}</Text>
          </View>
        ) : null}
        {trip.responses_due_date ? (
          <View style={styles.metaLine}>
            <Ionicons name="time-outline" size={13} color="#5F685F" />
            <Text style={styles.metaText}>
              Responses due {formatCadenceDate(trip.responses_due_date)}
              {dueDays !== null && dueDays >= 0 ? ` · ${dueDays === 0 ? 'today' : dueDays === 1 ? 'tomorrow' : `in ${dueDays}d`}` : ''}
            </Text>
          </View>
        ) : null}
        <Text style={styles.summary}>
          {total_responses} {total_responses === 1 ? 'person has' : 'people have'} responded
        </Text>
      </View>

      {polls.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>📭</Text>
          <Text style={styles.emptyTitle}>No live polls yet</Text>
          <Text style={styles.emptyBody}>
            The planner hasn't opened any decisions yet. Check back later.
          </Text>
        </View>
      ) : (
        [...polls]
          .sort(comparePollsByFormOrder)
          .map((poll) => (
            <PollResults
              key={poll.id}
              poll={poll}
              tripStartDate={trip.start_date ?? null}
              tripEndDate={trip.end_date ?? null}
            />
          ))
      )}

      <Text style={styles.footer}>
        Live results · refreshes every 30 seconds.
      </Text>
    </PageShell>
  );
}

function PollResults({
  poll,
  tripStartDate,
  tripEndDate,
}: {
  poll: PollResult;
  tripStartDate: string | null;
  tripEndDate: string | null;
}) {
  const total = poll.options.reduce((a, b) => a + b.votes, 0);
  const maxVotes = Math.max(1, ...poll.options.map((o) => o.votes));
  const sorted = [...poll.options].sort((a, b) =>
    b.votes - a.votes || a.position - b.position,
  );

  // Per-day dates poll detection — same heuristic as the dashboard.
  const isPerDayDates = poll.type === 'dates'
    && poll.options.length > 0
    && poll.options.every((o) => {
      const r = parseDateRangeLabel(o.label);
      if (!r) return false;
      return r.start.getFullYear() === r.end.getFullYear()
        && r.start.getMonth() === r.end.getMonth()
        && r.start.getDate() === r.end.getDate();
    });
  const heatmapCounts = isPerDayDates
    ? Object.fromEntries(poll.options.map((o) => [o.id, o.votes]))
    : {};

  const isDecided = poll.status === 'decided';

  return (
    <View style={styles.pollBlock}>
      <View style={styles.pollHeader}>
        <Ionicons
          name={POLL_TYPE_ICON[poll.type] ?? 'help-circle-outline'}
          size={14}
          color="#5F685F"
        />
        <Text style={styles.pollTitle}>{poll.title}</Text>
        {isDecided ? (
          <View style={styles.lockedPill}>
            <Text style={styles.lockedPillText}>Locked</Text>
          </View>
        ) : null}
      </View>

      {isDecided ? (
        // Locked poll — show the chosen value as a single line, matching
        // the destination/duration treatment. Dates use trip.start_date /
        // end_date (decided_option_id is best-effort there); everything
        // else falls back to the decided option's label.
        (() => {
          let summary: string | null = null;
          if (poll.type === 'dates' && tripStartDate) {
            summary = formatTripDateRange(tripStartDate, tripEndDate);
          } else if (poll.decided_option_id) {
            summary = poll.options.find((o) => o.id === poll.decided_option_id)?.label ?? null;
          }
          return (
            <View style={styles.decidedNoVotesRow}>
              <Ionicons name="checkmark-circle" size={16} color="#0F3F2E" />
              <Text style={styles.decidedNoVotesLabel} numberOfLines={1}>
                {summary ?? 'Locked'}
              </Text>
              <Text style={styles.decidedNoVotesHint}>planner pick</Text>
            </View>
          );
        })()
      ) : isPerDayDates ? (
        <DateHeatmap options={poll.options} counts={heatmapCounts} />
      ) : total === 0 ? (
        <Text style={styles.emptyHint}>No votes yet</Text>
      ) : (
        sorted.slice(0, 8).map((opt) => {
          const pct = total > 0 ? (opt.votes / total) * 100 : 0;
          const widthPct = (opt.votes / maxVotes) * 100;
          const isWinner =
            poll.status === 'decided'
              ? opt.id === poll.decided_option_id
              : opt.votes === maxVotes && opt.votes > 0;
          return (
            <View key={opt.id} style={styles.optionRow}>
              <View style={styles.optionLabelRow}>
                <Text style={[styles.optionLabel, isWinner && styles.optionLabelWinner]} numberOfLines={1}>
                  {opt.label}
                </Text>
                <Text style={styles.optionCount}>
                  {opt.votes} · {Math.round(pct)}%
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
    </View>
  );
}

const styles = StyleSheet.create({
  nativeWrap: {
    flex: 1,
    backgroundColor: '#F4ECDF',
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  webWrap: {
    flex: 1,
    backgroundColor: '#F4ECDF',
  },
  webWrapContent: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    minHeight: '100%' as any,
  },
  webCard: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 24,
    // @ts-ignore web-only
    boxShadow: '0 4px 40px rgba(0,0,0,0.08)',
  },

  center: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#163026' },
  emptyBody: { fontSize: 14, color: '#5F685F', textAlign: 'center' },

  headerBlock: { gap: 6, marginBottom: 24 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F3F2E',
    letterSpacing: 0.8,
  },
  tripName: { fontSize: 24, fontWeight: '700', color: '#163026' },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 13, color: '#5F685F' },
  summary: { fontSize: 13, color: '#404040', marginTop: 4 },

  pollBlock: {
    gap: 6,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#EFE3D0',
  },
  pollHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pollTitle: { fontSize: 15, fontWeight: '700', color: '#163026', flex: 1 },
  lockedPill: {
    backgroundColor: '#DFE8D2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  lockedPillText: { fontSize: 11, fontWeight: '700', color: '#0F3F2E' },

  emptyHint: { fontSize: 12, color: '#A0A0A0', fontStyle: 'italic' },
  decidedNoVotesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  decidedNoVotesLabel: { fontSize: 14, fontWeight: '700', color: '#0F3F2E', flexShrink: 1 },
  decidedNoVotesHint: { fontSize: 12, color: '#888', fontStyle: 'italic' },

  optionRow: { gap: 4, marginTop: 6 },
  optionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  optionLabel: { fontSize: 13, color: '#404040', flex: 1 },
  optionLabelWinner: { fontWeight: '700', color: '#0F3F2E' },
  optionCount: { fontSize: 12, color: '#888', fontVariant: ['tabular-nums'] },

  barTrack: { height: 8, backgroundColor: '#F3F1EC', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#A0C0B2', borderRadius: 4 },
  barFillWinner: { backgroundColor: '#0F3F2E' },

  footer: {
    fontSize: 11,
    color: '#888',
    textAlign: 'center',
    marginTop: 24,
  },
});
