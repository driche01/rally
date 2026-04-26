/**
 * Public read-only trip status (Phase 8a of 1:1 SMS pivot).
 *
 *   https://rallysurveys.netlify.app/status/<share_token>
 *
 * Anyone with the link sees: destination, dates, headcount, planner name.
 * Read-only — no form, no auth. Useful for sharing-with-spouse / sending
 * to whoever you want to keep in the loop without giving them poll access.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';

import { getTripByShareToken } from '@/lib/api/trips';
import { getResponseCountsForTrip } from '@/lib/api/responses';
import { GROUP_SIZE_MIDPOINTS, type TripWithPolls } from '@/types/database';
import { capture, Events } from '@/lib/analytics';

const IS_WEB = Platform.OS === 'web';

function WebShell({ children }: { children: React.ReactNode }) {
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
        style={{
          width: '100%',
          maxWidth: 480,
          backgroundColor: 'white',
          borderRadius: 24,
          overflow: 'hidden',
          // @ts-ignore web-only
          boxShadow: '0 4px 40px rgba(0,0,0,0.10)',
        }}
      >
        {children}
      </View>
    </View>
  );
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return '';
  if (s.getMonth() === e.getMonth()) {
    return `${months[s.getMonth()]} ${s.getDate()}\u2013${e.getDate()}`;
  }
  return `${months[s.getMonth()]} ${s.getDate()} \u2013 ${months[e.getMonth()]} ${e.getDate()}`;
}

export default function PublicTripStatus() {
  const params = useLocalSearchParams<{ token?: string }>();
  const token = (params.token ?? '').toString().trim();
  const insets = useSafeAreaInsets();

  const [trip, setTrip] = useState<TripWithPolls | null>(null);
  const [respondedCount, setRespondedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) { setError('invalid'); return () => {}; }
    (async () => {
      try {
        const t = await getTripByShareToken(token);
        if (cancelled) return;
        setTrip(t);
        capture(Events.TRIP_VIEWED, { source: 'public_status', trip_id: t.id });
        try {
          const counts = await getResponseCountsForTrip(t.id);
          if (cancelled) return;
          setRespondedCount(Object.keys(counts).length);
        } catch { /* swallow — header still renders without counts */ }
      } catch {
        if (!cancelled) setError('not_found');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (error) {
    return (
      <WebShell>
        <View style={{ padding: 32, alignItems: 'center', minHeight: IS_WEB ? 360 : 0 }}>
          <Ionicons name="alert-circle-outline" size={48} color="#D85A30" />
          <Text style={{ marginTop: 16, fontSize: 20, fontWeight: '600', color: '#163026', textAlign: 'center' }}>
            This trip link doesn't work
          </Text>
          <Text style={{ marginTop: 8, fontSize: 15, color: '#666', textAlign: 'center' }}>
            Ask whoever sent it for a fresh link.
          </Text>
        </View>
      </WebShell>
    );
  }

  if (!trip) {
    return (
      <WebShell>
        <View style={{ padding: 32, alignItems: 'center', minHeight: IS_WEB ? 360 : 0 }}>
          <ActivityIndicator size="large" color="#1D9E75" />
          <Text style={{ marginTop: 12, fontSize: 14, color: '#666' }}>Loading trip…</Text>
        </View>
      </WebShell>
    );
  }

  const dateLabel = formatDateRange(trip.start_date, trip.end_date);
  const total = trip.group_size_precise ?? GROUP_SIZE_MIDPOINTS[trip.group_size_bucket];
  const respondShareUrl =
    (process.env.EXPO_PUBLIC_APP_URL ?? 'https://rallyapp.io') + `/respond/${token}`;

  return (
    <WebShell>
      <ScrollView contentContainerStyle={{ padding: 28, paddingTop: IS_WEB ? 36 : 28 + insets.top }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#D85A30', letterSpacing: 0.5 }}>
          TRIP STATUS
        </Text>
        <Text style={{ marginTop: 6, fontSize: 28, fontWeight: '700', color: '#163026' }}>
          {trip.name ?? 'A trip'}
        </Text>

        {trip.destination ? (
          <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="location-outline" size={18} color="#163026" />
            <Text style={{ fontSize: 16, color: '#163026' }}>{trip.destination}</Text>
          </View>
        ) : null}
        {dateLabel ? (
          <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="calendar-outline" size={18} color="#163026" />
            <Text style={{ fontSize: 16, color: '#163026' }}>{dateLabel}</Text>
          </View>
        ) : null}
        <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="people-outline" size={18} color="#163026" />
          <Text style={{ fontSize: 16, color: '#163026' }}>
            {respondedCount} of {total} responded
          </Text>
        </View>

        <View style={{ marginTop: 28, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#EEE' }}>
          <Text style={{ fontSize: 13, color: '#666', lineHeight: 20 }}>
            This is a read-only view. To weigh in on dates, destination, and the rest, tap below.
          </Text>
          <Pressable
            onPress={() => Linking.openURL(respondShareUrl)}
            style={{
              marginTop: 16,
              backgroundColor: '#0F3F2E',
              borderRadius: 999,
              paddingVertical: 14,
              paddingHorizontal: 24,
              alignItems: 'center',
            }}
            accessibilityRole="button"
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
              Open the planning page
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </WebShell>
  );
}
