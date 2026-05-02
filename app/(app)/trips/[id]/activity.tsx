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
import { useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTrip } from '@/hooks/useTrips';
import { useTripAuditEvents } from '@/hooks/useTripAuditEvents';
import { useTripSession, useSessionParticipants } from '@/hooks/useTripSession';
import { getTripStage, STAGE_ACCENT } from '@/lib/tripStage';
import { normalizePhone } from '@/lib/phone';
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

// ─── Filters ────────────────────────────────────────────────────────────────
// Two filter chips (date + member) sit above the list so a planner can
// narrow a noisy log down to "what did Alex do" or "what changed today".
// Both filters apply client-side over the (capped at 50) event list — no
// extra round-trip needed.

type DateFilter = 'all' | 'today' | 'week' | 'month';

const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  all:   'All time',
  today: 'Today',
  week:  'Last 7 days',
  month: 'Last 30 days',
};

const DATE_FILTER_OPTIONS: DateFilter[] = ['all', 'today', 'week', 'month'];

const DAY_MS = 24 * 60 * 60 * 1000;

function dateFilterCutoff(f: DateFilter): number | null {
  if (f === 'all') return null;
  const now = Date.now();
  if (f === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (f === 'week')  return now - 7 * DAY_MS;
  if (f === 'month') return now - 30 * DAY_MS;
  return null;
}

interface MemberOption {
  /** users.id — matches trip_audit_events.actor_id when the member acted. */
  userId: string | null;
  /** Normalized phone — matches payload.phone when the member is the subject. */
  phone: string | null;
  displayName: string;
}

/**
 * Returns true if the event involves the member as either the actor
 * (trip_audit_events.actor_id matches their users.id) or the subject
 * (the event's payload.phone normalizes to their phone). The "or"
 * semantics matches the planner's mental model — "show me everything
 * about Alex" includes both edits Alex made and edits about Alex.
 */
function eventInvolvesMember(ev: TripAuditEvent, member: MemberOption): boolean {
  if (member.userId && ev.actor_id === member.userId) return true;
  if (member.phone) {
    const payloadPhone = typeof ev.payload?.phone === 'string'
      ? normalizePhone(ev.payload.phone) ?? ev.payload.phone
      : null;
    if (payloadPhone && payloadPhone === member.phone) return true;
  }
  return false;
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
  const { data: tripSession } = useTripSession(id);
  const { data: participants = [] } = useSessionParticipants(tripSession?.id);

  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [memberFilterId, setMemberFilterId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'newest' | 'oldest'>('newest');

  // Build the list of members the planner can filter by. Source from the
  // session participants because it's the canonical "who's on the trip"
  // table — covers both planner and members. We key the option by phone
  // (always populated) and carry user_id for actor matching.
  const memberOptions = useMemo<MemberOption[]>(() => {
    const seen = new Set<string>();
    const opts: MemberOption[] = [];
    for (const p of participants) {
      const key = `${p.user_id ?? ''}|${p.phone}`;
      if (seen.has(key)) continue;
      seen.add(key);
      opts.push({
        userId: p.user_id ?? null,
        phone: p.phone ? normalizePhone(p.phone) ?? p.phone : null,
        displayName: p.display_name ?? p.phone,
      });
    }
    opts.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return opts;
  }, [participants]);

  const memberFilterOption = memberFilterId
    ? memberOptions.find((m) => (m.userId ?? `phone:${m.phone}`) === memberFilterId)
    : null;

  const filteredEvents = useMemo(() => {
    const cutoff = dateFilterCutoff(dateFilter);
    const filtered = events.filter((ev) => {
      if (cutoff !== null && new Date(ev.created_at).getTime() < cutoff) return false;
      if (memberFilterOption && !eventInvolvesMember(ev, memberFilterOption)) return false;
      return true;
    });
    // The API returns newest-first; only re-sort when the planner asked
    // for oldest-first so we don't pay the n*log(n) on the default path.
    if (sortDir === 'oldest') {
      return [...filtered].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    }
    return filtered;
  }, [events, dateFilter, memberFilterOption, sortDir]);

  const rendered = useMemo(
    () => filteredEvents.map((ev) => ({ ev, view: renderEvent(ev) })),
    [filteredEvents],
  );

  const filtersActive = dateFilter !== 'all' || memberFilterId !== null;

  function openDateFilterMenu() {
    const labels = DATE_FILTER_OPTIONS.map((k) => DATE_FILTER_LABELS[k]);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Filter by date',
          options: [...labels, 'Cancel'],
          cancelButtonIndex: labels.length,
          userInterfaceStyle: 'light',
        },
        (i) => {
          if (i === undefined || i === labels.length) return;
          setDateFilter(DATE_FILTER_OPTIONS[i]);
        },
      );
    } else {
      Alert.alert('Filter by date', undefined, [
        ...DATE_FILTER_OPTIONS.map((k) => ({
          text: DATE_FILTER_LABELS[k],
          onPress: () => setDateFilter(k),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }

  function openMemberFilterMenu() {
    if (memberOptions.length === 0) return;
    const labels = ['Everyone', ...memberOptions.map((m) => m.displayName)];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Filter by member',
          options: [...labels, 'Cancel'],
          cancelButtonIndex: labels.length,
          userInterfaceStyle: 'light',
        },
        (i) => {
          if (i === undefined || i === labels.length) return;
          if (i === 0) { setMemberFilterId(null); return; }
          const m = memberOptions[i - 1];
          setMemberFilterId(m.userId ?? `phone:${m.phone}`);
        },
      );
    } else {
      Alert.alert('Filter by member', undefined, [
        { text: 'Everyone', onPress: () => setMemberFilterId(null) },
        ...memberOptions.map((m) => ({
          text: m.displayName,
          onPress: () => setMemberFilterId(m.userId ?? `phone:${m.phone}`),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }

  function clearFilters() {
    setDateFilter('all');
    setMemberFilterId(null);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text style={[styles.backBtn, { color: accentColor }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Activity Log</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Filter chip bar — collapses to a "no filters" gesture line via
          the clear-all link when both filters are at default. */}
      <View style={styles.filterBar}>
        <FilterChip
          icon="calendar-outline"
          label={DATE_FILTER_LABELS[dateFilter]}
          active={dateFilter !== 'all'}
          onPress={openDateFilterMenu}
        />
        <FilterChip
          icon="person-outline"
          label={memberFilterOption?.displayName ?? 'Everyone'}
          active={memberFilterId !== null}
          onPress={openMemberFilterMenu}
          disabled={memberOptions.length === 0}
        />
        <FilterChip
          icon={sortDir === 'newest' ? 'arrow-down-outline' : 'arrow-up-outline'}
          label={sortDir === 'newest' ? 'Newest first' : 'Oldest first'}
          active={sortDir !== 'newest'}
          hideTrailingChevron
          onPress={() => setSortDir((d) => (d === 'newest' ? 'oldest' : 'newest'))}
        />
        {filtersActive ? (
          <Pressable onPress={clearFilters} hitSlop={8} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </Pressable>
        ) : null}
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
        ) : rendered.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="filter-outline" size={40} color="#C0C0C0" />
            <Text style={styles.emptyTitle}>No matching events</Text>
            <Text style={styles.emptySubtitle}>
              Try a different date range or member.
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

// ─── Filter chip ────────────────────────────────────────────────────────────
// Shared affordance for the date + member filters. Active state uses the
// trip's stage accent so the bar reads as "you've narrowed something" at
// a glance without needing a separate badge.

function FilterChip({
  icon,
  label,
  active,
  disabled,
  hideTrailingChevron,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  disabled?: boolean;
  /** Drop the right-side chevron — set for binary toggles where there's
   *  no menu to open and the chevron would mislead. */
  hideTrailingChevron?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.chip,
        active && styles.chipActive,
        disabled && { opacity: 0.5 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={13} color={active ? '#0F3F2E' : '#5F685F'} />
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
      {hideTrailingChevron ? null : (
        <Ionicons name="chevron-down" size={11} color={active ? '#0F3F2E' : '#A0A0A0'} />
      )}
    </Pressable>
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

  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    maxWidth: 180,
  },
  chipActive: {
    backgroundColor: '#DFE8D2',
    borderColor: '#0F3F2E',
  },
  chipText: { fontSize: 12, color: '#5F685F', fontWeight: '600' },
  chipTextActive: { color: '#0F3F2E' },
  clearBtn: { marginLeft: 'auto', paddingHorizontal: 6, paddingVertical: 4 },
  clearBtnText: { fontSize: 12, color: '#5F685F', fontWeight: '600' },

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
