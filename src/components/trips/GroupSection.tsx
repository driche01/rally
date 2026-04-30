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

import { useQuery } from '@tanstack/react-query';

import { Avatar } from '@/components/ui';
import { useRespondents } from '@/hooks/useRespondents';
import {
  useTripSession,
  useSessionParticipants,
} from '@/hooks/useTripSession';
import { useAddTripMember, useRemoveTripMember } from '@/hooks/useTripMembers';
import { getProfilesForTripSession } from '@/lib/api/travelerProfiles';
import { normalizePhone } from '@/lib/phone';
import type { Respondent, TripSessionParticipant } from '@/types/database';

const FORM_LABEL_STYLE = { fontSize: 14, fontWeight: '500' as const, color: '#404040' };

interface MemberRow {
  /** Stable key for React. */
  key: string;
  name: string | null;
  phone: string;
  /** Marker so we can show a different chip / disable removal. */
  isPlanner: boolean;
  /** Already participating in the SMS thread. */
  isActiveSms: boolean;
  /** Has responded to the survey (rsvp/preferences set). */
  hasResponded: boolean;
  /** Has saved a traveler profile (home airport, prefs, etc). */
  hasProfile: boolean;
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
  const addMember = useAddTripMember(tripId, tripSession?.id);
  const removeMember = useRemoveTripMember(tripId, tripSession?.id);

  const [addModalVisible, setAddModalVisible] = useState(false);

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
      rows.push({
        key: `p:${p.id}`,
        name: p.display_name ?? matchingResp?.name ?? null,
        phone: p.phone,
        isPlanner: p.is_planner,
        isActiveSms: p.status === 'active',
        hasResponded: Boolean(matchingResp?.rsvp || matchingResp?.preferences),
        hasProfile: profileByPhone.get(norm) === true,
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
        isPlanner: r.is_planner,
        isActiveSms: false,
        hasResponded: Boolean(r.rsvp || r.preferences),
        hasProfile: profileByPhone.get(norm) === true,
      });
    }
    // Planner first, then by name.
    rows.sort((a, b) => {
      if (a.isPlanner !== b.isPlanner) return a.isPlanner ? -1 : 1;
      return (a.name ?? a.phone).localeCompare(b.name ?? b.phone);
    });
    return rows;
  }, [participants, respondents, profiles]);

  function handleSubmitAdd(opts: { firstName: string; lastName: string; phone: string }) {
    const composed = [opts.firstName.trim(), opts.lastName.trim()].filter(Boolean).join(' ');
    addMember.mutate({ phone: opts.phone, name: composed || null }, {
      onSuccess: (result) => {
        if (!result.ok) {
          const reason = result.reason ?? 'unknown';
          const message =
            reason === 'invalid_phone' ? "That phone number doesn't look right." :
            reason === 'forbidden'     ? 'Only the planner can add members.' :
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

  return (
    <View className="gap-2">
      <View className="flex-row items-baseline justify-between">
        <Text style={FORM_LABEL_STYLE}>Who's invited?</Text>
        {members.length > 0 ? (
          <Text className="text-[11px] text-[#888]">
            {members.length} {members.length === 1 ? 'person' : 'people'}
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
              </View>
              <Text className="text-[12px] text-[#888]">{row.phone}</Text>
              <View className="flex-row gap-1.5 mt-1">
                <StatusPill done={row.hasResponded} label="Polls" />
                <StatusPill done={row.hasProfile} label="Profile" />
              </View>
            </View>
            {!row.isPlanner ? (
              <Pressable
                onPress={() => handleRemove(row)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${row.name ?? row.phone}`}
                disabled={removeMember.isPending}
              >
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={removeMember.isPending ? '#D4D4D4' : '#A0A0A0'}
                />
              </Pressable>
            ) : null}
          </View>
        ))}

        <Pressable
          onPress={() => setAddModalVisible(true)}
          className="flex-row items-center gap-2 px-3.5 py-3 border-t border-line"
          accessibilityRole="button"
          accessibilityLabel="Add member"
        >
          <Ionicons name="add-circle-outline" size={18} color="#0F3F2E" />
          <Text className="text-[14px] font-semibold text-green">Add member</Text>
        </Pressable>
      </View>

      <AddPersonModal
        visible={addModalVisible}
        pending={addMember.isPending}
        onClose={() => setAddModalVisible(false)}
        onSubmit={handleSubmitAdd}
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
