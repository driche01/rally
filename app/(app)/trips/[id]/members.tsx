/**
 * Group Dashboard — replaces the legacy "Members" roster.
 *
 * Phase 4 of the 1:1 SMS pivot. Sourced primarily from
 * trip_session_participants (the SMS-active humans). Falls back to
 * respondents-only mode when no trip_session exists yet (web-only trip
 * with poll responses but no SMS handshake). Adds a planner-only
 * broadcast composer that fans a message to every active+attending
 * participant via the sms-broadcast edge function.
 *
 * Route stays `/(app)/trips/[id]/members` so existing navigation works.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui';
import {
  useRespondents,
  useSetRespondentPlanner,
  useCreateRespondentManually,
  useDeleteRespondent,
} from '@/hooks/useRespondents';
import {
  useTripSession,
  useSessionParticipants,
  useBroadcastToSession,
  useRemoveSessionParticipant,
  useSessionActivity,
} from '@/hooks/useTripSession';
import type { ActivityItem } from '@/lib/api/dashboard';
import { useTrip } from '@/hooks/useTrips';
import { usePermissions } from '@/hooks/usePermissions';
import { useProfile } from '@/hooks/useProfile';
import { useAuthStore } from '@/stores/authStore';
import { getShareUrl } from '@/lib/api/trips';
import { getTripStage, STAGE_ACCENT } from '@/lib/tripStage';
import { capture } from '@/lib/analytics';
import { GROUP_SIZE_MIDPOINTS } from '@/types/database';
import type { Respondent, TripSessionParticipant } from '@/types/database';
import { normalizePhone } from '@/lib/phone';

// ─── Swipeable row helper (preserved from legacy screen) ───────────────────────

function DeleteAction({ onPress, label = 'Remove' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center', width: 80 }}
      accessibilityRole="button"
      accessibilityLabel={`${label} member`}
    >
      <Ionicons name="trash-outline" size={20} color="white" />
      <Text style={{ color: 'white', fontSize: 11, fontWeight: '600', marginTop: 3 }}>{label}</Text>
    </Pressable>
  );
}

function SwipeRow({
  children,
  canManage,
  onPress,
  onDelete,
  style,
}: {
  children: React.ReactNode;
  canManage: boolean;
  onPress?: () => void;
  onDelete?: (ref: React.RefObject<Swipeable>) => void;
  style?: any;
}) {
  const swipeRef = useRef<Swipeable>(null);
  return (
    <Swipeable
      ref={swipeRef as any}
      renderRightActions={onDelete ? () => <DeleteAction onPress={() => onDelete(swipeRef as any)} /> : undefined}
      overshootRight={false}
      friction={2}
    >
      <Pressable onPress={onPress} style={style} accessibilityRole={canManage ? 'button' : 'none'}>
        {children}
      </Pressable>
    </Swipeable>
  );
}

// ─── Phase / state badge helpers ───────────────────────────────────────────────

function StatusBadge({ kind }: { kind: 'attending' | 'not_going' | 'opted_out' | 'committed' | 'flight_booked' }) {
  const map = {
    attending:    { bg: '#EAF3EC', fg: '#235C38', label: 'In' },
    not_going:    { bg: '#F0F0F0', fg: '#888',    label: 'Not going' },
    opted_out:    { bg: '#FCE8E8', fg: '#9A2A2A', label: 'Opted out' },
    committed:    { bg: '#E1EEF7', fg: '#1F4E79', label: 'Committed' },
    flight_booked:{ bg: '#E8F4EE', fg: '#235C38', label: 'Flight booked' },
  } as const;
  const c = map[kind];
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: c.fg }}>{c.label}</Text>
    </View>
  );
}

function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function humanPhase(phase: string | null): string {
  if (!phase) return '';
  return phase.replace(/_/g, ' ').toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatActivity(item: ActivityItem): string {
  if (item.kind === 'broadcast') {
    const trimmed = item.body.length > 110 ? item.body.slice(0, 110) + '…' : item.body;
    return `Planner texted the group: "${trimmed}"`;
  }
  if (item.kind === 'phase') {
    const to = humanPhase(item.to_phase);
    return to ? `Trip moved to ${to}` : 'Phase advanced';
  }
  // join
  const who = item.display_name ?? item.phone;
  return `${who} joined`;
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function GroupDashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: trip } = useTrip(id);
  const accentColor = STAGE_ACCENT[trip ? getTripStage(trip) : 'deciding'];
  const { data: respondents = [] } = useRespondents(id);
  const { data: tripSession } = useTripSession(id);
  const { data: participants = [] } = useSessionParticipants(tripSession?.id);
  const { data: activity = [] } = useSessionActivity(tripSession?.id);
  const { canDesignatePlanners } = usePermissions(id);
  const setPlanner = useSetRespondentPlanner(id);
  const deleteRespondent = useDeleteRespondent(id);
  const removeParticipant = useRemoveSessionParticipant(tripSession?.id);
  const broadcastMutation = useBroadcastToSession(tripSession?.id);
  const currentUser = useAuthStore((s) => s.user);
  const { data: plannerProfile } = useProfile(trip?.created_by);

  // Add-member modal (preserved)
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addFirstName, setAddFirstName] = useState('');
  const [addLastName, setAddLastName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const createMember = useCreateRespondentManually(id);

  // Broadcast composer
  const [broadcastVisible, setBroadcastVisible] = useState(false);
  const [broadcastBody, setBroadcastBody] = useState('');
  const [lastSent, setLastSent] = useState<{ count: number; ts: number } | null>(null);

  function handleAddMember() {
    const firstName = addFirstName.trim();
    const lastName = addLastName.trim();
    const name = [firstName, lastName].filter(Boolean).join(' ');
    const email = addEmail.trim();
    const phone = addPhone.trim();
    if (!firstName || !email || !phone) {
      Alert.alert('Required fields', 'Please fill in first name, email, and phone number.');
      return;
    }
    createMember.mutate({ name, email, phone }, {
      onSuccess: () => {
        setAddModalVisible(false);
        setAddFirstName(''); setAddLastName(''); setAddEmail(''); setAddPhone('');
      },
      onError: (e: unknown) => Alert.alert('Could not add member', e instanceof Error ? e.message : 'Please try again.'),
    });
  }

  // Match respondents to participants by normalized phone for badge merging.
  const respondentByPhone = useMemo(() => {
    const map = new Map<string, Respondent>();
    for (const r of respondents) {
      const norm = normalizePhone(r.phone ?? '');
      if (norm) map.set(norm, r);
    }
    return map;
  }, [respondents]);

  const participantPhones = useMemo(
    () => new Set(participants.map((p) => p.phone)),
    [participants],
  );

  // Respondents who haven't done the SMS handshake — shown in the secondary section.
  const orphanRespondents = useMemo(() => {
    return respondents.filter((r) => {
      const norm = normalizePhone(r.phone ?? '');
      if (!norm) return true; // no phone — definitely not in participants
      return !participantPhones.has(norm);
    });
  }, [respondents, participantPhones]);

  // Sort participants: planner first, then by joined_at.
  const sortedParticipants = useMemo(() => {
    return [...participants].sort((a, b) => {
      if (a.is_planner !== b.is_planner) return a.is_planner ? -1 : 1;
      return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
    });
  }, [participants]);

  // Active participants = exclude opted_out / removed_by_planner for "X people will receive" copy.
  const activeAttendingCount = participants.filter(
    (p) => p.status === 'active' && p.is_attending,
  ).length;

  // Counts for the progress card (legacy + participants merged)
  const isCreator = !!trip && !!currentUser && trip.created_by === currentUser.id;
  const plannerName = plannerProfile
    ? [plannerProfile.name, (plannerProfile as any).last_name].filter(Boolean).join(' ')
    : isCreator
      ? [currentUser?.user_metadata?.name, currentUser?.user_metadata?.last_name].filter(Boolean).join(' ')
      : '';
  const plannerEmail = (plannerProfile as any)?.email ?? (isCreator ? currentUser?.email : '') ?? '';
  const showPlanner = !!(plannerName || plannerEmail);
  const total = trip ? (trip.group_size_precise ?? GROUP_SIZE_MIDPOINTS[trip.group_size_bucket]) : 0;
  const joinUrl = trip ? getShareUrl(trip.share_token) : '';
  const memberCount = (showPlanner ? 1 : 0) + Math.max(participants.length, respondents.length);
  const confirmedCount = participants.length > 0
    ? activeAttendingCount + (showPlanner && !participants.some((p) => p.is_planner) ? 1 : 0)
    : (showPlanner ? 1 : 0) + respondents.filter((r) => r.rsvp === 'in').length;
  const joinPercent = total > 0 ? Math.min(100, Math.round((confirmedCount / total) * 100)) : 0;

  async function handleCopyLink() {
    await Clipboard.setStringAsync(joinUrl);
    Alert.alert('Copied!', 'Invite link copied to clipboard.');
  }
  async function handleShare() {
    try { await Share.share({ message: `Join our trip on Rally: ${joinUrl}` }); } catch {}
  }

  // Broadcast send flow
  function handleOpenBroadcast() {
    setBroadcastVisible(true);
  }
  async function handleSendBroadcast() {
    const body = broadcastBody.trim();
    if (!body) return;
    // Native Alert (not a nested Modal — iOS won't present a Modal over a
    // Modal). Alerts overlay on a separate presentation layer.
    Alert.alert(
      `Send to ${activeAttendingCount} ${activeAttendingCount === 1 ? 'person' : 'people'}?`,
      body.length > 240 ? body.slice(0, 240) + '…' : body,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => doSendBroadcast(body) },
      ],
    );
  }
  async function doSendBroadcast(body: string) {
    const result = await broadcastMutation.mutateAsync(body);
    if (!result.ok) {
      Alert.alert(
        'Broadcast failed',
        result.reason === 'forbidden'
          ? 'Only the planner can broadcast.'
          : `Couldn't send: ${result.reason ?? 'unknown error'}`,
      );
      return;
    }
    setBroadcastBody('');
    setBroadcastVisible(false);
    setLastSent({ count: result.sent ?? 0, ts: Date.now() });
    capture('dashboard_broadcast_sent', { trip_id: id, sent: result.sent });
  }

  // Per-participant remove flow
  function handleRemoveParticipant(p: TripSessionParticipant, swipeRef: React.RefObject<Swipeable>) {
    swipeRef.current?.close();
    Alert.alert(
      'Remove member?',
      `${p.display_name ?? p.phone} will be removed from this trip. They won't receive further messages.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const r = await removeParticipant.mutateAsync(p.id);
            if (!r.ok) {
              Alert.alert(
                'Could not remove',
                r.reason === 'planner_must_transfer_first'
                  ? 'Transfer the planner role first, then try again.'
                  : r.reason ?? 'Try again.',
              );
            }
          },
        },
      ],
    );
  }

  function handleParticipantTap(p: TripSessionParticipant) {
    if (!canDesignatePlanners) return;
    // Reuse the respondent-side promote/demote logic when a matching respondent exists.
    const norm = normalizePhone(p.phone) ?? '';
    const respondent = respondentByPhone.get(norm);
    if (!respondent) {
      Alert.alert(
        p.display_name ?? p.phone,
        'This participant joined via the SMS link. Promote/demote planner is available once they\'ve also responded to a poll.',
      );
      return;
    }
    if (respondent.is_planner) {
      Alert.alert(
        respondent.name,
        "Remove planner access? They'll no longer be able to edit polls and trip details.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove planner',
            style: 'destructive',
            onPress: () => setPlanner.mutate(
              { respondentId: respondent.id, isPlanner: false },
              { onError: () => Alert.alert('Error', 'Could not update planner status.') },
            ),
          },
        ],
      );
    } else {
      Alert.alert(
        `Make ${respondent.name} a planner?`,
        "They'll be able to edit polls and trip details.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Make planner',
            onPress: () => setPlanner.mutate(
              { respondentId: respondent.id, isPlanner: true },
              { onError: () => Alert.alert('Error', 'Could not update planner status.') },
            ),
          },
        ],
      );
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text style={[styles.backBtn, { color: accentColor }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Group</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Progress card */}
        <View style={styles.progressCard}>
          <View style={styles.progressRow}>
            <Text style={styles.progressTitle}>{confirmedCount} of {total} in</Text>
            <Text style={styles.progressPct}>{joinPercent}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${joinPercent}%`, backgroundColor: accentColor }]} />
          </View>

          <View style={styles.linkRow}>
            <Ionicons name="link-outline" size={14} color="#888" />
            <Text style={styles.linkText} numberOfLines={1}>{joinUrl}</Text>
            <Pressable onPress={handleCopyLink} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy link">
              <Ionicons name="copy-outline" size={16} color="#888" />
            </Pressable>
          </View>

          <Pressable onPress={handleShare} style={[styles.shareBtn, { borderColor: accentColor }]} accessibilityRole="button">
            <Ionicons name="share-outline" size={15} color={accentColor} />
            <Text style={[styles.shareBtnText, { color: accentColor }]}>Share invite link</Text>
          </Pressable>
        </View>

        {/* Participants section — primary list when SMS session exists */}
        {tripSession && sortedParticipants.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>
              {sortedParticipants.length} {sortedParticipants.length === 1 ? 'PARTICIPANT' : 'PARTICIPANTS'}
            </Text>
            <View style={styles.listCard}>
              {sortedParticipants.map((p, i) => {
                const norm = normalizePhone(p.phone) ?? '';
                const respondent = respondentByPhone.get(norm);
                const lastActive = relativeTime((p as any).updated_at ?? p.joined_at);
                return (
                  <SwipeRow
                    key={p.id}
                    canManage={canDesignatePlanners}
                    onPress={canDesignatePlanners ? () => handleParticipantTap(p) : undefined}
                    onDelete={canDesignatePlanners && !p.is_planner
                      ? (ref) => handleRemoveParticipant(p, ref as any)
                      : undefined}
                    style={[styles.row, i < sortedParticipants.length - 1 && styles.rowBorder]}
                  >
                    <View style={styles.avatarWrap}>
                      {p.is_planner ? (
                        <Ionicons name="ribbon" size={13} color="#D97706" style={styles.crownIcon} />
                      ) : null}
                      <Avatar name={p.display_name ?? p.phone} size="md" />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={styles.nameRow}>
                        <Text style={styles.name}>{p.display_name ?? p.phone}</Text>
                        {p.status === 'opted_out' || p.status === 'removed_by_planner' ? (
                          <StatusBadge kind="opted_out" />
                        ) : !p.is_attending ? (
                          <StatusBadge kind="not_going" />
                        ) : p.flight_status === 'confirmed' ? (
                          <StatusBadge kind="flight_booked" />
                        ) : p.committed ? (
                          <StatusBadge kind="committed" />
                        ) : (
                          <StatusBadge kind="attending" />
                        )}
                      </View>
                      {respondent?.email ? (
                        <View style={styles.contactRow}>
                          <Ionicons name="mail-outline" size={12} color="#888" />
                          <Text style={styles.contactText}>{respondent.email}</Text>
                        </View>
                      ) : null}
                      <View style={styles.contactRow}>
                        <Ionicons name="call-outline" size={12} color="#888" />
                        <Text style={styles.contactText}>{p.phone}</Text>
                      </View>
                      {lastActive ? (
                        <Text style={styles.metaText}>Joined {lastActive}</Text>
                      ) : null}
                    </View>
                    {canDesignatePlanners ? (
                      <Ionicons name="ellipsis-horizontal" size={16} color="#CCC" />
                    ) : null}
                  </SwipeRow>
                );
              })}
            </View>
            {canDesignatePlanners ? (
              <Text style={styles.plannerHint}>Tap a participant to manage planner access · Swipe to remove</Text>
            ) : null}
          </>
        ) : null}

        {/* Also-responding section: respondents without a participant row */}
        {orphanRespondents.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>
              ALSO RESPONDING VIA WEB · {orphanRespondents.length}
            </Text>
            <View style={styles.listCard}>
              {orphanRespondents.map((r, i) => (
                <View key={r.id} style={[styles.row, i < orphanRespondents.length - 1 && styles.rowBorder]}>
                  <View style={styles.avatarWrap}>
                    {r.is_planner ? (
                      <Ionicons name="ribbon" size={13} color="#D97706" style={styles.crownIcon} />
                    ) : null}
                    <Avatar name={r.name} size="md" />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={styles.nameRow}>
                      <Text style={styles.name}>{r.name}</Text>
                      {r.rsvp === 'in' ? <StatusBadge kind="attending" /> : null}
                    </View>
                    {r.email ? (
                      <View style={styles.contactRow}>
                        <Ionicons name="mail-outline" size={12} color="#888" />
                        <Text style={styles.contactText}>{r.email}</Text>
                      </View>
                    ) : null}
                    {r.phone ? (
                      <View style={styles.contactRow}>
                        <Ionicons name="call-outline" size={12} color="#888" />
                        <Text style={styles.contactText}>{r.phone}</Text>
                      </View>
                    ) : null}
                    <Text style={styles.metaText}>Hasn't joined the SMS thread yet</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* Activity timeline (Phase 4.5) */}
        {tripSession && activity.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>ACTIVITY</Text>
            <View style={styles.listCard}>
              {activity.map((item, i) => (
                <View
                  key={`${item.kind}-${item.timestamp}-${i}`}
                  style={[styles.activityRow, i < activity.length - 1 && styles.rowBorder]}
                >
                  <View style={styles.activityIcon}>
                    <Ionicons
                      name={
                        item.kind === 'broadcast' ? 'megaphone-outline'
                          : item.kind === 'phase' ? 'arrow-forward-circle-outline'
                          : 'person-add-outline'
                      }
                      size={16}
                      color="#888"
                    />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.activityText}>{formatActivity(item)}</Text>
                    <Text style={styles.activityTime}>{relativeTime(item.timestamp) ?? ''}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* Empty state */}
        {!tripSession && respondents.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={40} color="#C0C0C0" />
            <Text style={styles.emptyTitle}>No one in yet</Text>
            <Text style={styles.emptySubtitle}>
              Share the link above. Friends fill it out, reply YES to confirm, and they show up here.
            </Text>
          </View>
        ) : null}

        {/* Add member CTA */}
        {canDesignatePlanners ? (
          <Pressable
            onPress={() => setAddModalVisible(true)}
            style={{
              alignItems: 'center', justifyContent: 'center', gap: 4,
              paddingVertical: 20, borderRadius: 16,
              borderWidth: 2, borderStyle: 'dashed', borderColor: '#E5E5E5',
              marginTop: 12,
            }}
          >
            <Ionicons name="add-circle-outline" size={18} color="#D4D4D4" />
            <Text style={{ fontSize: 12, color: '#D0D0D0' }}>Tap to add a member manually</Text>
          </Pressable>
        ) : null}

        {/* Last broadcast confirmation */}
        {lastSent && Date.now() - lastSent.ts < 60_000 ? (
          <View style={styles.broadcastConfirm}>
            <Ionicons name="checkmark-circle" size={16} color="#1D9E75" />
            <Text style={styles.broadcastConfirmText}>
              Sent to {lastSent.count} {lastSent.count === 1 ? 'person' : 'people'} just now
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Floating broadcast button — planner only, only when there's a session */}
      {canDesignatePlanners && tripSession && activeAttendingCount > 0 ? (
        <View style={[styles.broadcastFab, { paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
          <Pressable
            onPress={handleOpenBroadcast}
            style={[styles.broadcastBtn, { backgroundColor: accentColor }]}
            accessibilityRole="button"
            accessibilityLabel={`Text the group (${activeAttendingCount} people)`}
          >
            <Ionicons name="megaphone-outline" size={18} color="#fff" />
            <Text style={styles.broadcastBtnText}>
              Text the group · {activeAttendingCount}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Broadcast composer modal */}
      <Modal
        visible={broadcastVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setBroadcastVisible(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#F5F4F0' }}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setBroadcastVisible(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Text the group</Text>
            <Pressable
              onPress={handleSendBroadcast}
              disabled={!broadcastBody.trim() || broadcastMutation.isPending}
            >
              <Text style={[styles.modalAction, (!broadcastBody.trim() || broadcastMutation.isPending) && { color: '#CCC' }]}>
                {broadcastMutation.isPending ? 'Sending…' : 'Send'}
              </Text>
            </Pressable>
          </View>
          <View style={{ padding: 20, gap: 12, flex: 1 }}>
            <Text style={styles.modalHint}>
              This will text {activeAttendingCount} {activeAttendingCount === 1 ? 'person' : 'people'} on their 1:1 thread with Rally.
            </Text>
            <TextInput
              value={broadcastBody}
              onChangeText={setBroadcastBody}
              placeholder="Type your message…"
              multiline
              style={styles.broadcastInput}
              maxLength={1000}
              autoFocus
            />
            <Text style={styles.charCount}>{broadcastBody.length} / 1000</Text>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add member modal (preserved) */}
      <Modal
        visible={addModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAddModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#F5F4F0' }}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setAddModalVisible(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Add member</Text>
            <Pressable onPress={handleAddMember} disabled={createMember.isPending}>
              <Text style={[styles.modalAction, createMember.isPending && { color: '#CCC' }]}>
                {createMember.isPending ? 'Adding…' : 'Add'}
              </Text>
            </Pressable>
          </View>
          <View style={{ padding: 20, gap: 16 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.fieldLabel}>First name *</Text>
                <TextInput value={addFirstName} onChangeText={setAddFirstName} style={styles.fieldInput} autoCapitalize="words" />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.fieldLabel}>Last name</Text>
                <TextInput value={addLastName} onChangeText={setAddLastName} style={styles.fieldInput} autoCapitalize="words" />
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={styles.fieldLabel}>Email *</Text>
              <TextInput value={addEmail} onChangeText={setAddEmail} style={styles.fieldInput} keyboardType="email-address" autoCapitalize="none" />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={styles.fieldLabel}>Phone *</Text>
              <TextInput value={addPhone} onChangeText={setAddPhone} style={styles.fieldInput} keyboardType="phone-pad" />
            </View>
          </View>
        </View>
      </Modal>
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

  // Progress card
  progressCard: {
    backgroundColor: 'white', borderRadius: 16, borderWidth: 1, borderColor: '#EBEBEB',
    padding: 16, gap: 12, marginBottom: 24,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressTitle: { fontSize: 15, fontWeight: '700', color: '#163026' },
  progressPct: { fontSize: 13, color: '#888' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#EBEBEB', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F7F7F5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
  },
  linkText: { flex: 1, fontSize: 12, color: '#888' },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 10, borderWidth: 1, paddingVertical: 10,
  },
  shareBtnText: { fontSize: 13, fontWeight: '600' },

  // Section + list
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#AAA', letterSpacing: 0.8, marginBottom: 8,
  },
  listCard: {
    backgroundColor: 'white', borderRadius: 16, borderWidth: 1, borderColor: '#EBEBEB',
    overflow: 'hidden', marginBottom: 18, paddingHorizontal: 16,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  avatarWrap: { alignItems: 'center', flexShrink: 0, width: 36 },
  crownIcon: { marginBottom: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontSize: 14, fontWeight: '600', color: '#163026' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  contactText: { fontSize: 12, color: '#888', flex: 1 },
  metaText: { fontSize: 11, color: '#AAA', marginTop: 2 },

  plannerHint: { fontSize: 12, color: '#BBB', textAlign: 'center', marginBottom: 20 },

  // Activity timeline
  activityRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12,
  },
  activityIcon: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#F3F1EC',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  activityText: { fontSize: 13, color: '#404040', lineHeight: 18 },
  activityTime: { fontSize: 11, color: '#AAA' },

  // Empty state
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#163026' },
  emptySubtitle: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },

  // Broadcast FAB
  broadcastFab: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12,
  },
  broadcastBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 999, paddingVertical: 14, paddingHorizontal: 24,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  broadcastBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  broadcastConfirm: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, marginTop: 12,
  },
  broadcastConfirmText: { fontSize: 13, color: '#1D9E75', fontWeight: '600' },

  // Broadcast modal
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#EEE', backgroundColor: 'white',
  },
  modalCancel: { fontSize: 16, color: '#0F3F2E' },
  modalTitle: { fontSize: 17, fontWeight: '600', color: '#163026' },
  modalAction: { fontSize: 16, fontWeight: '600', color: '#0F3F2E' },
  modalHint: { fontSize: 13, color: '#666' },
  broadcastInput: {
    backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: '#E5E5E5',
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#163026',
    minHeight: 160, textAlignVertical: 'top',
  },
  charCount: { fontSize: 12, color: '#999', textAlign: 'right' },

  // Field labels (modal forms)
  fieldLabel: {
    fontSize: 12, fontWeight: '600', color: '#888',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  fieldInput: {
    backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: '#E5E5E5',
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#163026',
  },
});
