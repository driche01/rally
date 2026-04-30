/**
 * CadenceCard — surfaces the autonomous nudge schedule on the dashboard.
 *
 * Rally's autonomy only earns trust if the planner can see what it's
 * about to do. This card shows: the next scheduled nudge, the upcoming
 * schedule, and three controls (send-now, skip-next, view-all).
 *
 * Sourced from the nudge_sends table populated by sms-nudge-scheduler.
 * If no rows exist yet (book_by not set, no participants), renders an
 * empty hint instead of nothing.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatCadenceDate, nudgeKindLabel, type NudgeKind } from '@/lib/cadence';
import {
  useNudgeSchedule,
  useSendNudgeNow,
  useSkipNextNudge,
} from '@/hooks/useTripSession';
import type { NudgeScheduleItem } from '@/lib/api/dashboard';

interface Props {
  sessionId: string | undefined;
  /** When true, hides the card if there are no scheduled nudges (instead of showing the empty hint). */
  hideWhenEmpty?: boolean;
}

function relativeTimeFromNow(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) {
    const ago = Math.abs(ms);
    if (ago < 3600_000) return `${Math.round(ago / 60_000)}m overdue`;
    if (ago < 86_400_000) return `${Math.round(ago / 3600_000)}h overdue`;
    return `${Math.round(ago / 86_400_000)}d overdue`;
  }
  if (ms < 3600_000) return `in ${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `in ${Math.round(ms / 3600_000)}h`;
  return `in ${Math.round(ms / 86_400_000)}d`;
}

export function CadenceCard({ sessionId, hideWhenEmpty }: Props) {
  const { data: schedule = [] } = useNudgeSchedule(sessionId);
  const sendNow = useSendNudgeNow(sessionId);
  const skipNext = useSkipNextNudge(sessionId);
  const [expanded, setExpanded] = useState(false);

  const pending = useMemo(
    () => schedule.filter((s) => !s.sent_at && !s.skipped_at),
    [schedule],
  );
  const next = pending[0] ?? null;
  const upcoming = pending.slice(0, 8);

  if (!sessionId) return null;
  if (pending.length === 0 && hideWhenEmpty) return null;

  if (pending.length === 0) {
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="time-outline" size={16} color="#163026" />
          <Text style={styles.title}>Nudge schedule</Text>
        </View>
        <Text style={styles.empty}>
          No nudges scheduled yet. Set a book-by date and add participants — Rally will text them on a deterministic cadence.
        </Text>
      </View>
    );
  }

  function handleSendNow() {
    Alert.alert(
      'Send the next nudge now?',
      `Rally will text ${next?.participant_name ?? next?.participant_phone ?? 'this participant'} their next nudge in the next minute.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send now',
          onPress: async () => {
            const r = await sendNow.mutateAsync(null);
            if (!r.ok) Alert.alert('Could not send', r.reason ?? 'Try again.');
          },
        },
      ],
    );
  }

  function handleSkipNext() {
    Alert.alert(
      'Skip the next nudge?',
      `${nudgeKindLabel((next?.nudge_type ?? 'd1') as NudgeKind)} for ${next?.participant_name ?? 'this person'} won't be sent. The rest of the cadence stays scheduled.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          style: 'destructive',
          onPress: async () => {
            const r = await skipNext.mutateAsync(null);
            if (!r.ok) Alert.alert('Could not skip', r.reason ?? 'Try again.');
          },
        },
      ],
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Ionicons name="time-outline" size={16} color="#163026" />
        <Text style={styles.title}>Nudge schedule</Text>
        <Text style={styles.count}>· {pending.length} upcoming</Text>
      </View>

      {next ? (
        <View style={styles.nextRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.nextLabel}>Next</Text>
            <Text style={styles.nextTitle}>
              {nudgeKindLabel(next.nudge_type as NudgeKind)} · {next.participant_name ?? next.participant_phone ?? 'unknown'}
            </Text>
            <Text style={styles.nextWhen}>
              {formatCadenceDate(next.scheduled_for)} · {relativeTimeFromNow(next.scheduled_for)}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable onPress={handleSendNow} style={styles.actionBtn} accessibilityRole="button">
          <Ionicons name="paper-plane-outline" size={14} color="#0F3F2E" />
          <Text style={styles.actionText}>Send now</Text>
        </Pressable>
        <Pressable onPress={handleSkipNext} style={styles.actionBtn} accessibilityRole="button">
          <Ionicons name="play-skip-forward-outline" size={14} color="#0F3F2E" />
          <Text style={styles.actionText}>Skip next</Text>
        </Pressable>
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={styles.actionBtn}
          accessibilityRole="button"
        >
          <Ionicons name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'} size={14} color="#0F3F2E" />
          <Text style={styles.actionText}>{expanded ? 'Hide' : 'View all'}</Text>
        </Pressable>
      </View>

      {expanded ? (
        <View style={styles.scheduleList}>
          {upcoming.map((it: NudgeScheduleItem, i) => (
            <View
              key={it.id}
              style={[styles.scheduleRow, i < upcoming.length - 1 && styles.scheduleRowBorder]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.scheduleKind}>
                  {nudgeKindLabel(it.nudge_type as NudgeKind)}
                </Text>
                <Text style={styles.scheduleParticipant} numberOfLines={1}>
                  {it.participant_name ?? it.participant_phone ?? 'all participants'}
                </Text>
              </View>
              <Text style={styles.scheduleWhen}>{formatCadenceDate(it.scheduled_for)}</Text>
            </View>
          ))}
          {pending.length > upcoming.length ? (
            <Text style={styles.scheduleFooter}>
              + {pending.length - upcoming.length} more
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFCF6',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8DFC8',
    padding: 14,
    marginBottom: 18,
    gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '700', color: '#163026' },
  count: { fontSize: 13, color: '#888' },
  empty: { fontSize: 13, color: '#666', lineHeight: 19 },

  nextRow: {
    backgroundColor: '#FAF5EA',
    borderRadius: 10,
    padding: 12,
  },
  nextLabel: { fontSize: 11, color: '#888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  nextTitle: { fontSize: 14, fontWeight: '700', color: '#163026', marginTop: 2 },
  nextWhen: { fontSize: 12, color: '#5F685F', marginTop: 2 },

  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DFE8D2',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionText: { fontSize: 12, fontWeight: '600', color: '#0F3F2E' },

  scheduleList: { marginTop: 4 },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  scheduleRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFE3D0',
  },
  scheduleKind: { fontSize: 13, fontWeight: '600', color: '#163026' },
  scheduleParticipant: { fontSize: 12, color: '#666', marginTop: 1 },
  scheduleWhen: { fontSize: 12, color: '#5F685F' },
  scheduleFooter: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    paddingTop: 6,
  },
});
