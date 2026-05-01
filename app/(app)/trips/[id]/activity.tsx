/**
 * Activity screen — planner-only feed of trip lifecycle events.
 *
 * Phase 15. Replaces the old Members screen as the dashboard's "Group"
 * entry-card destination. Backed by `trip_audit_events` (migration 089)
 * with auto-emit triggers (migration 090) plus app-code emit for
 * intent-bearing events (planner edits, poll lifecycle, etc. — wired
 * in a follow-up phase).
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTrip } from '@/hooks/useTrips';
import { useTripAuditEvents } from '@/hooks/useTripAuditEvents';
import { getTripStage, STAGE_ACCENT } from '@/lib/tripStage';
import type { TripAuditEvent, TripAuditEventKind } from '@/lib/api/auditEvents';

// ─── Event copy + iconography ────────────────────────────────────────────────
// One row per event kind. Keeps the screen surface tight: icon + label +
// optional secondary line + relative time. Unknown kinds fall through to
// a generic row so a future migration adding new kinds doesn't break the
// list before TS types catch up.

interface RenderedEvent {
  icon: keyof typeof Ionicons.glyphMap;
  primary: string;
  secondary: string | null;
}

function renderEvent(ev: TripAuditEvent): RenderedEvent {
  const p = ev.payload ?? {};
  const name =
    typeof p.display_name === 'string' && p.display_name.trim().length > 0
      ? p.display_name
      : typeof p.phone === 'string'
        ? p.phone
        : 'Someone';

  switch (ev.kind as TripAuditEventKind) {
    case 'trip_created':
      return {
        icon: 'sparkles-outline',
        primary: 'Trip created',
        secondary: typeof p.name === 'string' ? p.name : null,
      };
    case 'member_joined':
      return { icon: 'person-add-outline', primary: `${name} joined`, secondary: null };
    case 'member_added_by_planner':
      return { icon: 'person-add-outline', primary: `${name} was added`, secondary: null };
    case 'member_opted_out':
      return { icon: 'log-out-outline', primary: `${name} opted out`, secondary: null };
    case 'member_removed_by_planner':
      return { icon: 'person-remove-outline', primary: `${name} was removed`, secondary: null };
    case 'traveler_profile_updated':
      return {
        icon: 'options-outline',
        primary: `${name} updated travel preferences`,
        secondary: null,
      };
    case 'survey_completed':
      return { icon: 'checkmark-done-outline', primary: `${name} finished the survey`, secondary: null };
    case 'poll_added':
      return {
        icon: 'help-circle-outline',
        primary: 'Poll added',
        secondary: typeof p.title === 'string' ? p.title : null,
      };
    case 'poll_removed':
      return {
        icon: 'close-circle-outline',
        primary: 'Poll removed',
        secondary: typeof p.title === 'string' ? p.title : null,
      };
    case 'poll_decided':
      return {
        icon: 'lock-closed-outline',
        primary: typeof p.title === 'string' ? `Locked: ${p.title}` : 'Decision locked',
        secondary: typeof p.decided_value === 'string' ? p.decided_value : null,
      };
    case 'trip_field_changed': {
      const field = typeof p.field_name === 'string' ? p.field_name : 'Detail';
      const oldV = typeof p.old_value === 'string' || typeof p.old_value === 'number' ? String(p.old_value) : null;
      const newV = typeof p.new_value === 'string' || typeof p.new_value === 'number' ? String(p.new_value) : null;
      const arrow = oldV && newV ? `${oldV} → ${newV}` : newV ?? oldV;
      return {
        icon: 'create-outline',
        primary: `${field} changed`,
        secondary: arrow,
      };
    }
    default:
      return { icon: 'ellipse-outline', primary: ev.kind, secondary: null };
  }
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function TripActivityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: trip } = useTrip(id);
  const accentColor = STAGE_ACCENT[trip ? getTripStage(trip) : 'deciding'];
  const { data: events = [], isLoading } = useTripAuditEvents(id);

  const rendered = useMemo(
    () => events.map((ev) => ({ ev, view: renderEvent(ev) })),
    [events],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text style={[styles.backBtn, { color: accentColor }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Activity</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {events.length === 0 && !isLoading ? (
          <View style={styles.emptyState}>
            <Ionicons name="pulse-outline" size={40} color="#C0C0C0" />
            <Text style={styles.emptyTitle}>Nothing yet</Text>
            <Text style={styles.emptySubtitle}>
              Trip activity shows up here as members join, respond, and update their preferences.
            </Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {rendered.map(({ ev, view }, i) => (
              <View
                key={ev.id}
                style={[styles.row, i < rendered.length - 1 && styles.rowBorder]}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name={view.icon} size={16} color="#5F685F" />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowPrimary}>{view.primary}</Text>
                  {view.secondary ? (
                    <Text style={styles.rowSecondary} numberOfLines={2}>
                      {view.secondary}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.rowTime}>{relativeTime(ev.created_at)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F4F0' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  backBtn: { fontSize: 15, width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#163026' },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },

  listCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EBEBEB',
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  rowIcon: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#F3F1EC',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  rowPrimary: { fontSize: 14, color: '#163026', lineHeight: 20 },
  rowSecondary: { fontSize: 12, color: '#737373', lineHeight: 16 },
  rowTime: { fontSize: 11, color: '#A0A0A0', flexShrink: 0, paddingTop: 4 },

  emptyState: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#163026' },
  emptySubtitle: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },
});
