/**
 * Trip Web View — Component 11
 *
 * Public page at /trip/[id]?token=[token]
 * No auth required — token validated against trip_access_tokens table.
 * Shows trip details from SMS agent session.
 *
 * Accessible from:
 *   - SMS celebration message after first booking
 *   - STATUS / FOCUS command responses
 *   - rally://trip/[id] deep link in the app
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { supabaseAnon } from '@/lib/supabase';

const IS_WEB = Platform.OS === 'web';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TripData {
  destination: string | null;
  dates: { start: string; end: string } | null;
  phase: string;
  status: string;
  lodging_property: string | null;
  lodging_type: string | null;
  thread_name: string | null;
  participants: {
    display_name: string | null;
    phone: string;
    committed: boolean;
    flight_status: string;
  }[];
  splits: {
    reason: string | null;
    amount: number;
    status: string;
    payer_name: string | null;
  }[];
}

// ─── Web shell (matches respond page style) ──────────────────────────────────

function WebPageShell({ children }: { children: React.ReactNode }) {
  if (!IS_WEB) return <>{children}</>;
  return (
    <View style={styles.webBg}>
      <View style={styles.webCard}>{children}</View>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function TripWebView() {
  const { id, token } = useLocalSearchParams<{ id: string; token?: string }>();
  const [trip, setTrip] = useState<TripData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTrip();
  }, [id, token]);

  async function loadTrip() {
    if (!id) {
      setError('No trip ID provided.');
      setLoading(false);
      return;
    }

    try {
      // Validate token if provided
      if (token) {
        const { data: tokenData } = await supabaseAnon
          .from('trip_access_tokens')
          .select('trip_session_id, expires_at, used_at')
          .eq('token', token)
          .eq('trip_session_id', id)
          .maybeSingle();

        if (!tokenData) {
          setError('Invalid link. Text STATUS to get a fresh one.');
          setLoading(false);
          return;
        }

        if (new Date(tokenData.expires_at) < new Date()) {
          setError('This link has expired. Text STATUS to get a fresh one.');
          setLoading(false);
          return;
        }

        // Mark as used
        if (!tokenData.used_at) {
          await supabaseAnon
            .from('trip_access_tokens')
            .update({ used_at: new Date().toISOString() })
            .eq('token', token);
        }
      }

      // Fetch session data
      const { data: session, error: sessionErr } = await supabaseAnon
        .from('trip_sessions')
        .select('destination, dates, phase, status, lodging_property, lodging_type, thread_name')
        .eq('id', id)
        .maybeSingle();

      if (sessionErr || !session) {
        setError('Trip not found.');
        setLoading(false);
        return;
      }

      // Fetch participants
      const { data: participants } = await supabaseAnon
        .from('trip_session_participants')
        .select('display_name, phone, committed, flight_status')
        .eq('trip_session_id', id)
        .eq('status', 'active')
        .order('joined_at');

      // Fetch splits
      const { data: splits } = await supabaseAnon
        .from('split_requests')
        .select('reason, amount, status, payer_user_id')
        .eq('trip_session_id', id)
        .order('created_at');

      setTrip({
        ...session,
        participants: participants ?? [],
        splits: (splits ?? []).map((s) => ({
          reason: s.reason,
          amount: s.amount,
          status: s.status,
          payer_name: null, // Would need a join to get names
        })),
      });
    } catch (err) {
      setError('Something went wrong. Try again.');
      console.error('[trip-view] Error:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <WebPageShell>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#D85A30" />
        </View>
      </WebPageShell>
    );
  }

  if (error) {
    return (
      <WebPageShell>
        <View style={styles.center}>
          <Text style={styles.errorEmoji}>{'\u{1F614}'}</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </WebPageShell>
    );
  }

  if (!trip) return null;

  const dates = trip.dates;
  const dateStr = dates ? formatDateRange(dates.start, dates.end) : 'Dates TBD';
  const tripName = trip.thread_name ?? trip.destination ?? 'Trip';
  const confirmedCount = trip.participants.filter((p) => p.committed).length;

  return (
    <WebPageShell>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroEmoji}>{getDestinationEmoji(trip.destination)}</Text>
          <Text style={styles.heroTitle}>{trip.destination ?? 'Destination TBD'}</Text>
          <Text style={styles.heroDates}>{dateStr}</Text>
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>{formatPhase(trip.phase)}</Text>
          </View>
        </View>

        {/* Crew */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            The Crew ({confirmedCount}/{trip.participants.length} confirmed)
          </Text>
          {trip.participants.map((p, i) => (
            <View key={i} style={styles.participantRow}>
              <Text style={styles.participantName}>{p.display_name ?? p.phone.slice(-4)}</Text>
              <View style={styles.badges}>
                {p.committed && <Text style={styles.badgeGreen}>IN</Text>}
                {p.flight_status === 'confirmed' && <Text style={styles.badgeBlue}>{'\u2708\uFE0F'}</Text>}
                {p.flight_status === 'driving' && <Text style={styles.badgeBlue}>{'\u{1F697}'}</Text>}
              </View>
            </View>
          ))}
        </View>

        {/* Lodging */}
        {trip.lodging_property && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Lodging</Text>
            <Text style={styles.lodgingName}>{trip.lodging_property}</Text>
            <Text style={styles.lodgingType}>
              {trip.lodging_type === 'GROUP' ? 'Group rental' : trip.lodging_type === 'INDIVIDUAL' ? 'Individual bookings' : 'Flights only'}
            </Text>
          </View>
        )}

        {/* Splits */}
        {trip.splits.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Expenses</Text>
            {trip.splits.map((s, i) => (
              <View key={i} style={styles.splitRow}>
                <Text style={styles.splitReason}>{s.reason ?? 'Split'}</Text>
                <Text style={styles.splitAmount}>${s.amount}</Text>
                <Text style={[styles.splitStatus, s.status === 'paid' && styles.splitPaid]}>
                  {s.status === 'paid' ? 'Paid' : 'Pending'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Powered by Rally {'\u{1F30A}'}</Text>
        </View>
      </ScrollView>
    </WebPageShell>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString('en-US', opts)} \u2013 ${e.toLocaleDateString('en-US', opts)}`;
}

function formatPhase(phase: string): string {
  const map: Record<string, string> = {
    INTRO: 'Getting started',
    COLLECTING_DESTINATIONS: 'Picking destinations',
    DECIDING_DATES: 'Deciding dates',
    BUDGET_POLL: 'Budget check',
    DECIDING_DESTINATION: 'Voting on destination',
    COLLECTING_ORIGINS: 'Collecting flight origins',
    ESTIMATING_COSTS: 'Getting cost estimates',
    COMMIT_POLL: 'Who\'s in?',
    AWAITING_FLIGHTS: 'Booking flights',
    DECIDING_LODGING_TYPE: 'Deciding lodging',
    AWAITING_GROUP_BOOKING: 'Booking lodging',
    FIRST_BOOKING_REACHED: 'Booked!',
    RECOMMENDING: 'Trip inspo',
    COMPLETE: 'Trip complete',
  };
  return map[phase] ?? phase;
}

function getDestinationEmoji(dest: string | null): string {
  if (!dest) return '\u{1F30D}';
  const lower = dest.toLowerCase();
  if (lower.includes('mexico') || lower.includes('tulum') || lower.includes('cancun')) return '\u{1F1F2}\u{1F1FD}';
  if (lower.includes('hawaii')) return '\u{1F3DD}\uFE0F';
  if (lower.includes('japan') || lower.includes('tokyo')) return '\u{1F1EF}\u{1F1F5}';
  if (lower.includes('europe') || lower.includes('paris') || lower.includes('london')) return '\u{1F1EA}\u{1F1FA}';
  if (lower.includes('beach') || lower.includes('island')) return '\u{1F3D6}\uFE0F';
  if (lower.includes('ski') || lower.includes('aspen') || lower.includes('mountain')) return '\u26F7\uFE0F';
  return '\u{1F30A}';
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  webBg: {
    flex: 1,
    backgroundColor: '#F0EDE8',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  webCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: 'white',
    borderRadius: 24,
    overflow: 'hidden',
  },
  container: { flex: 1 },
  content: { paddingBottom: 40 },
  center: { padding: 60, alignItems: 'center', justifyContent: 'center' },
  errorEmoji: { fontSize: 48, marginBottom: 16 },
  errorText: { fontSize: 16, color: '#666', textAlign: 'center', lineHeight: 24 },
  hero: {
    backgroundColor: '#085041',
    paddingVertical: 40,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  heroEmoji: { fontSize: 48, marginBottom: 12 },
  heroTitle: { fontSize: 28, fontWeight: '700', color: 'white', marginBottom: 4 },
  heroDates: { fontSize: 16, color: 'rgba(255,255,255,0.8)', marginBottom: 16 },
  statusPill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: { color: 'white', fontSize: 13, fontWeight: '600' },
  section: { paddingHorizontal: 24, paddingTop: 24 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  participantRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EEE' },
  participantName: { fontSize: 16, color: '#2C2C2A' },
  badges: { flexDirection: 'row', gap: 8 },
  badgeGreen: { fontSize: 12, fontWeight: '700', color: '#1D9E75', backgroundColor: '#E8F7F1', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  badgeBlue: { fontSize: 14 },
  lodgingName: { fontSize: 18, fontWeight: '600', color: '#2C2C2A', marginBottom: 4 },
  lodgingType: { fontSize: 14, color: '#888' },
  splitRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EEE', gap: 12 },
  splitReason: { flex: 1, fontSize: 15, color: '#2C2C2A' },
  splitAmount: { fontSize: 15, fontWeight: '600', color: '#2C2C2A' },
  splitStatus: { fontSize: 12, fontWeight: '600', color: '#D85A30', backgroundColor: '#FFF0EB', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  splitPaid: { color: '#1D9E75', backgroundColor: '#E8F7F1' },
  footer: { paddingVertical: 32, alignItems: 'center' },
  footerText: { fontSize: 14, color: '#CCC' },
});
