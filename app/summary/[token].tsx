/**
 * Public decision-lock summary page.
 *
 * Linked from the lock-broadcast SMS Rally sends to participants when
 * the planner approves a recommendation. Anyone with the trip's
 * share_token can see the locked decisions, dates, and destination.
 *
 * Reuses the same RPC as the live-results page (it already returns
 * decided polls with their winners). The summary view filters to
 * decided polls only and renders a "what's next" CTA.
 */
import React from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { supabaseAnon } from '@/lib/supabase';
import { formatCadenceDate } from '@/lib/cadence';

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
    start_date: string | null;
    end_date: string | null;
    budget_per_person: string | null;
  };
  polls?: PollResult[];
  total_responses?: number;
}

const POLL_TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  destination: 'location',
  dates: 'calendar',
  budget: 'cash',
  custom: 'checkmark-circle',
};

function PageShell({ children }: { children: React.ReactNode }) {
  if (!IS_WEB) {
    return <View style={styles.nativeWrap}>{children}</View>;
  }
  return (
    <View style={styles.webWrap}>
      <View style={styles.webCard}>{children}</View>
    </View>
  );
}

export default function SummaryPage() {
  const { token } = useLocalSearchParams<{ token: string }>();

  const { data, isLoading } = useQuery<AggregateResultsResponse>({
    queryKey: ['public_summary', token],
    queryFn: async () => {
      const { data, error } = await supabaseAnon.rpc(
        'get_aggregate_results_by_share_token',
        { p_token: token },
      );
      if (error) return { ok: false, reason: error.message };
      return data as AggregateResultsResponse;
    },
    enabled: Boolean(token),
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
          <Text style={styles.emptyTitle}>Summary unavailable</Text>
          <Text style={styles.emptyBody}>
            This link is invalid or the trip has been closed.
          </Text>
        </View>
      </PageShell>
    );
  }

  const { trip, polls = [] } = data;
  const decided = polls.filter((p) => p.status === 'decided');
  const stillOpen = polls.filter((p) => p.status === 'live');

  return (
    <PageShell>
      <View style={styles.headerBlock}>
        <Text style={styles.eyebrow}>LOCKED IN</Text>
        <Text style={styles.tripName} numberOfLines={2}>
          {trip.name}
        </Text>
        {trip.destination ? (
          <View style={styles.metaLine}>
            <Ionicons name="location-outline" size={14} color="#5F685F" />
            <Text style={styles.metaText}>{trip.destination}</Text>
          </View>
        ) : null}
        {trip.start_date && trip.end_date ? (
          <View style={styles.metaLine}>
            <Ionicons name="calendar-outline" size={14} color="#5F685F" />
            <Text style={styles.metaText}>
              {formatCadenceDate(trip.start_date)} → {formatCadenceDate(trip.end_date)}
            </Text>
          </View>
        ) : null}
        {trip.budget_per_person ? (
          <View style={styles.metaLine}>
            <Ionicons name="cash-outline" size={14} color="#5F685F" />
            <Text style={styles.metaText}>{trip.budget_per_person}</Text>
          </View>
        ) : null}
      </View>

      {decided.length > 0 ? (
        <View style={styles.decidedBlock}>
          <Text style={styles.sectionLabel}>Decisions</Text>
          {decided.map((poll) => {
            const winner = poll.options.find((o) => o.id === poll.decided_option_id);
            return (
              <View key={poll.id} style={styles.decisionRow}>
                <View style={styles.decisionIcon}>
                  <Ionicons
                    name={POLL_TYPE_ICON[poll.type] ?? 'checkmark-circle'}
                    size={16}
                    color="#0F3F2E"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.decisionLabel}>{poll.title}</Text>
                  <Text style={styles.decisionValue} numberOfLines={2}>
                    {winner?.label ?? '—'}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyDecisions}>
          <Text style={styles.emptyDecisionsText}>
            No decisions locked yet. Check back when your planner finalizes things.
          </Text>
        </View>
      )}

      {stillOpen.length > 0 ? (
        <View style={styles.stillOpenBlock}>
          <Text style={styles.stillOpenLabel}>
            {stillOpen.length} {stillOpen.length === 1 ? 'decision' : 'decisions'} still open
          </Text>
          <Pressable
            onPress={() => {
              const url = `${IS_WEB ? window.location.origin : 'https://rallysurveys.netlify.app'}/results/${token}`;
              Linking.openURL(url).catch(() => {});
            }}
            style={styles.openBtn}
            accessibilityRole="button"
          >
            <Text style={styles.openBtnText}>See live results</Text>
            <Ionicons name="arrow-forward" size={14} color="#0F3F2E" />
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.footer}>
        Talk to your planner with any questions. To update your survey answers, tap the most recent survey link.
      </Text>
    </PageShell>
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
    minHeight: '100%' as any,
    backgroundColor: '#F4ECDF',
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
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
  tripName: { fontSize: 26, fontWeight: '700', color: '#163026' },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  metaText: { fontSize: 14, color: '#5F685F' },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 0.8,
    marginBottom: 10,
    textTransform: 'uppercase',
  },

  decidedBlock: { marginBottom: 24 },
  decisionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#EFE3D0',
  },
  decisionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#DFE8D2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  decisionLabel: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  decisionValue: { fontSize: 16, fontWeight: '700', color: '#163026', marginTop: 2 },

  emptyDecisions: {
    backgroundColor: '#F7F5EE',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
  },
  emptyDecisionsText: { fontSize: 13, color: '#5F685F', lineHeight: 19, textAlign: 'center' },

  stillOpenBlock: {
    backgroundColor: '#FFF7F2',
    borderWidth: 1,
    borderColor: '#F4D5C5',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    gap: 8,
  },
  stillOpenLabel: { fontSize: 13, color: '#9A2A2A', fontWeight: '600' },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DFE8D2',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  openBtnText: { fontSize: 13, fontWeight: '700', color: '#0F3F2E' },

  footer: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
});
