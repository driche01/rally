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
import { getShareUrl } from '@/lib/api/trips';
import { GROUP_SIZE_MIDPOINTS } from '@/types/database';
import type { Respondent } from '@/types/database';

export default function MembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: trip } = useTrip(id);
  const { data: respondents = [] } = useRespondents(id);
  const { canDesignatePlanners } = usePermissions(id);
  const setPlanner = useSetRespondentPlanner(id);

  const total = trip
    ? (trip.group_size_precise ?? GROUP_SIZE_MIDPOINTS[trip.group_size_bucket])
    : 0;
  const joinUrl = trip ? getShareUrl(trip.share_token) : '';
  const joinPercent = total > 0 ? Math.min(100, Math.round((respondents.length / total) * 100)) : 0;

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
  const allResponded = total > 0 && respondents.length >= total;

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
          <Text style={styles.backBtn}>← Back</Text>
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
              {respondents.length} of {total} responded
            </Text>
            <Text style={styles.progressPct}>{joinPercent}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${joinPercent}%` }]} />
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

          <Pressable onPress={handleShare} style={styles.shareBtn} accessibilityRole="button">
            <Ionicons name="share-outline" size={15} color="#235C38" />
            <Text style={styles.shareBtnText}>Share invite link</Text>
          </Pressable>

          {/* Text thread CTA — shown once everyone has responded */}
          {allResponded && (
            <Pressable
              onPress={handleStartTextThread}
              style={styles.textThreadBtn}
              accessibilityRole="button"
              accessibilityLabel="Start a group text thread"
            >
              <Ionicons name="chatbubbles-outline" size={15} color="#fff" />
              <Text style={styles.textThreadBtnText}>Start a text thread</Text>
            </Pressable>
          )}
        </View>

        {/* Member list */}
        {respondents.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>
              {respondents.length} {respondents.length === 1 ? 'MEMBER' : 'MEMBERS'}
            </Text>
            <View style={styles.listCard}>
              {respondents.map((r, i) => {
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
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {r.name.trim().charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      {/* Name + planner badge */}
                      <View style={styles.nameRow}>
                        <Text style={styles.name}>{r.name}</Text>
                        {r.is_planner ? (
                          <View style={styles.plannerBadge}>
                            <Ionicons name="shield-checkmark-outline" size={10} color="#235C38" />
                            <Text style={styles.plannerBadgeText}>Planner</Text>
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

        {/* Empty state */}
        {respondents.length === 0 ? (
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
  backBtn: { fontSize: 15, color: '#888', width: 60 },
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
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: '#235C38' },
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
    borderColor: '#235C38',
    paddingVertical: 10,
  },
  shareBtnText: { fontSize: 13, fontWeight: '600', color: '#235C38' },
  textThreadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    backgroundColor: '#235C38',
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
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E8F4EE',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { fontSize: 15, fontWeight: '700', color: '#235C38' },
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
