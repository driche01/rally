/**
 * DecisionQueueCard — pinned decision-queue UI for the dashboard.
 *
 * Surfaces every pending poll_recommendation for a trip. Shows the
 * underlying poll title, vote breakdown, holdouts, and confidence.
 * Three actions per recommendation: Approve (locks + broadcasts SMS),
 * Hold (defer for more input), and Pick different option (override).
 *
 * The "first-class" treatment from the spec: this is the *first* card
 * below the progress card on the dashboard, so it's unmissable when
 * something needs the planner's attention.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  usePendingRecommendations,
  useApproveRecommendation,
  useApproveRecommendationWithDates,
  useHoldRecommendation,
  useUndoPollLock,
} from '@/hooks/useRecommendations';
import type { PollRecommendation } from '@/lib/api/recommendations';
import { DateHeatmap } from '@/components/trips/DateHeatmap';
import { parseDateRangeLabel } from '@/lib/pollFormUtils';

const UNDO_GRACE_MS = 5 * 60 * 1000;

interface Props {
  tripId: string | undefined;
}

function confidencePill(confidence: number | null): { label: string; tone: 'high' | 'mid' | 'low' | 'unknown' } {
  if (confidence === null) return { label: 'No data', tone: 'unknown' };
  if (confidence >= 0.5) return { label: 'High confidence', tone: 'high' };
  if (confidence >= 0.2) return { label: 'Medium confidence', tone: 'mid' };
  return { label: 'Low confidence', tone: 'low' };
}

export function DecisionQueueCard({ tripId }: Props) {
  const { data: recs = [] } = usePendingRecommendations(tripId);
  const approve = useApproveRecommendation(tripId);
  const approveDates = useApproveRecommendationWithDates(tripId);
  const hold = useHoldRecommendation(tripId);
  const undo = useUndoPollLock(tripId);
  // Open-state for the dates-pick calendar — keyed by recommendation id
  // so two date polls can be picked independently.
  const [datePickerForRec, setDatePickerForRec] = useState<PollRecommendation | null>(null);

  if (!tripId) return null;
  const pending = recs.filter((r) => r.status === 'pending');
  const held = recs.filter((r) => r.status === 'held');
  // Recently-locked items inside the 5-min undo grace window — give the
  // planner an undo affordance for fat-fingered locks.
  const recentlyLocked = recs.filter((r) => {
    if (r.status !== 'approved' && r.status !== 'edited') return false;
    if (!r.planner_action_at) return false;
    return Date.now() - new Date(r.planner_action_at).getTime() < UNDO_GRACE_MS;
  });
  if (pending.length === 0 && held.length === 0 && recentlyLocked.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="alert-circle" size={18} color="#D85A30" />
        <Text style={styles.title}>Pending decisions</Text>
        <Text style={styles.count}>· {pending.length}</Text>
      </View>

      {pending.map((rec) => (
        <RecommendationRow
          key={rec.id}
          rec={rec}
          onApprove={(overrideId) => handleApprove(rec, overrideId)}
          onHold={() => handleHold(rec)}
          onPickDates={() => setDatePickerForRec(rec)}
        />
      ))}

      {datePickerForRec ? (
        <DatesPickerModal
          rec={datePickerForRec}
          onClose={() => setDatePickerForRec(null)}
          onConfirm={(picks) => handleApproveDates(datePickerForRec, picks)}
        />
      ) : null}

      {recentlyLocked.length > 0 ? (
        <View style={styles.lockedSection}>
          <Text style={styles.lockedLabel}>Just locked · undo within 5 min</Text>
          {recentlyLocked.map((rec) => {
            const elapsed = rec.planner_action_at
              ? Math.max(0, Date.now() - new Date(rec.planner_action_at).getTime())
              : 0;
            const remainingSec = Math.max(0, Math.round((UNDO_GRACE_MS - elapsed) / 1000));
            const remainingLabel =
              remainingSec >= 60
                ? `${Math.floor(remainingSec / 60)}m ${String(remainingSec % 60).padStart(2, '0')}s`
                : `${remainingSec}s`;
            return (
              <View key={rec.id} style={styles.lockedRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lockedTitle} numberOfLines={1}>
                    {rec.poll_title ?? 'Decision'}
                  </Text>
                  <Text style={styles.lockedValue} numberOfLines={1}>
                    Locked: {rec.locked_value ?? '\u2014'}
                  </Text>
                  <Text style={styles.lockedRemaining}>
                    Undo window: {remainingLabel}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleUndo(rec)}
                  style={styles.undoBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Undo lock"
                >
                  <Ionicons name="arrow-undo" size={14} color="#9A2A2A" />
                  <Text style={styles.undoBtnText}>Undo</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      {held.length > 0 ? (
        <View style={styles.heldSection}>
          <Text style={styles.heldLabel}>On hold · tap to revisit</Text>
          {held.map((rec) => (
            <Pressable
              key={rec.id}
              style={styles.heldRow}
              onPress={() => handleHoldRevisit(rec)}
              accessibilityRole="button"
            >
              <Text style={styles.heldTitle} numberOfLines={1}>
                {rec.poll_title ?? 'Decision'}
              </Text>
              <Ionicons name="chevron-forward" size={14} color="#888" />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  function handleUndo(rec: PollRecommendation) {
    Alert.alert(
      'Undo lock?',
      `This re-opens "${rec.poll_title ?? 'this decision'}" and reverts the recommendation to pending. Note: the SMS that already went out can't be unsent — you may want to broadcast a follow-up.`,
      [
        { text: 'Keep locked', style: 'cancel' },
        {
          text: 'Undo',
          style: 'destructive',
          onPress: async () => {
            const r = await undo.mutateAsync(rec.id);
            if (!r.ok) {
              Alert.alert(
                'Could not undo',
                r.reason === 'grace_expired' ? 'The 5-minute undo window has passed.'
                  : r.reason ?? 'Try again.',
              );
            }
          },
        },
      ],
    );
  }

  function handleApproveDates(rec: PollRecommendation, picks: string[]) {
    if (picks.length === 0) {
      Alert.alert('Pick at least one date', 'Tap days on the calendar to lock in.');
      return;
    }
    const sorted = [...picks].sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const summary =
      sorted.length === 1
        ? friendlyDateLabel(first)
        : isConsecutive(sorted)
          ? `${friendlyDateLabel(first)} – ${friendlyDateLabel(last)}`
          : sorted.map(friendlyDateLabel).join(', ');
    Alert.alert(
      `Lock in "${summary}"?`,
      'Rally will text everyone with the locked dates. This is undoable from the polls screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Lock in',
          onPress: async () => {
            const r = await approveDates.mutateAsync({ recommendationId: rec.id, dates: sorted });
            if (!r.ok) Alert.alert('Could not lock in', r.reason ?? 'Try again.');
            else setDatePickerForRec(null);
          },
        },
      ],
    );
  }

  function handleApprove(rec: PollRecommendation, overrideId?: string | null) {
    const label =
      overrideId
        ? rec.poll_options.find((o) => o.id === overrideId)?.label
        : rec.locked_value || (rec.recommended_option_id
            ? rec.poll_options.find((o) => o.id === rec.recommended_option_id)?.label
            : null);
    if (!label) {
      Alert.alert('Pick an option', "There's no recommended option to lock yet.");
      return;
    }
    Alert.alert(
      `Lock in "${label}"?`,
      'Rally will text everyone with the locked decision. This is undoable from the polls screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Lock in',
          onPress: async () => {
            const r = await approve.mutateAsync({ recommendationId: rec.id, overrideOptionId: overrideId ?? null });
            if (!r.ok) Alert.alert('Could not lock in', r.reason ?? 'Try again.');
          },
        },
      ],
    );
  }

  function handleHold(rec: PollRecommendation) {
    Alert.alert(
      'Hold for more input?',
      "Rally will leave this decision open. You'll see it back here when you're ready.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hold',
          onPress: async () => {
            const r = await hold.mutateAsync({ recommendationId: rec.id, holdUntil: null });
            if (!r.ok) Alert.alert('Could not hold', r.reason ?? 'Try again.');
          },
        },
      ],
    );
  }

  function handleHoldRevisit(rec: PollRecommendation) {
    Alert.alert(
      rec.poll_title ?? 'Decision',
      `${rec.recommendation_text}\n\nApprove now or keep on hold?`,
      [
        { text: 'Keep on hold', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () => handleApprove(rec, null),
        },
      ],
    );
  }
}

interface RowProps {
  rec: PollRecommendation;
  onApprove: (overrideOptionId?: string | null) => void;
  onHold: () => void;
  onPickDates: () => void;
}

function RecommendationRow({ rec, onApprove, onHold, onPickDates }: RowProps) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const conf = confidencePill(rec.confidence);
  const isDatesPoll = rec.poll_type === 'dates';

  return (
    <View style={styles.recRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.pollTitle} numberOfLines={2}>
          {rec.poll_title ?? 'Decision'}
        </Text>
        <Text style={styles.recText} numberOfLines={3}>
          {rec.recommendation_text}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.confidencePill, styles[`conf_${conf.tone}` as const]]}>
            <Text style={[styles.confidenceText, styles[`confText_${conf.tone}` as const]]}>{conf.label}</Text>
          </View>
          {rec.holdout_participant_ids.length > 0 ? (
            <Text style={styles.holdoutText}>
              {rec.holdout_participant_ids.length} {rec.holdout_participant_ids.length === 1 ? 'holdout' : 'holdouts'}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.recActions}>
        <Pressable
          onPress={() => onApprove(null)}
          style={[styles.btn, styles.btnPrimary]}
          accessibilityRole="button"
          accessibilityLabel="Approve recommendation"
        >
          <Text style={styles.btnPrimaryText}>Approve</Text>
        </Pressable>
        <Pressable
          onPress={onHold}
          style={[styles.btn, styles.btnSecondary]}
          accessibilityRole="button"
          accessibilityLabel="Hold for more input"
        >
          <Text style={styles.btnSecondaryText}>Hold</Text>
        </Pressable>
        {isDatesPoll ? (
          <Pressable
            onPress={onPickDates}
            style={[styles.btn, styles.btnSecondary]}
            accessibilityRole="button"
            accessibilityLabel="Pick dates from calendar"
          >
            <Text style={styles.btnSecondaryText}>Pick</Text>
          </Pressable>
        ) : rec.poll_options.length > 1 ? (
          <Pressable
            onPress={() => setOverrideOpen((v) => !v)}
            style={[styles.btn, styles.btnSecondary]}
            accessibilityRole="button"
            accessibilityLabel="Pick different option"
          >
            <Text style={styles.btnSecondaryText}>{overrideOpen ? 'Close' : 'Pick'}</Text>
          </Pressable>
        ) : null}
      </View>

      {overrideOpen && !isDatesPoll ? (
        <View style={styles.overrideList}>
          {rec.poll_options.map((opt) => {
            const isRecommended = opt.id === rec.recommended_option_id;
            const votes = rec.vote_breakdown[opt.id] ?? 0;
            return (
              <Pressable
                key={opt.id}
                style={[styles.overrideRow, isRecommended && styles.overrideRowRecommended]}
                onPress={() => {
                  setOverrideOpen(false);
                  onApprove(opt.id);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.overrideLabel} numberOfLines={1}>
                  {opt.label}
                </Text>
                <Text style={styles.overrideVotes}>
                  {votes} {votes === 1 ? 'vote' : 'votes'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ─── Dates picker modal ───────────────────────────────────────────────────────

interface DatesPickerProps {
  rec: PollRecommendation;
  onConfirm: (picks: string[]) => void;
  onClose: () => void;
}

/**
 * Picker shown when the planner taps "Pick" on a dates-poll
 * recommendation. The picker is intentionally constrained to the days
 * that exist as poll options — the planner can only lock in dates
 * the group actually voted on. The DateHeatmap visualization makes
 * the vote density visible per day so the planner has direct signal
 * for which dates suit the group best.
 */
function DatesPickerModal({ rec, onConfirm, onClose }: DatesPickerProps) {
  const insets = useSafeAreaInsets();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Map option-id → ISO date so we can return ISO dates on confirm.
  const optionIdToIso = useMemo(() => {
    const m = new Map<string, string>();
    for (const opt of rec.poll_options) {
      const r = parseDateRangeLabel(opt.label);
      if (!r) continue;
      const sameDay =
        r.start.getFullYear() === r.end.getFullYear() &&
        r.start.getMonth() === r.end.getMonth() &&
        r.start.getDate() === r.end.getDate();
      if (!sameDay) continue;
      m.set(opt.id, isoFromDate(r.start));
    }
    return m;
  }, [rec.poll_options]);

  const totalSelectableDays = optionIdToIso.size;

  function toggle(optionId: string) {
    setSelectedIds((prev) =>
      prev.includes(optionId) ? prev.filter((x) => x !== optionId) : [...prev, optionId],
    );
  }

  function handleClear() {
    setSelectedIds([]);
  }

  function handleConfirm() {
    const dates = selectedIds
      .map((id) => optionIdToIso.get(id))
      .filter((x): x is string => Boolean(x))
      .sort();
    onConfirm(dates);
  }

  const summary =
    selectedIds.length === 0
      ? `Tap days to lock in. Shaded days have ${totalSelectableDays === 1 ? 'a vote' : 'votes'} — darker = more.`
      : `${selectedIds.length} of ${totalSelectableDays} polled day${totalSelectableDays === 1 ? '' : 's'} selected`;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[pickerStyles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <View style={pickerStyles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={pickerStyles.cancelBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={pickerStyles.title}>Pick the trip dates</Text>
          <TouchableOpacity
            onPress={handleClear}
            hitSlop={8}
            disabled={selectedIds.length === 0}
          >
            <Text style={[pickerStyles.clearBtn, selectedIds.length === 0 && { color: '#A0C0B2' }]}>
              Clear
            </Text>
          </TouchableOpacity>
        </View>

        <View style={pickerStyles.summary}>
          <Text style={pickerStyles.summaryText}>{summary}</Text>
          <Text style={pickerStyles.summarySub}>
            Only days the group voted on are tappable.
          </Text>
        </View>

        <View style={pickerStyles.heatmapWrap}>
          <DateHeatmap
            options={rec.poll_options}
            counts={rec.vote_breakdown}
            selectable
            selectedIds={selectedIds}
            onToggle={toggle}
          />
        </View>

        <View style={pickerStyles.footer}>
          <TouchableOpacity
            style={[pickerStyles.confirmBtn, selectedIds.length === 0 && pickerStyles.confirmBtnDisabled]}
            onPress={handleConfirm}
            disabled={selectedIds.length === 0}
            activeOpacity={0.8}
          >
            <Text style={pickerStyles.confirmText}>
              Lock these dates{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const pickerStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFCF6' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  cancelBtn: { fontSize: 16, color: '#5F685F' },
  clearBtn: { fontSize: 16, color: '#0F3F2E' },
  title: { fontSize: 17, fontWeight: '600', color: '#163026', flex: 1, textAlign: 'center', paddingHorizontal: 8 },
  summary: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#0F3F2E',
    backgroundColor: '#DFE8D2',
  },
  summaryText: { fontSize: 14, fontWeight: '700', color: '#163026' },
  summarySub: { fontSize: 12, color: '#5F685F', marginTop: 2 },
  heatmapWrap: { paddingHorizontal: 20, flex: 1 },
  footer: { paddingHorizontal: 20, paddingTop: 16 },
  confirmBtn: {
    backgroundColor: '#0F3F2E',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: '#A0C0B2' },
  confirmText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** ISO 'YYYY-MM-DD' → 'Jun 17' style label. */
function friendlyDateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function isConsecutive(sortedIsoDays: string[]): boolean {
  for (let i = 1; i < sortedIsoDays.length; i++) {
    const prev = new Date(sortedIsoDays[i - 1] + 'T12:00:00').getTime();
    const curr = new Date(sortedIsoDays[i] + 'T12:00:00').getTime();
    if (Math.round((curr - prev) / 86400000) !== 1) return false;
  }
  return true;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF7F2',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#F4D5C5',
    padding: 14,
    marginBottom: 18,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '700', color: '#163026' },
  count: { fontSize: 13, color: '#D85A30', fontWeight: '600' },

  recRow: {
    backgroundColor: 'white',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EFE3D0',
    padding: 12,
    gap: 8,
  },
  pollTitle: { fontSize: 14, fontWeight: '700', color: '#163026' },
  recText: { fontSize: 13, color: '#404040', lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 },

  confidencePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  confidenceText: { fontSize: 11, fontWeight: '700' },
  conf_high:    { backgroundColor: '#DFE8D2' },
  confText_high:    { color: '#1D9E75' },
  conf_mid:     { backgroundColor: '#FCEFD6' },
  confText_mid:     { color: '#92400E' },
  conf_low:     { backgroundColor: '#FEE0DA' },
  confText_low:     { color: '#9A2A2A' },
  conf_unknown: { backgroundColor: '#EFE3D0' },
  confText_unknown: { color: '#5F685F' },

  holdoutText: { fontSize: 11, color: '#888' },

  recActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  btnPrimary: { backgroundColor: '#0F3F2E' },
  btnPrimaryText: { fontSize: 13, fontWeight: '700', color: 'white' },
  btnSecondary: { backgroundColor: '#EFE3D0' },
  btnSecondaryText: { fontSize: 13, fontWeight: '600', color: '#0F3F2E' },

  overrideList: { gap: 6, marginTop: 6 },
  overrideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAF5EA',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  overrideRowRecommended: { borderWidth: 1, borderColor: '#0F3F2E' },
  overrideLabel: { fontSize: 13, fontWeight: '600', color: '#163026', flex: 1 },
  overrideVotes: { fontSize: 12, color: '#888' },

  heldSection: { borderTopWidth: 1, borderTopColor: '#F4D5C5', paddingTop: 8 },
  heldLabel: { fontSize: 11, color: '#888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  heldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  heldTitle: { fontSize: 13, color: '#404040', flex: 1 },

  lockedSection: {
    borderTopWidth: 1,
    borderTopColor: '#F4D5C5',
    paddingTop: 8,
    gap: 6,
  },
  lockedLabel: {
    fontSize: 11,
    color: '#9A2A2A',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'white',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  lockedTitle: { fontSize: 13, fontWeight: '700', color: '#163026' },
  lockedValue: { fontSize: 12, color: '#404040', marginTop: 1 },
  lockedRemaining: { fontSize: 11, color: '#9A2A2A', marginTop: 2, fontVariant: ['tabular-nums'] },
  undoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEE0DA',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  undoBtnText: { fontSize: 12, fontWeight: '700', color: '#9A2A2A' },
});
