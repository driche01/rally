/**
 * Members Roster — shows everyone who responded to polls via the share link.
 * Respondents become group members the moment they submit their name, email,
 * and phone number on the respond page.
 *
 * Planners can promote/demote any member to co-planner status from here.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  Alert,
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
import { useRespondents, useSetRespondentPlanner, useCreateRespondentManually, useDeleteRespondent } from '@/hooks/useRespondents';
import { useTrip } from '@/hooks/useTrips';
import { usePermissions } from '@/hooks/usePermissions';
import { useProfile } from '@/hooks/useProfile';
import { useAuthStore } from '@/stores/authStore';
import { getShareUrl } from '@/lib/api/trips';
import { getTripStage, STAGE_ACCENT } from '@/lib/tripStage';
import { GROUP_SIZE_MIDPOINTS } from '@/types/database';
import type { Respondent } from '@/types/database';
import { Avatar } from '@/components/ui';

// ─── Swipeable member row ──────────────────────────────────────────────────────

function DeleteMemberAction({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center', width: 80 }}
      accessibilityRole="button"
      accessibilityLabel="Remove member"
    >
      <Ionicons name="trash-outline" size={20} color="white" />
      <Text style={{ color: 'white', fontSize: 11, fontWeight: '600', marginTop: 3 }}>Remove</Text>
    </Pressable>
  );
}

function MemberRow({
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
      ref={swipeRef}
      renderRightActions={onDelete ? () => <DeleteMemberAction onPress={() => onDelete(swipeRef)} /> : undefined}
      overshootRight={false}
      friction={2}
    >
      <Pressable
        onPress={onPress}
        style={style}
        accessibilityRole={canManage ? 'button' : 'none'}
      >
        {children}
      </Pressable>
    </Swipeable>
  );
}

export default function MembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: trip } = useTrip(id);
  const accentColor = STAGE_ACCENT[trip ? getTripStage(trip) : 'deciding'];
  const { data: respondents = [] } = useRespondents(id);
  const { canDesignatePlanners } = usePermissions(id);
  const setPlanner = useSetRespondentPlanner(id);
  const deleteMember = useDeleteRespondent(id);
  const currentUser = useAuthStore((s) => s.user);
  // Fetch the planner's profile directly by trip.created_by so any trip member
  // (not just the creator themselves) can see the planner row.
  const { data: plannerProfile } = useProfile(trip?.created_by);

  const [expandedPrefs, setExpandedPrefs] = useState<Set<string>>(new Set());
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addFirstName, setAddFirstName] = useState('');
  const [addLastName, setAddLastName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const createMember = useCreateRespondentManually(id);

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
        setAddFirstName('');
        setAddLastName('');
        setAddEmail('');
        setAddPhone('');
      },
      onError: (e: unknown) => Alert.alert('Could not add member', e instanceof Error ? e.message : 'Please try again.'),
    });
  }

  const isCreator = !!trip && !!currentUser && trip.created_by === currentUser.id;
  // Fall back to auth user metadata for the creator viewing their own trip
  // when the profiles row hasn't loaded yet.
  const plannerName = plannerProfile
    ? [plannerProfile.name, (plannerProfile as any).last_name].filter(Boolean).join(' ')
    : isCreator
      ? [currentUser?.user_metadata?.name, currentUser?.user_metadata?.last_name].filter(Boolean).join(' ')
      : '';
  const plannerEmail = (plannerProfile as any)?.email ?? (isCreator ? currentUser?.email : '') ?? '';
  const plannerPhone = (plannerProfile as any)?.phone ?? null;
  const showPlanner = !!(plannerName || plannerEmail);

  const total = trip
    ? (trip.group_size_precise ?? GROUP_SIZE_MIDPOINTS[trip.group_size_bucket])
    : 0;
  const joinUrl = trip ? getShareUrl(trip.share_token) : '';
  // memberCount: everyone in the list (planner + poll respondents) — for the section label
  const memberCount = (showPlanner ? 1 : 0) + respondents.length;
  // confirmedCount: planner is always confirmed + respondents who explicitly RSVPed 'in'
  const confirmedCount = (showPlanner ? 1 : 0) + respondents.filter((r) => r.rsvp === 'in').length;
  // joinPercent: based on confirmed RSVPs vs expected group size
  const joinPercent = total > 0 ? Math.min(100, Math.round((confirmedCount / total) * 100)) : 0;

  async function handleCopyLink() {
    await Clipboard.setStringAsync(joinUrl);
    Alert.alert('Copied!', 'Invite link copied to clipboard.');
  }

  async function handleShare() {
    try {
      await Share.share({ message: `Join our trip on Rally: ${joinUrl}` });
    } catch {}
  }

  // Collect phone numbers from confirmed respondents only
  const confirmedRespondents = respondents.filter((r) => r.rsvp === 'in');
  const phones = confirmedRespondents.map((r) => r.phone).filter(Boolean) as string[];
  const allResponded = total > 0 && confirmedCount >= total;

  function handleStartTextThread() {
    if (phones.length === 0) {
      Alert.alert('No phone numbers', 'None of your confirmed group members provided a phone number.');
      return;
    }

    // iOS: sms:?addresses=num1,num2 opens iMessage/SMS with all recipients pre-filled
    // Android: sms:num1;num2
    const addresses = Platform.OS === 'ios' ? phones.join(',') : phones.join(';');
    const url = Platform.OS === 'ios'
      ? `sms:?addresses=${encodeURIComponent(addresses)}`
      : `sms:${addresses}`;

    Linking.openURL(url).catch(() => {
      // Fallback: try without encoding
      Linking.openURL(`sms:${addresses}`).catch(() =>
        Alert.alert('Could not open Messages', 'Please open your Messages app manually.'),
      );
    });
  }

  function handleMemberMenu(r: Respondent) {
    if (!canDesignatePlanners) return;
    if (r.is_planner) {
      Alert.alert(
        r.name,
        "Remove planner access? They'll no longer be able to edit polls and trip details.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove planner',
            style: 'destructive',
            onPress: () =>
              setPlanner.mutate(
                { respondentId: r.id, isPlanner: false },
                { onError: () => Alert.alert('Error', 'Could not update planner status.') },
              ),
          },
        ],
      );
    } else {
      Alert.alert(
        `Make ${r.name} a planner?`,
        "They'll be able to edit polls and trip details.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Make planner',
            onPress: () =>
              setPlanner.mutate(
                { respondentId: r.id, isPlanner: true },
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
        <Text style={styles.headerTitle}>Group members</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Join progress */}
        <View style={styles.progressCard}>
          <View style={styles.progressRow}>
            <Text style={styles.progressTitle}>
              {confirmedCount} of {total} confirmed
            </Text>
            <Text style={styles.progressPct}>{joinPercent}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${joinPercent}%`, backgroundColor: accentColor }]} />
          </View>

          {/* Invite link */}
          <View style={styles.linkRow}>
            <Ionicons name="link-outline" size={14} color="#888" />
            <Text style={styles.linkText} numberOfLines={1}>{joinUrl}</Text>
            <Pressable
              onPress={handleCopyLink}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Copy link"
            >
              <Ionicons name="copy-outline" size={16} color="#888" />
            </Pressable>
          </View>

          <Pressable onPress={handleShare} style={[styles.shareBtn, { borderColor: accentColor }]} accessibilityRole="button">
            <Ionicons name="share-outline" size={15} color={accentColor} />
            <Text style={[styles.shareBtnText, { color: accentColor }]}>Share invite link</Text>
          </Pressable>

          {/* Text thread CTA — shown once everyone has responded */}
          {allResponded && (
            <Pressable
              onPress={handleStartTextThread}
              style={[styles.textThreadBtn, { backgroundColor: accentColor }]}
              accessibilityRole="button"
              accessibilityLabel="Start a group text thread"
            >
              <Ionicons name="chatbubbles-outline" size={15} color="#fff" />
              <Text style={styles.textThreadBtnText}>Start a text thread</Text>
            </Pressable>
          )}
        </View>

        {/* Member list */}
        {(showPlanner || respondents.length > 0) ? (
          <>
            <Text style={styles.sectionLabel}>
              {memberCount} {memberCount === 1 ? 'MEMBER' : 'MEMBERS'}
            </Text>
            <View style={styles.listCard}>

              {/* Trip creator / planner — always first */}
              {showPlanner ? (
                <View style={[styles.row, respondents.length > 0 && styles.rowBorder]}>
                  <View style={styles.avatarWrap}>
                    <Ionicons name="ribbon" size={13} color="#D97706" style={styles.crownIcon} />
                    <Avatar name={plannerName || plannerEmail} size="md" />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.name}>{plannerName || plannerEmail}</Text>
                    {plannerEmail ? (
                      <View style={styles.contactRow}>
                        <Ionicons name="mail-outline" size={12} color="#888" />
                        <Text style={styles.contactText}>{plannerEmail}</Text>
                      </View>
                    ) : null}
                    {plannerPhone ? (
                      <View style={styles.contactRow}>
                        <Ionicons name="call-outline" size={12} color="#888" />
                        <Text style={styles.contactText}>{plannerPhone}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {[...respondents]
                .sort((a, b) => (b.is_planner ? 1 : 0) - (a.is_planner ? 1 : 0))
                .map((r, i) => {
                function copyContact(value: string, label: string) {
                  Clipboard.setStringAsync(value);
                  Alert.alert('Copied', `${label} copied to clipboard.`);
                }
                function handleDelete(swipeRef: React.RefObject<Swipeable>) {
                  swipeRef.current?.close();
                  Alert.alert(
                    'Remove member?',
                    `${r.name} will be removed from this trip.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () =>
                          deleteMember.mutate(r.id, {
                            onError: () => Alert.alert('Error', 'Could not remove member.'),
                          }),
                      },
                    ],
                  );
                }
                return (
                  <MemberRow
                    key={r.id}
                    canManage={canDesignatePlanners}
                    onPress={canDesignatePlanners ? () => handleMemberMenu(r) : undefined}
                    onDelete={canDesignatePlanners ? handleDelete : undefined}
                    style={[styles.row, i < respondents.length - 1 && styles.rowBorder]}
                  >
                    {/* Avatar — crown above circle for planners */}
                    <View style={styles.avatarWrap}>
                      {r.is_planner ? (
                        <Ionicons name="ribbon" size={13} color="#D97706" style={styles.crownIcon} />
                      ) : null}
                      <Avatar name={r.name} size="md" />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      {/* Name + RSVP badge */}
                      <View style={styles.nameRow}>
                        <Text style={styles.name}>{r.name}</Text>
                        {r.rsvp === 'in' ? (
                          <View style={styles.rsvpIn}>
                            <Text style={styles.rsvpInText}>✓ In</Text>
                          </View>
                        ) : r.rsvp === 'out' ? (
                          <View style={styles.rsvpOut}>
                            <Text style={styles.rsvpOutText}>Out</Text>
                          </View>
                        ) : null}
                      </View>
                      {r.email ? (
                        <Pressable
                          onPress={(e) => { e.stopPropagation(); copyContact(r.email!, 'Email'); }}
                          style={styles.contactRow}
                          accessibilityRole="button"
                        >
                          <Ionicons name="mail-outline" size={12} color="#888" />
                          <Text style={styles.contactText}>{r.email}</Text>
                          <Ionicons name="copy-outline" size={11} color="#CCC" />
                        </Pressable>
                      ) : null}
                      {r.phone ? (
                        <Pressable
                          onPress={(e) => { e.stopPropagation(); copyContact(r.phone!, 'Phone'); }}
                          style={styles.contactRow}
                          accessibilityRole="button"
                        >
                          <Ionicons name="call-outline" size={12} color="#888" />
                          <Text style={styles.contactText}>{r.phone}</Text>
                          <Ionicons name="copy-outline" size={11} color="#CCC" />
                        </Pressable>
                      ) : null}
                      {!r.email && !r.phone ? (
                        <Text style={styles.noContact}>No contact info provided</Text>
                      ) : null}

                      {/* Preferences toggle */}
                      {r.preferences ? (
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            setExpandedPrefs((prev) => {
                              const next = new Set(prev);
                              next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                              return next;
                            });
                          }}
                          style={{ marginTop: 4 }}
                          accessibilityRole="button"
                        >
                          <Text style={styles.prefsToggle}>
                            {expandedPrefs.has(r.id) ? '▲ Hide preferences' : '▼ See preferences'}
                          </Text>
                        </Pressable>
                      ) : null}

                      {/* Preferences detail */}
                      {r.preferences && expandedPrefs.has(r.id) ? (
                        <View style={styles.prefsBox}>
                          {r.preferences.needs && r.preferences.needs.length > 0 ? (
                            <View style={styles.prefSection}>
                              <Text style={styles.prefLabel}>Needs</Text>
                              {r.preferences.needs.map((n) => (
                                <Text key={n} style={styles.prefItem}>· {n}</Text>
                              ))}
                            </View>
                          ) : null}
                          {r.preferences.vibes && r.preferences.vibes.length > 0 ? (
                            <View style={styles.prefSection}>
                              <Text style={styles.prefLabel}>Vibes</Text>
                              <Text style={styles.prefItem}>{r.preferences.vibes.join(', ')}</Text>
                            </View>
                          ) : null}
                          {r.preferences.pace ? (
                            <View style={styles.prefSection}>
                              <Text style={styles.prefLabel}>Pace</Text>
                              <Text style={styles.prefItem}>{r.preferences.pace}</Text>
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                    {/* Chevron hint for planners */}
                    {canDesignatePlanners ? (
                      <Ionicons name="ellipsis-horizontal" size={16} color="#CCC" />
                    ) : null}
                  </MemberRow>
                );
              })}
            </View>

            {/* Planner designation hint */}
            {canDesignatePlanners ? (
              <Text style={styles.plannerHint}>
                Tap a member to manage their planner access
              </Text>
            ) : null}
          </>
        ) : null}

        {/* Empty state — only when planner not shown and no respondents */}
        {!showPlanner && respondents.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTitle}>No members yet</Text>
            <Text style={styles.emptySubtitle}>
              Share the link above. When group members respond to polls they'll appear here with their contact info.
            </Text>
          </View>
        ) : null}

        {/* Add member — planners only */}
        {canDesignatePlanners ? (
          <Pressable
            onPress={() => setAddModalVisible(true)}
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              paddingVertical: 20,
              borderRadius: 16,
              borderWidth: 2,
              borderStyle: 'dashed',
              borderColor: '#E5E5E5',
              marginTop: 12,
            }}
          >
            <Ionicons name="add-circle-outline" size={18} color="#D4D4D4" />
            <Text style={{ fontSize: 12, color: '#D0D0D0' }}>Tap to add a group member</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Add member modal */}
      <Modal visible={addModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAddModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#F5F4F0' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#EEE', backgroundColor: 'white' }}>
            <Pressable onPress={() => setAddModalVisible(false)}>
              <Text style={{ fontSize: 16, color: '#0F3F2E' }}>Cancel</Text>
            </Pressable>
            <Text style={{ fontSize: 17, fontWeight: '600', color: '#163026' }}>Add member</Text>
            <Pressable onPress={handleAddMember} disabled={createMember.isPending}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: createMember.isPending ? '#CCC' : '#0F3F2E' }}>
                {createMember.isPending ? 'Adding…' : 'Add'}
              </Text>
            </Pressable>
          </View>
          <View style={{ padding: 20, gap: 16 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>First name *</Text>
                <TextInput
                  value={addFirstName}
                  onChangeText={setAddFirstName}
                  placeholder="First"
                  placeholderTextColor="#A3A3A3"
                  style={{ backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: '#E5E5E5', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#163026' }}
                  autoCapitalize="words"
                  autoFocus
                />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>Last name</Text>
                <TextInput
                  value={addLastName}
                  onChangeText={setAddLastName}
                  placeholder="Last"
                  placeholderTextColor="#A3A3A3"
                  style={{ backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: '#E5E5E5', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#163026' }}
                  autoCapitalize="words"
                />
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>Email *</Text>
              <TextInput
                value={addEmail}
                onChangeText={setAddEmail}
                placeholder="email@example.com"
                placeholderTextColor="#A3A3A3"
                style={{ backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: '#E5E5E5', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#163026' }}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>Phone *</Text>
              <TextInput
                value={addPhone}
                onChangeText={setAddPhone}
                placeholder="+1 555 000 0000"
                placeholderTextColor="#A3A3A3"
                style={{ backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: '#E5E5E5', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#163026' }}
                keyboardType="phone-pad"
              />
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: { fontSize: 15, width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#163026' },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },

  // Progress card
  progressCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EBEBEB',
    padding: 16,
    gap: 12,
    marginBottom: 24,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressTitle: { fontSize: 15, fontWeight: '700', color: '#163026' },
  progressPct: { fontSize: 13, color: '#888' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#EBEBEB', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F7F7F5',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  linkText: { flex: 1, fontSize: 12, color: '#888' },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
  },
  shareBtnText: { fontSize: 13, fontWeight: '600' },
  textThreadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    paddingVertical: 12,
  },
  textThreadBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },

  // Section label
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#AAA',
    letterSpacing: 0.8,
    marginBottom: 8,
  },

  // List card
  listCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EBEBEB',
    overflow: 'hidden',
    marginBottom: 10,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  avatarWrap: {
    alignItems: 'center',
    flexShrink: 0,
    width: 36,
  },
  crownIcon: {
    marginBottom: 2,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#DFE8D2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlanner: {
    backgroundColor: '#FFF3CD',
  },
  avatarText: { fontSize: 15, fontWeight: '700', color: '#0F3F2E' },
  avatarTextPlanner: { color: '#7C5A0A' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontSize: 14, fontWeight: '600', color: '#163026' },

  // Planner badge
  plannerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#E8F4EE',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  plannerBadgeText: { fontSize: 10, fontWeight: '700', color: '#235C38' },

  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  contactText: { fontSize: 12, color: '#888', flex: 1 },
  noContact: { fontSize: 12, color: '#C0C0C0', fontStyle: 'italic' },

  // RSVP badges
  rsvpIn: { backgroundColor: '#EAF3EC', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  rsvpInText: { fontSize: 11, fontWeight: '700', color: '#235C38' },
  rsvpOut: { backgroundColor: '#F0F0F0', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  rsvpOutText: { fontSize: 11, fontWeight: '700', color: '#888' },

  // Preferences
  prefsToggle: { fontSize: 12, color: '#235C38', fontWeight: '600', marginTop: 2 },
  prefsBox: { marginTop: 8, backgroundColor: '#F7FAF8', borderRadius: 10, padding: 10, gap: 8 },
  prefSection: { gap: 2 },
  prefLabel: { fontSize: 11, fontWeight: '700', color: '#235C38', textTransform: 'uppercase', letterSpacing: 0.5 },
  prefItem: { fontSize: 13, color: '#404040', lineHeight: 18 },

  // Hint below member list
  plannerHint: {
    fontSize: 12,
    color: '#BBB',
    textAlign: 'center',
    marginBottom: 20,
  },

  // Empty state
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#163026' },
  emptySubtitle: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },
});
