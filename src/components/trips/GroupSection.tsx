/**
 * GroupSection — embedded in the trip-edit screen so a planner can manage
 * the trip roster (add / remove people) without leaving the edit flow.
 *
 * Mirrors the data merge from the Group Dashboard (participants table is
 * primary; orphan respondents — those who haven't done the SMS handshake
 * — fall in below). Add / remove both flow through the member-add /
 * member-remove edge functions, which fire the corresponding 1:1 SMS:
 * welcome with survey link on add, "you've been removed" on remove.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/ui';
import { useRespondents } from '@/hooks/useRespondents';
import {
  useTripSession,
  useSessionParticipants,
} from '@/hooks/useTripSession';
import { useAddTripMember, useRemoveTripMember } from '@/hooks/useTripMembers';
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
  /** Has responded to the survey. */
  hasResponded: boolean;
}

export function GroupSection({ tripId }: { tripId: string }) {
  const { data: respondents = [] } = useRespondents(tripId);
  const { data: tripSession } = useTripSession(tripId);
  const { data: participants = [] } = useSessionParticipants(tripSession?.id);
  const addMember = useAddTripMember(tripId, tripSession?.id);
  const removeMember = useRemoveTripMember(tripId, tripSession?.id);

  const [addOpen, setAddOpen] = useState(false);
  const [addPhone, setAddPhone] = useState('');
  const [addName, setAddName] = useState('');

  // Merge participants + respondents into a single deduped list keyed by
  // normalized phone. Participants take precedence (richer status).
  const members = useMemo<MemberRow[]>(() => {
    const respondentByPhone = new Map<string, Respondent>();
    for (const r of respondents) {
      const norm = normalizePhone(r.phone ?? '');
      if (norm) respondentByPhone.set(norm, r);
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
      });
    }
    // Planner first, then by name.
    rows.sort((a, b) => {
      if (a.isPlanner !== b.isPlanner) return a.isPlanner ? -1 : 1;
      return (a.name ?? a.phone).localeCompare(b.name ?? b.phone);
    });
    return rows;
  }, [participants, respondents]);

  function handleAdd() {
    const phone = addPhone.trim();
    const name = addName.trim();
    if (!phone) {
      Alert.alert('Phone required', 'Enter a phone number so Rally can text them.');
      return;
    }
    addMember.mutate({ phone, name: name || null }, {
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
        setAddOpen(false);
        setAddPhone('');
        setAddName('');
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
              <Text className="text-[11px] text-[#A0A0A0]">
                {row.hasResponded
                  ? 'Responded'
                  : row.isActiveSms
                    ? 'Joined SMS thread'
                    : 'Hasn\'t responded yet'}
              </Text>
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

        {addOpen ? (
          <View className="px-3.5 py-3 gap-2 bg-[#FAFAF7] border-t border-line">
            <Text className="text-[11px] text-[#888]">
              Rally will text the welcome + survey link as soon as you add them.
            </Text>
            <TextInput
              value={addPhone}
              onChangeText={setAddPhone}
              placeholder="+1 555 555 5555"
              placeholderTextColor="#A0A0A0"
              keyboardType="phone-pad"
              autoFocus
              style={inputStyle}
            />
            <TextInput
              value={addName}
              onChangeText={setAddName}
              placeholder="First name (optional)"
              placeholderTextColor="#A0A0A0"
              autoCapitalize="words"
              style={inputStyle}
            />
            <View className="flex-row items-center justify-end gap-3 mt-1">
              <Pressable
                onPress={() => { setAddOpen(false); setAddPhone(''); setAddName(''); }}
                hitSlop={6}
                disabled={addMember.isPending}
              >
                <Text className="text-[14px] text-[#5F685F]">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleAdd}
                disabled={addMember.isPending}
                className="px-4 py-2 rounded-full bg-green"
                accessibilityRole="button"
              >
                <Text className="text-[14px] font-semibold text-white">
                  {addMember.isPending ? 'Adding…' : 'Add & text them'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setAddOpen(true)}
            className="flex-row items-center gap-2 px-3.5 py-3 border-t border-line"
            accessibilityRole="button"
            accessibilityLabel="Add member"
          >
            <Ionicons name="add-circle-outline" size={18} color="#0F3F2E" />
            <Text className="text-[14px] font-semibold text-green">Add member</Text>
          </Pressable>
        )}
      </View>

    </View>
  );
}

const inputStyle = {
  backgroundColor: 'white',
  borderRadius: 10,
  borderWidth: 1,
  borderColor: '#E5E5E5',
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 14,
  color: '#163026',
} as const;
