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
import { useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRespondents, useSetRespondentPlanner } from '@/hooks/useRespondents';
import { useTrip } from '@/hooks/useTrips';
import { usePermissions } from '@/hooks/usePermissions';
import { useProfile } from '@/hooks/useProfile';
import { useAuthStore } from '@/stores/authStore';
import { getShareUrl } from '@/lib/api/trips';
import { getTripStage, STAGE_ACCENT } from '@/lib/tripStage';
import { GROUP_SIZE_MIDPOINTS } from '@/types/database';
import type { Respondent } from '@/types/database';

export default function MembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: trip } = useTrip(id);
  const accentColor = STAGE_ACCENT[trip ? getTripStage(trip) : 'deciding'];
  const { data: respondents = [] } = useRespondents(id);
  const { canDesignatePlanners } = usePermissions(id);
  const setPlanner = useSetRespondentPlanner(id);
  const currentUser = useAuthStore((s) => s.user);
  // Fetch the planner's profile directly by trip.created_by so any trip member
  // (not just the creator themselves) can see the planner row.
  const { data: plannerProfile } = useProfile(trip?.created_by);

  const [expandedPrefs, setExpandedPrefs] = useState<Set<string>>(new Set());

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

  // Collect phone numbers from all respondents who provided one
  const phones = respondents.map((r) => r.phone).filter(Boolean) as string[];
  const allResponded = total > 0 && confirmedCount >= total;

  function handleStartTextThread() {
    if (phones.length === 0) {
      Alert.alert('No phone numbers', 'None of your group members provided a phone number.');
      return;
    }

    const numbersFormatted = phones.join('\n');

    if (Platform.OS === 'ios') {
      const addresses = phones.join(',');
      Alert.alert('Start a group thread', 'Choose your messaging app:', [
        {
          text: 'iMessage / SMS',
          onPress: () => Linking.openURL(`sms:?addresses=${encodeURIComponent(addresses)}`).catch(() =>
            Linking.openURL(`sms:${addresses}`).catch(() => {}),
          ),
        },
        {
          text: 'WhatsApp',
          onPress: () =>
            phones.length === 1
              ? Linking.openURL(`whatsapp://send?phone=${phones[0]}`).catch(() => {})
              : Alert.alert(
                  'WhatsApp',
                  `WhatsApp doesn't support opening a group via link.\n\nNumbers to add:\n${numbersFormatted}`,
                  [
                    {
                      text: 'Copy numbers',
                      onPress: () =>
                        Clipboard.setStringAsync(phones.join(', ')).then(() =>
                          Alert.alert('Copied', 'All phone numbers copied to clipboard.'),
                        ),
                    },
                    { text: 'OK' },
                  ],
                ),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      const addresses = phones.join(';');
      Alert.alert('Start a group thread', 'Choose your messaging app:', [
        {
          text: 'SMS',
          onPress: () => Linking.openURL(`sms:${addresses}`).catch(() => {}),
        },
        {
          text: 'Copy numbers',
          onPress: () =>
            Clipboard.setStringAsync(phones.join(', ')).then(() =>
              Alert.alert('Copied', 'All phone numbers copied to clipboard.'),
            ),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
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
                    <View style={[styles.avatar, styles.avatarPlanner]}>
                      <Text style={[styles.avatarText, styles.avatarTextPlanner]}>
                        {(plannerName || plannerEmail).trim().charAt(0).toUpperCase()}
                      </Text>
                    </View>
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
                return (
                  <Pressable
                    key={r.id}
                    onPress={canDesignatePlanners ? () => handleMemberMenu(r) : undefined}
                    style={[styles.row, i < respondents.length - 1 && styles.rowBorder]}
                    accessibilityRole={canDesignatePlanners ? 'button' : 'none'}
                    accessibilityLabel={canDesignatePlanners ? `Manage ${r.name}` : undefined}
                  >
                    {/* Avatar — crown above circle for planners */}
                    <View style={styles.avatarWrap}>
                      {r.is_planner ? (
                        <Ionicons name="ribbon" size={13} color="#D97706" style={styles.crownIcon} />
                      ) : null}
                      <View style={[styles.avatar, r.is_planner && styles.avatarPlanner]}>
                        <Text style={[styles.avatarText, r.is_planner && styles.avatarTextPlanner]}>
                          {r.name.trim().charAt(0).toUpperCase()}
                        </Text>
                      </View>
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
                  </Pressable>
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
      </ScrollView>
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
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A1A' },
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
  progressTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A1A' },
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
    backgroundColor: '#E0EEFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlanner: {
    backgroundColor: '#FFF3CD',
  },
  avatarText: { fontSize: 15, fontWeight: '700', color: '#3B6FA0' },
  avatarTextPlanner: { color: '#92640A' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontSize: 14, fontWeight: '600', color: '#1A1A1A' },

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
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A1A' },
  emptySubtitle: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },
});
