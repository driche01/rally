import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
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
import { SortableEntryList, type CardKey } from '@/components/SortableEntryList';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePolls, pollKeys } from '@/hooks/usePolls';
import { useRespondents, respondentKeys } from '@/hooks/useRespondents';
import { useTrip } from '@/hooks/useTrips';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/lib/supabase';
import { getShareUrl } from '@/lib/api/trips';
import { capture, Events } from '@/lib/analytics';
import { queryClient } from '@/lib/queryClient';
import { getTripStage, type TripStage } from '@/lib/tripStage';
import { parseDateRangeLabel } from '@/lib/pollFormUtils';
import { GROUP_SIZE_MIDPOINTS } from '@/types/database';
import type { Respondent, Trip } from '@/types/database';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const s = new Date(start + 'T12:00:00');
  const sm = months[s.getMonth()]; const sd = s.getDate();
  if (!end) return `${sm} ${sd}`;
  const e = new Date(end + 'T12:00:00');
  const em = months[e.getMonth()]; const ed = e.getDate();
  return sm === em ? `${sm} ${sd}–${ed}` : `${sm} ${sd} – ${em} ${ed}`;
}

function calcNights(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  return Math.round((new Date(end + 'T12:00:00').getTime() - new Date(start + 'T12:00:00').getTime()) / 86400000);
}

function formatWhoIsIn(respondents: Respondent[]): string | null {
  if (respondents.length === 0) return null;
  const names = respondents.map((r) => r.name);
  if (names.length === 1) return `${names[0]} is in`;
  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(', ')} and ${last} are all in`;
}

// ─── Stage-aware hero config ──────────────────────────────────────────────────

const HERO_CONFIG: Record<TripStage, {
  bg: string;
  badge: string;
  badgeColor: string;
  titleColor: string;
  subtitleColor: string;
  pillBg: string;
  ctaLabel: string;
  ctaBg: string;
}> = {
  deciding:     { bg: '#F5F4F0', badge: 'DECIDING',       badgeColor: '#888',    titleColor: '#1A1A1A', subtitleColor: '#666',                pillBg: 'rgba(0,0,0,0.06)', ctaLabel: 'Chat with group!', ctaBg: '#D85A30' },
  confirmed:    { bg: '#DDE8D8', badge: "YOU'RE GOING",   badgeColor: '#3A7A55', titleColor: '#1A3020', subtitleColor: '#3A6045',             pillBg: 'rgba(255,255,255,0.55)', ctaLabel: 'Share with group!', ctaBg: '#235C38' },
  planning:     { bg: '#D8E4EE', badge: 'PLANNING',       badgeColor: '#2A5068', titleColor: '#0D2B3E', subtitleColor: '#2A5068',             pillBg: 'rgba(255,255,255,0.55)', ctaLabel: 'Chat with group!', ctaBg: '#1A4060' },
  experiencing: { bg: '#085041', badge: "YOU'RE HERE",    badgeColor: 'rgba(255,255,255,0.7)', titleColor: '#FFFFFF', subtitleColor: 'rgba(255,255,255,0.75)', pillBg: 'rgba(255,255,255,0.15)', ctaLabel: 'Chat with group!', ctaBg: 'rgba(255,255,255,0.2)' },
  reconciling:  { bg: '#F0EDE8', badge: 'WRAPPING UP',    badgeColor: '#666',    titleColor: '#2C2C2A', subtitleColor: '#666',                pillBg: 'rgba(0,0,0,0.06)', ctaLabel: 'Chat with group!', ctaBg: '#2C2C2A' },
  done:         { bg: '#2C2C2A', badge: 'DONE',           badgeColor: 'rgba(255,255,255,0.5)', titleColor: '#FFFFFF', subtitleColor: 'rgba(255,255,255,0.6)', pillBg: 'rgba(255,255,255,0.1)', ctaLabel: 'Chat with group!', ctaBg: 'rgba(255,255,255,0.15)' },
};

// ─── Group Members Card ───────────────────────────────────────────────────────

function GroupMembersCard({
  trip,
  respondents,
  onViewRoster,
  editMode = false,
}: {
  trip: Trip;
  respondents: Respondent[];
  onViewRoster: () => void;
  editMode?: boolean;
}) {
  const memberCount = respondents.length;
  const total = trip.group_size_precise ?? GROUP_SIZE_MIDPOINTS[trip.group_size_bucket];

  return (
    <Pressable
      onPress={editMode ? undefined : onViewRoster}
      style={styles.membersCard}
      accessibilityRole="button"
      accessibilityLabel="View group members"
    >
      <View style={styles.entryIcon}>
        <Ionicons name="people-outline" size={20} color="#555" />
      </View>
      <View style={styles.entryText}>
        <Text style={styles.entryTitle}>Group members</Text>
        <Text style={styles.entrySubtitle}>
          {memberCount === 0
            ? 'No one else has joined yet'
            : `${memberCount} of ${total} joined`}
        </Text>
      </View>
      {editMode
        ? <Ionicons name="reorder-three-outline" size={20} color="#CCC" />
        : <Ionicons name="chevron-forward" size={16} color="#CCC" />
      }
    </Pressable>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TripDashboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();


  const { data: trip } = useTrip(id);
  const { data: polls = [] } = usePolls(id);
  const { data: respondents = [] } = useRespondents(id);
  const { canEditTrip, canReorderCards } = usePermissions(id);

  // Realtime: keep badge counts fresh
  const pollIdString = useMemo(() => polls.map((p) => p.id).sort().join(','), [polls]);
  useEffect(() => {
    const channel = supabase
      .channel(`trip-dashboard:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'respondents', filter: `trip_id=eq.${id}` },
        () => queryClient.invalidateQueries({ queryKey: respondentKeys.forTrip(id) }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'polls', filter: `trip_id=eq.${id}` },
        () => queryClient.invalidateQueries({ queryKey: pollKeys.forTrip(id) }))
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [id, pollIdString]);

  useEffect(() => {
    if (id) capture(Events.TRIP_VIEWED, { trip_id: id });
  }, [id]);

  const decidedPolls = useMemo(() => polls.filter((p) => p.status === 'decided'), [polls]);
  const livePolls = useMemo(() => polls.filter((p) => p.status === 'live'), [polls]);

const stage = trip ? getTripStage(trip) : 'deciding';
  const hero = HERO_CONFIG[stage];

  // Hero content
  const destPoll   = decidedPolls.find((p) => p.type === 'destination');
  const budgetPoll = decidedPolls.find((p) => p.type === 'budget');

  // Both date-range and duration polls share type='dates'. Split them by whether
  // the decided option label parses as a calendar date range.
  const decidedDatesPolls = decidedPolls.filter((p) => p.type === 'dates');
  const datesPoll = decidedDatesPolls.find((p) => {
    const label = p.poll_options.find((o) => o.id === p.decided_option_id)?.label ?? '';
    return parseDateRangeLabel(label) !== null;
  });
  const decidedDurationPoll = decidedDatesPolls.find((p) => {
    const label = p.poll_options.find((o) => o.id === p.decided_option_id)?.label ?? '';
    return parseDateRangeLabel(label) === null;
  });

  const decidedDestination2   = destPoll?.poll_options.find((o) => o.id === destPoll.decided_option_id)?.label ?? null;
  const decidedDatesLabel     = datesPoll?.poll_options.find((o) => o.id === datesPoll.decided_option_id)?.label ?? null;
  const decidedDurationLabel  = decidedDurationPoll?.poll_options.find((o) => o.id === decidedDurationPoll.decided_option_id)?.label ?? null;
  const decidedBudgetLabel    = budgetPoll?.poll_options.find((o) => o.id === budgetPoll.decided_option_id)?.label ?? null;

  // Priority: planner-entered destination > decided poll > trip name
  const destination = trip?.destination ?? decidedDestination2 ?? trip?.name ?? '';
  const dateRange = formatDateRange(trip?.start_date ?? null, trip?.end_date ?? null);
  const nights = calcNights(trip?.start_date ?? null, trip?.end_date ?? null);
  const whoIsIn = formatWhoIsIn(respondents);

  // If we have explicit dates, show those; otherwise fall back to decided dates poll label
  const dateDisplay = dateRange ?? decidedDatesLabel ?? null;
  const sizeLabel = trip?.group_size_precise != null ? `${trip.group_size_precise} people` : `${trip?.group_size_bucket ?? ''} people`;

  // Budget / duration: explicit trip field takes precedence, then decided poll
  const budgetDisplay   = trip?.budget_per_person ?? decidedBudgetLabel ?? null;
  const durationDisplay = trip?.trip_duration ?? decidedDurationLabel ?? null;

  // Poll badge
  const pollBadge = livePolls.length > 0 ? `${livePolls.length} live` : polls.length > 0 ? `${polls.length} polls` : null;

  const handleShare = () => {
    if (!trip) return;
    const url = getShareUrl(trip.share_token);

    // Build an exciting trip summary message
    const lines: string[] = [];
    lines.push(`🎉 ${trip.name} is officially happening!`);
    if (destination) lines.push(`📍 ${destination}`);
    if (dateDisplay) lines.push(`📅 ${dateDisplay}`);
    const details: string[] = [];
    if (trip.group_size_precise) details.push(`${trip.group_size_precise} people`);
    if (budgetDisplay) details.push(`${budgetDisplay} pp`);
    if (details.length > 0) lines.push(`👥 ${details.join(' · ')}`);
    lines.push('');
    lines.push(`Confirm you're in and share your preferences:`);
    lines.push(url);
    const msg = lines.join('\n');

    const encoded = encodeURIComponent(msg);
    Alert.alert('Share with group', 'Choose how to send:', [
      { text: 'iMessage / SMS', onPress: () => Linking.openURL(Platform.OS === 'ios' ? `sms:&body=${encoded}` : `sms:?body=${encoded}`) },
      { text: 'WhatsApp', onPress: () => Linking.openURL(`whatsapp://send?text=${encoded}`) },
      { text: 'More options…', onPress: async () => { try { await Share.share({ message: msg }); } catch {} } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const openMapsSheet = () => {
    if (!destination) return;
    const mapQuery = trip?.destination_address ?? destination;
    const encoded = encodeURIComponent(mapQuery);
    const actions = [
      { label: 'Open in Apple Maps', url: `maps://?q=${encoded}` },
      { label: 'Open in Google Maps', url: `https://maps.google.com/?q=${encoded}` },
      { label: 'Open in Waze', url: `waze://?q=${encoded}` },
    ];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: destination,
          message: trip?.destination_address ?? undefined,
          options: ['Cancel', ...actions.map((a) => a.label), 'Copy address'],
          cancelButtonIndex: 0,
        },
        (i) => {
          if (i >= 1 && i <= 3) Linking.openURL(actions[i - 1].url).catch(() => {});
          if (i === 4) Clipboard.setStringAsync(mapQuery);
        },
      );
    } else {
      Alert.alert(destination, trip?.destination_address ?? undefined, [
        { text: 'Google Maps', onPress: () => Linking.openURL(actions[1].url).catch(() => {}) },
        { text: 'Waze', onPress: () => Linking.openURL(actions[2].url).catch(() => {}) },
        { text: 'Copy address', onPress: () => Clipboard.setStringAsync(mapQuery) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const handleCtaPress = () => {
    if (stage === 'confirmed') {
      handleShare();
    } else {
      router.push(`/(app)/trips/${id}/hub?tab=chat`);
    }
  };

  const ENTRY_CONFIG: Record<Exclude<CardKey, 'members'>, {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    title: string;
    subtitle: string;
    onPress: () => void;
  }> = useMemo(() => ({
    polls: {
      icon: 'stats-chart-outline',
      title: 'Polls',
      subtitle: pollBadge ?? 'Vote on destination, dates & more',
      onPress: () => router.push(`/(app)/trips/${id}/polls`),
    },
    itinerary: {
      icon: 'calendar-outline',
      title: 'Itinerary',
      subtitle: nights ? `${nights}-day plan` : 'Build your day-by-day plan',
      onPress: () => router.push(`/(app)/trips/${id}/hub?tab=itinerary`),
    },
    lodging: {
      icon: 'bed-outline',
      title: 'Lodging',
      subtitle: 'Find a place to stay',
      onPress: () => router.push(`/(app)/trips/${id}/hub?tab=lodging`),
    },
    travel: {
      icon: 'airplane-outline',
      title: 'Travel',
      subtitle: 'Flights, trains, cars & more',
      onPress: () => router.push(`/(app)/trips/${id}/hub?tab=travel`),
    },
    expenses: {
      icon: 'receipt-outline',
      title: 'Expenses',
      subtitle: 'Track and split costs',
      onPress: () => router.push(`/(app)/trips/${id}/hub?tab=expenses`),
    },
  }), [id, nights, pollBadge, router]);

  const renderCard = useCallback((key: CardKey, isEditMode: boolean) => {
    if (key === 'members') {
      if (!trip) return null;
      return (
        <GroupMembersCard
          trip={trip}
          respondents={respondents}
          onViewRoster={() => router.push(`/(app)/trips/${id}/members`)}
          editMode={isEditMode}
        />
      );
    }
    const ep = ENTRY_CONFIG[key as Exclude<CardKey, 'members'>];
    if (!ep) return null;
    return (
      <Pressable
        onPress={isEditMode ? undefined : ep.onPress}
        style={styles.entryCard}
        accessibilityRole="button"
      >
        <View style={styles.entryIcon}>
          <Ionicons name={ep.icon} size={20} color="#555" />
        </View>
        <View style={styles.entryText}>
          <Text style={styles.entryTitle}>{ep.title}</Text>
          <Text style={styles.entrySubtitle}>{ep.subtitle}</Text>
        </View>
        {isEditMode
          ? <Ionicons name="reorder-three-outline" size={20} color="#CCC" />
          : <Ionicons name="chevron-forward" size={16} color="#CCC" />
        }
      </Pressable>
    );
  }, [ENTRY_CONFIG, trip, respondents, router, id]);

  return (
    <>
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleShare} accessibilityRole="button" hitSlop={8}>
          <Ionicons name="share-outline" size={18} color="#888" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        {/* Hero card — planners can tap to edit rally details */}
        <TouchableOpacity
          onPress={canEditTrip ? () => router.push(`/(app)/trips/${id}/edit`) : undefined}
          activeOpacity={canEditTrip ? 0.85 : 1}
          accessibilityRole={canEditTrip ? 'button' : 'none'}
          accessibilityLabel={canEditTrip ? 'Edit rally details' : undefined}
          style={[styles.heroCard, { backgroundColor: hero.bg }]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.heroBadge, { color: hero.badgeColor }]}>{hero.badge}</Text>
          </View>
          {destination ? (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); openMapsSheet(); }}
              activeOpacity={0.75}
              accessibilityRole="link"
              accessibilityLabel={`Directions to ${destination}`}
            >
              <Text style={[styles.heroTitle, styles.heroTitleLink, { color: hero.titleColor }]}>
                {destination}
              </Text>
            </TouchableOpacity>
          ) : null}
          {dateDisplay ? (
            <Text style={[styles.heroTitle, { color: hero.titleColor }]}>{dateDisplay}</Text>
          ) : null}
          {whoIsIn ? (
            <Text style={[styles.heroSubtitle, { color: hero.subtitleColor }]}>{whoIsIn}</Text>
          ) : null}

          {/* Info pills */}
          <View style={styles.pillRow}>
            <View style={[styles.pill, { backgroundColor: hero.pillBg }]}>
              <Text style={[styles.pillText, { color: hero.titleColor }]}>{sizeLabel}</Text>
            </View>
            {nights ? (
              <View style={[styles.pill, { backgroundColor: hero.pillBg }]}>
                <Text style={[styles.pillText, { color: hero.titleColor }]}>{nights} nights</Text>
              </View>
            ) : durationDisplay ? (
              <View style={[styles.pill, { backgroundColor: hero.pillBg }]}>
                <Text style={[styles.pillText, { color: hero.titleColor }]}>{durationDisplay}</Text>
              </View>
            ) : null}
            {budgetDisplay ? (
              <View style={[styles.pill, { backgroundColor: hero.pillBg }]}>
                <Text style={[styles.pillText, { color: hero.titleColor }]}>{budgetDisplay} pp</Text>
              </View>
            ) : null}
            {trip?.trip_type ? trip.trip_type.split(',').map((t) => (
              <View key={t} style={[styles.pill, { backgroundColor: hero.pillBg }]}>
                <Text style={[styles.pillText, { color: hero.titleColor }]}>{t.trim()}</Text>
              </View>
            )) : null}
          </View>

          {/* CTA — stop propagation so it doesn't also trigger the hero card's edit nav */}
          <Pressable
            onPress={(e) => { e.stopPropagation(); handleCtaPress(); }}
            style={[styles.ctaBtn, { backgroundColor: hero.ctaBg }]}
            accessibilityRole="button"
          >
            <Text style={[styles.ctaText, { color: stage === 'experiencing' || stage === 'done' ? hero.titleColor : '#fff' }]}>
              {hero.ctaLabel}
            </Text>
          </Pressable>
        </TouchableOpacity>


        {/* Entry points — long-press any card to reorder */}
        <Text style={styles.sectionLabel}>Where do you want to start?</Text>

        <SortableEntryList tripId={id} renderCard={renderCard} reorderEnabled={canReorderCards} />
      </ScrollView>
    </View>

    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F4F0' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  backBtn: { fontSize: 15, color: '#888' },
  scroll: { paddingHorizontal: 16 },

  // Hero
  heroCard: { borderRadius: 24, padding: 24, gap: 10, marginBottom: 8 },
  heroBadge: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  heroTitle: { fontSize: 30, fontWeight: '800', lineHeight: 36 },
  heroTitleLink: { textDecorationLine: 'underline' },
  heroSubtitle: { fontSize: 15, lineHeight: 22 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  pill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  pillText: { fontSize: 13 },
  ctaBtn: { marginTop: 8, borderRadius: 999, paddingVertical: 16, alignItems: 'center' },
  ctaText: { fontSize: 16, fontWeight: '600' },

  // Entry points
  sectionLabel: { fontSize: 13, color: '#999', textAlign: 'center', marginVertical: 16 },
  entryList: { gap: 10 },
  entryCard: {
    backgroundColor: 'white', borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1, borderColor: '#EBEBEB',
  },
  entryIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#F3F3F3', alignItems: 'center', justifyContent: 'center',
  },
  entryText: { flex: 1, gap: 2 },
  entryTitle: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  entrySubtitle: { fontSize: 13, color: '#888', lineHeight: 18 },

  // Group members card
  membersCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    backgroundColor: 'white',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EBEBEB',
  },
  memberList: {
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    paddingHorizontal: 16,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
  },
  memberRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E8F4EE',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  memberAvatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#235C38',
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  memberContact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  memberContactText: {
    fontSize: 12,
    color: '#888',
    flex: 1,
  },
  memberNoContact: {
    fontSize: 12,
    color: '#C0C0C0',
    fontStyle: 'italic',
  },
  memberExpandedBody: {
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    padding: 16,
    gap: 12,
  },
  memberProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  memberProgressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EBEBEB',
    overflow: 'hidden',
  },
  memberProgressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#235C38',
  },
  memberProgressLabel: {
    fontSize: 12,
    color: '#888',
    minWidth: 60,
    textAlign: 'right',
  },
  joinLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F7F7F5',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  joinLinkText: {
    flex: 1,
    fontSize: 12,
    color: '#888',
  },
  joinShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#235C38',
    paddingVertical: 10,
  },
  joinShareBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#235C38',
  },
  viewRosterBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  viewRosterText: {
    fontSize: 13,
    color: '#235C38',
    fontWeight: '600',
  },
  memberEmptyText: {
    fontSize: 13,
    color: '#A0A0A0',
    lineHeight: 18,
    textAlign: 'center',
  },
});
