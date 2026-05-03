/**
 * GroupSection — embedded in the trip-edit screen so a planner can manage
 * the trip roster (add / remove people) without leaving the edit flow.
 *
 * Mirrors the data merge from the Group Dashboard (participants table is
 * primary; orphan respondents — those who haven't done the SMS handshake
 * — fall in below). Add / remove both flow through the member-add /
 * member-remove edge functions, which fire the corresponding 1:1 SMS:
 * welcome with survey link on add, "you've been removed" on remove.
 *
 * The "Add member" affordance opens an Add Person modal that mirrors the
 * one in ContactSelector on the new-trip screen — first name + last
 * name + phone, sheet presentation — so the two flows feel identical.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Avatar } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import {
  respondentKeys,
  useRespondents,
  useSetPlannerForPhone,
} from '@/hooks/useRespondents';
import {
  tripSessionKeys,
  useTripSession,
  useSessionParticipants,
} from '@/hooks/useTripSession';
import { useAddTripMember, useRemoveTripMember } from '@/hooks/useTripMembers';
import { getProfilesForTripSession } from '@/lib/api/travelerProfiles';
import { getRespondedRespondentIds } from '@/lib/api/responses';
import { normalizePhone } from '@/lib/phone';
import {
  NativeContactPickerModal,
  ensureContactsPermission,
  type PickerContact,
} from '@/components/trips/ContactSelector';
import type { Respondent, TripSessionParticipant } from '@/types/database';

const FORM_LABEL_STYLE = { fontSize: 14, fontWeight: '500' as const, color: '#404040' };

interface MemberRow {
  /** Stable key for React. */
  key: string;
  name: string | null;
  phone: string;
  /** Captured during poll response — null until they answer. */
  email: string | null;
  /** Set when there's a matching respondent row. Informational only —
   *  the planner toggle keys on phone (migration 094), not respondent id. */
  respondentId: string | null;
  /** Trip creator (trips.created_by). Always shown as planner; can't be
   *  demoted or removed. */
  isCreator: boolean;
  /** Marker so we can show a different chip / disable removal. */
  isPlanner: boolean;
  /** Already participating in the SMS thread. */
  isActiveSms: boolean;
  /** Has responded to the survey (rsvp/preferences set). */
  hasResponded: boolean;
  /** Has saved a traveler profile (home airport, prefs, etc). */
  hasProfile: boolean;
  /**
   * Trip-level attendance state. 'declined' = opted out via the survey
   * (rsvp='out' + is_attending=false). 'opted_out' = global STOP. 'in'
   * is the default. Drives the "Declined" / "Opted out" pill on the row.
   */
  attendance: 'in' | 'declined' | 'opted_out';
  /** Optional free-text the respondent left on the RSVP screen. Surfaces under the row name regardless of yes/no. */
  note: string | null;
}

export function GroupSection({ tripId }: { tripId: string }) {
  const { data: respondents = [] } = useRespondents(tripId);
  const { data: tripSession } = useTripSession(tripId);
  const { data: participants = [] } = useSessionParticipants(tripSession?.id);
  const { data: profiles = [] } = useQuery({
    queryKey: ['traveler_profiles_for_session', tripSession?.id ?? ''],
    queryFn: () => getProfilesForTripSession(tripSession!.id),
    enabled: Boolean(tripSession?.id),
  });
  const { data: respondedIds } = useQuery({
    queryKey: ['responded_respondent_ids', tripId],
    queryFn: () => getRespondedRespondentIds(tripId),
    enabled: Boolean(tripId),
  });
  const addMember = useAddTripMember(tripId, tripSession?.id);
  const removeMember = useRemoveTripMember(tripId, tripSession?.id);
  const setPlanner = useSetPlannerForPhone(tripId, tripSession?.id);
  const { canDesignatePlanners } = usePermissions(tripId);

  // While the planner is on this screen, poll the three roster-driving
  // queries every 5s so a freshly-submitted respondent flips from
  // "Polls" empty → checked without a manual refresh. Cheap queries; the
  // interval clears on unmount.
  const qc = useQueryClient();
  const sessionId = tripSession?.id;
  useEffect(() => {
    if (!tripId) return;
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: respondentKeys.forTrip(tripId) });
      qc.invalidateQueries({ queryKey: ['responded_respondent_ids', tripId] });
      if (sessionId) {
        qc.invalidateQueries({ queryKey: tripSessionKeys.participants(sessionId) });
      }
    }, 5000);
    return () => clearInterval(id);
  }, [qc, tripId, sessionId]);

  // The trip creator's SMS-side identity is stored on the session as
  // planner_user_id (= users.id, not auth.uid). Matching participants by
  // user_id surfaces the creator's row regardless of whether
  // app_create_sms_session set is_planner=true on it.
  const creatorUserId = tripSession?.planner_user_id ?? null;

  const [addModalVisible, setAddModalVisible] = useState(false);
  const [contactPickerVisible, setContactPickerVisible] = useState(false);
  /** Tracks the bulk-add fired by the contacts picker so we can show a
   *  single "saving…" state on the Add member control instead of a row of
   *  per-mutation flickers. */
  const [bulkAdding, setBulkAdding] = useState(false);

  // Merge participants + respondents into a single deduped list keyed by
  // normalized phone. Participants take precedence (richer status). The
  // traveler-profile presence is layered in via the per-session profile
  // RPC, matched by phone.
  const members = useMemo<MemberRow[]>(() => {
    const respondentByPhone = new Map<string, Respondent>();
    for (const r of respondents) {
      const norm = normalizePhone(r.phone ?? '');
      if (norm) respondentByPhone.set(norm, r);
    }
    const profileByPhone = new Map<string, boolean>();
    for (const row of profiles) {
      const norm = normalizePhone(row.phone) ?? row.phone;
      profileByPhone.set(norm, row.profile != null);
    }
    const seen = new Set<string>();
    const rows: MemberRow[] = [];
    for (const p of participants as TripSessionParticipant[]) {
      const norm = normalizePhone(p.phone) ?? p.phone;
      seen.add(norm);
      const matchingResp = respondentByPhone.get(norm);
      // Attendance state — global STOP wins; otherwise survey rsvp='out'
      // + is_attending=false marks them as declined; everything else is 'in'.
      const attendance: MemberRow['attendance'] =
        p.status === 'opted_out' || p.status === 'removed_by_planner'
          ? 'opted_out'
          : !p.is_attending && matchingResp?.rsvp === 'out'
            ? 'declined'
            : 'in';
      const isCreator = Boolean(creatorUserId && p.user_id === creatorUserId);
      rows.push({
        key: `p:${p.id}`,
        name: p.display_name ?? matchingResp?.name ?? null,
        phone: p.phone,
        email: matchingResp?.email ?? null,
        respondentId: matchingResp?.id ?? null,
        isCreator,
        // Creator is always a planner — keeps the pill correct even when
        // app_create_sms_session never got to flip is_planner=true (e.g.
        // creator's profile phone was empty at trip-create time).
        isPlanner: isCreator || p.is_planner,
        isActiveSms: p.status === 'active',
        hasResponded: Boolean(
          matchingResp?.rsvp
          || matchingResp?.preferences
          || (matchingResp && respondedIds?.has(matchingResp.id))
        ),
        hasProfile: profileByPhone.get(norm) === true,
        attendance,
        note: matchingResp?.note ?? null,
      });
    }
    for (const r of respondents) {
      const norm = normalizePhone(r.phone ?? '') ?? r.phone ?? '';
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      rows.push({
        key: `r:${r.id}`,
        name: r.name,
        phone: r.phone ?? '',
        email: r.email,
        respondentId: r.id,
        isCreator: false,
        isPlanner: r.is_planner,
        isActiveSms: false,
        hasResponded: Boolean(r.rsvp || r.preferences || respondedIds?.has(r.id)),
        hasProfile: profileByPhone.get(norm) === true,
        attendance: r.rsvp === 'out' ? 'declined' : 'in',
        note: r.note ?? null,
      });
    }
    // Creator first, then other planners, then by name.
    rows.sort((a, b) => {
      if (a.isCreator !== b.isCreator) return a.isCreator ? -1 : 1;
      if (a.isPlanner !== b.isPlanner) return a.isPlanner ? -1 : 1;
      return (a.name ?? a.phone).localeCompare(b.name ?? b.phone);
    });
    return rows;
  }, [participants, respondents, profiles, respondedIds, creatorUserId]);

  function handleSubmitAdd(opts: { firstName: string; lastName: string; phone: string }) {
    const composed = [opts.firstName.trim(), opts.lastName.trim()].filter(Boolean).join(' ');
    const normInput = normalizePhone(opts.phone);

    // Block re-adds of a phone that's already an active member of this
    // trip — keeps the planner from accidentally re-firing the welcome
    // SMS to someone who's already in the thread. We only block when
    // attendance === 'in'; declined / opted-out members fall through to
    // the priorOptOut re-add prompt below.
    const existingActive = members.find((m) => {
      const norm = normalizePhone(m.phone) ?? m.phone;
      return norm === normInput && m.attendance === 'in';
    });
    if (existingActive) {
      const who = existingActive.name?.trim() || existingActive.phone;
      Alert.alert(
        'Already on the trip',
        `${who} is already on this trip — no need to add them again.`,
      );
      return;
    }

    // Phase 4.6 — warn-on-re-add. If this phone already matches a participant
    // who's been opted out (either via the survey rsvp='out' path which flips
    // is_attending=false, or via global STOP), confirm before re-enabling
    // them. The mutation itself flips is_attending back to true server-side,
    // so this is purely a "did you mean to do this?" prompt.
    const priorOptOut = participants.find((p: TripSessionParticipant) => {
      const norm = normalizePhone(p.phone) ?? p.phone;
      if (norm !== normInput) return false;
      return !p.is_attending || p.status === 'opted_out';
    });

    const proceed = () => {
      addMember.mutate({ phone: opts.phone, name: composed || null }, {
        onSuccess: (result) => {
          if (!result.ok) {
            const reason = result.reason ?? 'unknown';
            const message =
              reason === 'invalid_phone'             ? "That phone number doesn't look right." :
              reason === 'forbidden'                 ? 'Only the planner can add members.' :
              reason === 'participant_upsert_failed' ? "Couldn't fully add — try again." :
              reason === 'no_active_session'         ? "This trip isn't ready for new members yet — try again in a moment." :
              `Could not add member (${reason}).`;
            Alert.alert('Could not add member', message);
            return;
          }
          setAddModalVisible(false);
          if (!result.sms_sent) {
            Alert.alert(
              "Added — but text didn't go through",
              "They're on the trip, but Rally couldn't deliver the welcome text. Check the number and try again.",
            );
          }
        },
        onError: (err: unknown) => {
          Alert.alert('Could not add member', err instanceof Error ? err.message : 'Try again.');
        },
      });
    };

    if (priorOptOut) {
      const who = priorOptOut.display_name?.trim() || composed || opts.phone;
      Alert.alert(
        `${who} previously opted out`,
        `Re-add ${who} and start sending Rally texts again?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Re-add', style: 'default', onPress: proceed },
        ],
      );
      return;
    }

    proceed();
  }

  /**
   * Tapped "Add member" → ask the planner whether they want to pick from
   * their phone contacts or type a phone manually. iOS uses
   * ActionSheetIOS for the native sheet; Android falls back to Alert.
   * Mirrors the language used by ContactSelector on the new-trip flow.
   */
  function openAddMemberMenu() {
    type Choice = 'contacts' | 'manual';
    const opts: Array<{ label: string; value: Choice }> = [
      { label: 'Choose from contacts', value: 'contacts' },
      { label: 'Add by phone',          value: 'manual'   },
    ];
    const run = async (choice: Choice) => {
      if (choice === 'contacts') {
        const ok = await ensureContactsPermission();
        if (!ok) return;
        setContactPickerVisible(true);
      } else {
        setAddModalVisible(true);
      }
    };
    if (Platform.OS === 'ios') {
      const labels = [...opts.map((o) => o.label), 'Cancel'];
      const cancelIdx = labels.length - 1;
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Add a member',
          options: labels,
          cancelButtonIndex: cancelIdx,
          userInterfaceStyle: 'light',
        },
        (i) => {
          if (i === cancelIdx || i === undefined) return;
          void run(opts[i].value);
        },
      );
    } else {
      Alert.alert('Add a member', undefined, [
        ...opts.map((o) => ({ text: o.label, onPress: () => void run(o.value) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }

  /**
   * Bulk-add path: planner picked one or more contacts. Skip anyone
   * already on the trip (active member) silently — a member showing up in
   * the picker after dedup means the picker's exclude list lagged the
   * trip's roster (rare). Other failures are aggregated into a single
   * "couldn't add N" alert at the end.
   */
  async function handleContactsPicked(picked: PickerContact[]) {
    setContactPickerVisible(false);
    if (picked.length === 0) return;

    // Filter out anyone already an active member. Same dedup the manual
    // path uses (handleSubmitAdd).
    const activePhones = new Set(
      members
        .filter((m) => m.attendance === 'in')
        .map((m) => normalizePhone(m.phone) ?? m.phone),
    );
    const toAdd = picked.filter((p) => {
      const norm = normalizePhone(p.phone) ?? p.phone;
      return !activePhones.has(norm);
    });
    if (toAdd.length === 0) {
      Alert.alert('Already added', "Those contacts are already on the trip.");
      return;
    }

    setBulkAdding(true);
    const failures: string[] = [];
    for (const c of toAdd) {
      try {
        const result = await addMember.mutateAsync({ phone: c.phone, name: c.name || null });
        if (!result.ok) {
          const reason = result.reason ?? 'unknown';
          const label =
            reason === 'invalid_phone'             ? `${c.name}: invalid phone` :
            reason === 'forbidden'                 ? `${c.name}: not allowed`   :
            reason === 'participant_upsert_failed' ? `${c.name}: couldn't save — try again` :
            reason === 'no_active_session'         ? `${c.name}: trip not ready` :
            `${c.name}: ${reason}`;
          failures.push(label);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        failures.push(`${c.name}: ${message}`);
      }
    }
    setBulkAdding(false);

    if (failures.length > 0) {
      Alert.alert(
        failures.length === toAdd.length ? "Couldn't add" : 'Some couldn\'t be added',
        failures.join('\n'),
      );
    }
  }

  // Direct mutation — the ActionSheet itself acts as the confirm prompt,
  // so we skip the second Alert that the old icon-only flow needed.
  function togglePlanner(row: MemberRow, nextIsPlanner: boolean) {
    if (!canDesignatePlanners || row.isCreator || !row.phone) return;
    setPlanner.mutate(
      { phone: row.phone, isPlanner: nextIsPlanner },
      {
        onSuccess: (result) => {
          if (result.ok) return;
          const message =
            result.reason === 'phone_not_on_trip'      ? "They aren't on this trip yet." :
            result.reason === 'cannot_demote_creator'  ? "The trip creator is always a planner." :
            result.reason === 'forbidden'              ? 'Only the planner can do that.' :
            'Could not update planner status.';
          Alert.alert('Error', message);
        },
        onError: () => Alert.alert('Error', 'Could not update planner status.'),
      },
    );
  }

  /**
   * Trailing-overflow action sheet for a member row. Replaces the prior
   * "two inline icons" pattern — labels are clearer, layout is consistent
   * regardless of state, and the sheet itself doubles as the confirm
   * prompt for promote/demote (remove still gets its own destructive
   * confirm because it sends a "you've been removed" SMS).
   *
   * - Creator rows have no menu (no actions are valid).
   * - Planner rows expose only "Remove planner access" — they must be
   *   demoted before they can be removed (mirrors member-remove's
   *   server-side `cannot_remove_planner` guard).
   * - Non-planner rows expose "Make planner" + the destructive
   *   "Remove from trip".
   *
   * iOS uses the native ActionSheetIOS; Android falls back to Alert.alert
   * with the same option set so we don't pull in a new dep.
   */
  function openMemberMenu(row: MemberRow) {
    if (!canDesignatePlanners || row.isCreator) return;
    if (!row.phone) return;
    const who = row.name ?? row.phone;

    type Opt = { label: string; destructive?: boolean; run: () => void };
    const opts: Opt[] = [];
    if (row.isPlanner) {
      opts.push({ label: 'Remove planner access', run: () => togglePlanner(row, false) });
    } else {
      opts.push({ label: 'Make planner', run: () => togglePlanner(row, true) });
      opts.push({ label: 'Remove from trip', destructive: true, run: () => handleRemove(row) });
    }

    if (Platform.OS === 'ios') {
      const labels = [...opts.map((o) => o.label), 'Cancel'];
      const cancelIdx = labels.length - 1;
      const destructiveIdx = opts.findIndex((o) => o.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: who,
          options: labels,
          cancelButtonIndex: cancelIdx,
          destructiveButtonIndex: destructiveIdx >= 0 ? destructiveIdx : undefined,
          userInterfaceStyle: 'light',
        },
        (i) => {
          if (i === cancelIdx || i === undefined) return;
          opts[i]?.run();
        },
      );
    } else {
      Alert.alert(who, undefined, [
        ...opts.map((o) => ({
          text: o.label,
          style: (o.destructive ? 'destructive' : 'default') as 'destructive' | 'default',
          onPress: o.run,
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }

  function handleRemove(row: MemberRow) {
    if (row.isPlanner) return;
    if (!row.phone) return;
    Alert.alert(
      'Remove member?',
      `${row.name ?? row.phone} will be removed from this trip and texted that they're no longer on it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const r = await removeMember.mutateAsync({ phone: row.phone });
            if (!r.ok) {
              const reason = r.reason ?? 'unknown';
              const message =
                reason === 'cannot_remove_planner' ? "You can't remove the planner." :
                reason === 'forbidden'             ? 'Only the planner can remove members.' :
                reason;
              Alert.alert('Could not remove', message);
            }
          },
        },
      ],
    );
  }

  // Invited count = currently-in-the-group members (in + declined). Mirrors
  // the trip card / hero pills so "7 + 1 = 8" math is consistent. Members
  // who texted STOP or were removed by the planner aren't counted as invited
  // any more — they're shown in the list with their own pill instead.
  const invitedCount = members.filter(
    (r) => r.attendance === 'in' || r.attendance === 'declined',
  ).length;

  return (
    <View className="gap-2">
      <View className="flex-row items-baseline justify-between">
        <Text style={FORM_LABEL_STYLE}>Who's invited?</Text>
        {invitedCount > 0 ? (
          <Text className="text-[11px] text-[#888]">
            {invitedCount} invited
          </Text>
        ) : null}
      </View>
      <Text style={{ fontSize: 13, color: '#737373', marginTop: -2 }}>
        Add or remove people from your trip. Rally texts them automatically — a welcome with the survey link when added, a heads-up when removed.
      </Text>

      <View className="rounded-xl border border-line bg-card overflow-hidden">
        {members.map((row, i) => (
          <View
            key={row.key}
            className={`flex-row items-center gap-3 px-3.5 py-3 ${i < members.length - 1 ? 'border-b border-line' : ''}`}
          >
            <Avatar name={row.name ?? row.phone} size="md" />
            <View style={{ flex: 1, gap: 2 }}>
              <View className="flex-row items-center gap-1.5">
                <Text className="text-[14px] font-medium text-[#163026]">
                  {row.name ?? row.phone}
                </Text>
                {row.isPlanner ? (
                  <View className="px-1.5 py-0.5 rounded-md bg-[#FEF3C7]">
                    <Text className="text-[10px] font-bold text-[#92400E]">PLANNER</Text>
                  </View>
                ) : null}
                {row.attendance === 'declined' ? (
                  <View style={{ backgroundColor: '#F4E5DC', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#8C4422' }}>DECLINED</Text>
                  </View>
                ) : row.attendance === 'opted_out' ? (
                  <View style={{ backgroundColor: '#FCE8E8', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#9A2A2A' }}>OPTED OUT</Text>
                  </View>
                ) : row.hasResponded ? (
                  <View style={{ backgroundColor: '#D7EFDB', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#1A5A2D' }}>IN</Text>
                  </View>
                ) : null}
              </View>
              <Text className="text-[12px] text-[#888]">{row.phone}</Text>
              {row.email ? (
                <Text className="text-[12px] text-[#888]" numberOfLines={1}>
                  {row.email}
                </Text>
              ) : null}
              {row.note ? (
                <Text
                  style={{ fontSize: 12, color: '#5F685F', fontStyle: 'italic', marginTop: 4 }}
                  numberOfLines={3}
                >
                  &ldquo;{row.note}&rdquo;
                </Text>
              ) : null}
              <View className="flex-row gap-1.5 mt-1">
                <StatusPill done={row.hasResponded} label="Polls" />
                <StatusPill done={row.hasProfile} label="Travel preferences" />
              </View>
            </View>
            {/* Single trailing overflow control. Tapping opens an
                ActionSheet (iOS) / Alert fallback (Android) with named
                options — replaces the prior two-icon row that was
                cramped and ambiguous. Hidden on the creator's row since
                no actions are valid for them. */}
            {canDesignatePlanners && !row.isCreator ? (
              <Pressable
                onPress={() => openMemberMenu(row)}
                accessibilityRole="button"
                accessibilityLabel={`Actions for ${row.name ?? row.phone}`}
                disabled={setPlanner.isPending || removeMember.isPending}
                style={{ padding: 10 }}
                hitSlop={6}
              >
                <Ionicons
                  name="ellipsis-horizontal"
                  size={20}
                  color={
                    (setPlanner.isPending || removeMember.isPending)
                      ? '#D4D4D4' : '#5F685F'
                  }
                />
              </Pressable>
            ) : null}
          </View>
        ))}

        <Pressable
          onPress={openAddMemberMenu}
          disabled={bulkAdding}
          className="flex-row items-center gap-2 px-3.5 py-3 border-t border-line"
          accessibilityRole="button"
          accessibilityLabel="Add member"
        >
          <Ionicons
            name="add-circle-outline"
            size={18}
            color={bulkAdding ? '#A8C2B6' : '#0F3F2E'}
          />
          <Text
            className="text-[14px] font-semibold"
            style={{ color: bulkAdding ? '#A8C2B6' : '#0F3F2E' }}
          >
            {bulkAdding ? 'Adding…' : 'Add member'}
          </Text>
        </Pressable>
      </View>

      <AddPersonModal
        visible={addModalVisible}
        pending={addMember.isPending}
        onClose={() => setAddModalVisible(false)}
        onSubmit={handleSubmitAdd}
      />

      {/* Native multi-select contacts picker — same component the
          new-trip flow uses; we only feed it the active-member phone
          list so it doesn't surface people who are already on the trip. */}
      <NativeContactPickerModal
        visible={contactPickerVisible}
        excludePhones={members
          .filter((m) => m.attendance === 'in')
          .map((m) => m.phone)}
        onDone={handleContactsPicked}
        onClose={() => setContactPickerVisible(false)}
      />
    </View>
  );
}

// ─── Status pill ──────────────────────────────────────────────────────────
// Compact "Polls ✓" / "Profile —" indicator. Green when done, muted gray
// when pending. Two pills side-by-side replace the single "Hasn't
// responded yet" line so the planner can see at a glance which steps
// each member has completed.

function StatusPill({ done, label }: { done: boolean; label: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: done ? '#EAF3EC' : '#F0F0F0',
      }}
    >
      <Ionicons
        name={done ? 'checkmark-circle' : 'ellipse-outline'}
        size={11}
        color={done ? '#235C38' : '#A0A0A0'}
      />
      <Text style={{ fontSize: 10, fontWeight: '700', color: done ? '#235C38' : '#888' }}>
        {label}
      </Text>
    </View>
  );
}

// ─── Add Person modal ─────────────────────────────────────────────────────
// Sheet presentation matching ContactSelector's ManualEntryModal on the
// new-trip flow. First name required + 10-digit phone required; last
// name optional. Errors show inline below the fields.

interface AddPersonModalProps {
  visible: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (opts: { firstName: string; lastName: string; phone: string }) => void;
}

function AddPersonModal({ visible, pending, onClose, onSubmit }: AddPersonModalProps) {
  const insetTop = Platform.OS === 'ios' ? 24 : 16;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setFirstName('');
      setLastName('');
      setPhone('');
      setErr(null);
    }
  }, [visible]);

  function handleSave() {
    const cleanFirst = firstName.trim();
    const cleanPhone = phone.trim();
    if (!cleanFirst) { setErr('Add a first name'); return; }
    if (cleanPhone.replace(/\D/g, '').length < 10) { setErr('Add a 10-digit phone'); return; }
    onSubmit({ firstName: cleanFirst, lastName: lastName.trim(), phone: cleanPhone });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: '#FFFCF6' }}
      >
        <View style={[styles.modalHeader, { paddingTop: insetTop + 8 }]}>
          <Pressable onPress={onClose} hitSlop={10} disabled={pending}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>Add person</Text>
          <Pressable onPress={handleSave} hitSlop={10} disabled={pending}>
            <Text style={[styles.modalSave, pending && { color: '#A0C0B2' }]}>
              {pending ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.modalBody}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={[styles.modalField, { flex: 1 }]}>
              <Text style={styles.modalLabel}>First name</Text>
              <TextInput
                value={firstName}
                onChangeText={(t) => { setFirstName(t); setErr(null); }}
                placeholder="Sarah"
                placeholderTextColor="#a3a3a3"
                style={styles.modalInput}
                autoFocus
                autoCapitalize="words"
                maxLength={40}
                returnKeyType="next"
              />
            </View>
            <View style={[styles.modalField, { flex: 1 }]}>
              <Text style={styles.modalLabel}>Last name</Text>
              <TextInput
                value={lastName}
                onChangeText={(t) => { setLastName(t); setErr(null); }}
                placeholder="Optional"
                placeholderTextColor="#a3a3a3"
                style={styles.modalInput}
                autoCapitalize="words"
                maxLength={40}
                returnKeyType="next"
              />
            </View>
          </View>
          <View style={styles.modalField}>
            <Text style={styles.modalLabel}>Phone</Text>
            <TextInput
              value={phone}
              onChangeText={(t) => { setPhone(t); setErr(null); }}
              placeholder="e.g. (555) 123-4567"
              placeholderTextColor="#a3a3a3"
              style={styles.modalInput}
              keyboardType="phone-pad"
              maxLength={20}
            />
          </View>
          {err ? <Text style={styles.modalErr}>{err}</Text> : null}
          <Text style={styles.modalHint}>
            US numbers only for now. Rally will normalize the format before sending.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EFE3D0',
  },
  modalCancel: { fontSize: 16, color: '#5F685F' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#163026' },
  modalSave: { fontSize: 16, fontWeight: '700', color: '#0F3F2E' },
  modalBody: { padding: 20, gap: 16 },
  modalField: { gap: 6 },
  modalLabel: { fontSize: 12, fontWeight: '600', color: '#5F685F', textTransform: 'uppercase', letterSpacing: 0.5 },
  modalInput: {
    backgroundColor: 'white',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#163026',
  },
  modalErr: { fontSize: 13, color: '#9A2A2A' },
  modalHint: { fontSize: 12, color: '#888' },
});
