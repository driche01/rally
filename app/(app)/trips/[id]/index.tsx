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
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SortableEntryList, type CardKey } from '@/components/SortableEntryList';
import { TripDashboardCards } from '@/components/trips/TripDashboardCards';
import { FirstTripOnboardingModal } from '@/components/trips/FirstTripOnboardingModal';
import { useTripSession } from '@/hooks/useTripSession';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePolls, pollKeys } from '@/hooks/usePolls';
import { useRespondents, respondentKeys } from '@/hooks/useRespondents';
import { useTrip } from '@/hooks/useTrips';
import { useItineraryBlocks } from '@/hooks/useItinerary';
import { useLodgingOptions } from '@/hooks/useLodging';
import { useTravelLegs } from '@/hooks/useTravelLegs';
import { useExpenses } from '@/hooks/useExpenses';
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
  ctaBg: string;
}> = {
  // 2026-04-24 brand palette: dark moody backgrounds preserved, but BLUE
  // (#0A1828, #1563B0) and bright greens (#1A9E5A) shifted into our deep-green
  // primary family. ctaLabel was dropped when the per-stage CTA was
  // collapsed into a single "Poll link" pill — but each stage still
  // tints the pill via ctaBg.
  deciding:     { bg: '#1A1715', badge: 'FIGURING IT OUT', badgeColor: 'rgba(255,255,255,0.45)', titleColor: '#FFFFFF', subtitleColor: 'rgba(255,255,255,0.6)', pillBg: 'rgba(255,255,255,0.1)', ctaBg: '#0F3F2E' },
  confirmed:    { bg: '#0C2218', badge: 'CONFIRMED',        badgeColor: 'rgba(255,255,255,0.5)', titleColor: '#FFFFFF', subtitleColor: 'rgba(255,255,255,0.65)', pillBg: 'rgba(255,255,255,0.1)', ctaBg: '#0F3F2E' },
  planning:     { bg: '#0F2620', badge: 'PLANNING',        badgeColor: 'rgba(255,255,255,0.5)', titleColor: '#FFFFFF', subtitleColor: 'rgba(255,255,255,0.65)', pillBg: 'rgba(255,255,255,0.1)', ctaBg: '#0F3F2E' },
  experiencing: { bg: '#042E26', badge: 'TRIP IS ON!',     badgeColor: 'rgba(255,255,255,0.7)', titleColor: '#FFFFFF', subtitleColor: 'rgba(255,255,255,0.75)', pillBg: 'rgba(255,255,255,0.15)', ctaBg: 'rgba(255,255,255,0.2)' },
  reconciling:  { bg: '#1A1715', badge: 'SORTING IT OUT',  badgeColor: 'rgba(255,255,255,0.45)', titleColor: '#FFFFFF', subtitleColor: 'rgba(255,255,255,0.6)', pillBg: 'rgba(255,255,255,0.1)', ctaBg: '#555552' },
  done:         { bg: '#1A1715', badge: 'WHAT A TRIP!',    badgeColor: 'rgba(255,255,255,0.5)', titleColor: '#FFFFFF', subtitleColor: 'rgba(255,255,255,0.6)', pillBg: 'rgba(255,255,255,0.1)', ctaBg: 'rgba(255,255,255,0.15)' },
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
  const confirmedCount = 1 + respondents.length;
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
        <Text style={styles.entryTitle}>Group</Text>
        <Text style={styles.entrySubtitle}>
          {respondents.length === 0
            ? 'No one else in yet'
            : `${confirmedCount} of ${total} in`}
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
  const { data: tripSession } = useTripSession(id);
  const { data: polls = [] } = usePolls(id);
  const { data: respondents = [] } = useRespondents(id);
  const { canEditTrip, canReorderCards } = usePermissions(id);
  const { data: itineraryBlocks = [] } = useItineraryBlocks(id);
  const { data: lodgingOptions = [] } = useLodgingOptions(id);
  const { data: travelLegs = [] } = useTravelLegs(id);
  const { data: expenses = [] } = useExpenses(id);
  const [linkCopied, setLinkCopied] = useState(false);

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

  const handleLinkIconPress = () => {
    if (!trip) return;

    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const fmtDate = (iso: string | null) => {
      if (!iso) return '';
      const [, m, d] = iso.split('-');
      return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
    };
    const fmtTime = (t: string | null) => {
      if (!t) return '';
      const [h, min] = t.split(':');
      const hour = parseInt(h, 10);
      return `${hour % 12 || 12}:${min} ${hour < 12 ? 'AM' : 'PM'}`;
    };
    const today = new Date().toISOString().split('T')[0];

    let text = '';

    if (stage === 'deciding' || stage === 'confirmed') {
      // Copy invite link
      Clipboard.setStringAsync(getShareUrl(trip.share_token));
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
      return;
    }

    if (stage === 'planning') {
      const lines: string[] = [`📋 ${trip.name ?? 'Trip'} — Plan Details`];
      if (destination) lines.push(`📍 ${destination}`);
      if (dateDisplay) lines.push(`📅 ${dateDisplay}`);
      lines.push('');

      // Itinerary
      if (itineraryBlocks.length > 0) {
        const byDay = itineraryBlocks.reduce<Record<string, typeof itineraryBlocks>>((acc, b) => {
          (acc[b.day_date] = acc[b.day_date] ?? []).push(b);
          return acc;
        }, {});
        lines.push('📅 ITINERARY');
        Object.keys(byDay).sort().forEach((date) => {
          lines.push(`\n${fmtDate(date)}`);
          byDay[date].sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '')).forEach((b) => {
            const time = b.start_time ? `${fmtTime(b.start_time)} ` : '';
            lines.push(`  ${time}${b.title}${b.location ? ` @ ${b.location}` : ''}`);
          });
        });
        lines.push('');
      }

      // Lodging
      if (lodgingOptions.length > 0) {
        lines.push('🏠 LODGING');
        lodgingOptions.forEach((o) => {
          const status = o.status === 'booked' ? '✓ Booked' : 'Option';
          lines.push(`  ${status}: ${o.title}`);
          if (o.check_in_date || o.check_out_date) {
            lines.push(`  Check-in: ${fmtDate(o.check_in_date)} → Check-out: ${fmtDate(o.check_out_date)}`);
          }
          if (o.url) lines.push(`  🔗 ${o.url}`);
        });
        lines.push('');
      }

      // Travel
      if (travelLegs.length > 0) {
        lines.push('✈️ TRAVEL');
        travelLegs.forEach((leg) => {
          lines.push(`  ${leg.mode.charAt(0).toUpperCase() + leg.mode.slice(1)}: ${leg.label}`);
          if (leg.departure_date || leg.departure_time) {
            lines.push(`  Departs: ${[fmtDate(leg.departure_date), fmtTime(leg.departure_time)].filter(Boolean).join(' at ')}`);
          }
          if (leg.arrival_date || leg.arrival_time) {
            lines.push(`  Arrives: ${[fmtDate(leg.arrival_date), fmtTime(leg.arrival_time)].filter(Boolean).join(' at ')}`);
          }
          if (leg.booking_ref) lines.push(`  Ref: ${leg.booking_ref}`);
        });
      }
      text = lines.join('\n');
    }

    if (stage === 'experiencing') {
      const todayBlocks = itineraryBlocks
        .filter((b) => b.day_date === today)
        .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));
      const lines: string[] = [`📅 Today — ${fmtDate(today)}`, `📍 ${destination}`];
      if (todayBlocks.length === 0) {
        lines.push('No itinerary blocks for today.');
      } else {
        lines.push('');
        todayBlocks.forEach((b) => {
          const time = b.start_time ? `${fmtTime(b.start_time)} ` : '';
          const end = b.end_time ? `–${fmtTime(b.end_time)} ` : '';
          lines.push(`${time}${end}${b.title}${b.location ? ` @ ${b.location}` : ''}`);
          if (b.notes) lines.push(`  ${b.notes}`);
        });
      }
      text = lines.join('\n');
    }

    if (stage === 'reconciling') {
      const lines: string[] = [`💰 ${trip.name ?? 'Trip'} — Expenses`];
      if (destination) lines.push(`📍 ${destination}`);
      lines.push('');
      if (expenses.length === 0) {
        lines.push('No expenses recorded yet.');
      } else {
        const total = expenses.reduce((sum, e) => sum + e.amount_cents, 0);
        expenses.forEach((e) => {
          const amt = `$${(e.amount_cents / 100).toFixed(2)}`;
          lines.push(`• ${e.description} — ${amt} (${e.category})`);
        });
        lines.push('');
        lines.push(`Total: $${(total / 100).toFixed(2)}`);
      }
      text = lines.join('\n');
    }

    if (stage === 'done') {
      const lines: string[] = [`🎉 ${trip.name ?? 'Trip'} Recap`];
      if (destination) lines.push(`📍 ${destination}`);
      if (dateDisplay) lines.push(`📅 ${dateDisplay}`);
      lines.push('');
      const highlights = itineraryBlocks
        .filter((b) => b.type === 'activity' || b.type === 'meal')
        .sort((a, b) => a.day_date.localeCompare(b.day_date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''))
        .slice(0, 8);
      if (highlights.length > 0) {
        lines.push('Highlights:');
        highlights.forEach((b) => lines.push(`• ${b.title}${b.location ? ` @ ${b.location}` : ''}`));
        lines.push('');
      }
      lines.push('What a trip! 🎉');
      text = lines.join('\n');
    }

    if (text) {
      Clipboard.setStringAsync(text);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const ENTRY_CONFIG: Record<Exclude<CardKey, 'members'>, {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    title: string;
    subtitle: string;
    onPress: () => void;
  }> = useMemo(() => ({
    itinerary: {
      icon: 'calendar-outline',
      title: 'Itinerary',
      subtitle: nights ? `${nights + 1}-day plan` : 'Build your day-by-day plan',
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
  }), [id, nights, router]);

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
    <FirstTripOnboardingModal trip={trip} />
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.backBtn}>← Back</Text>
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
          {/* Top row: stage eyebrow on the left, chevron cue on the right
              for planners (signals the whole card is tappable → edit). */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[styles.heroBadge, { color: hero.badgeColor }]}>{hero.badge}</Text>
            {canEditTrip ? (
              <Ionicons name="chevron-forward" size={18} color={hero.badgeColor} />
            ) : null}
          </View>

          {/* Trip name — eyebrow-style, sits above the location. */}
          {trip?.name ? (
            <Text style={[styles.heroTripName, { color: hero.subtitleColor }]} numberOfLines={1}>
              {trip.name}
            </Text>
          ) : null}

          {/* Location — primary visual. Tappable opens the maps sheet. */}
          {destination ? (
            <Pressable
              onPress={(e) => { e.stopPropagation(); openMapsSheet(); }}
              accessibilityRole="link"
              accessibilityLabel={`Directions to ${destination}`}
            >
              <Text style={[styles.heroTitle, { color: hero.titleColor }]}>
                {destination}
              </Text>
            </Pressable>
          ) : null}

          {/* Date — secondary, slightly smaller than the location. */}
          {dateDisplay ? (
            <Text style={[styles.heroDate, { color: hero.titleColor }]}>{dateDisplay}</Text>
          ) : null}

          {/* Participants line ("D R and David Riche are all in"). */}
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

          {/* "Poll link" pill — replaces the older Invite-your-group CTA
              + separate link icon. Single tap copies the share URL to
              clipboard (handler shows a checkmark for ~2s on success). */}
          {trip ? (
            <Pressable
              onPress={(e) => { e.stopPropagation(); handleLinkIconPress(); }}
              style={[styles.ctaBtn, { backgroundColor: hero.ctaBg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }]}
              accessibilityRole="button"
              accessibilityLabel="Copy poll link to clipboard"
            >
              <Ionicons
                name={linkCopied ? 'checkmark' : 'link-outline'}
                size={18}
                color={stage === 'experiencing' || stage === 'done' ? hero.titleColor : '#fff'}
              />
              <Text style={[styles.ctaText, { color: stage === 'experiencing' || stage === 'done' ? hero.titleColor : '#fff' }]}>
                {linkCopied ? 'Copied' : 'Poll link'}
              </Text>
            </Pressable>
          ) : null}
        </TouchableOpacity>


        {/* Coordination state — what needs the planner's attention now.
            Each child renders nothing when there's nothing to show, so
            this collapses to zero height on a brand-new trip. */}
        <View style={{ marginTop: 12 }}>
          <TripDashboardCards tripId={id} sessionId={tripSession?.id} />
        </View>

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
  heroTripName: { fontSize: 30, fontFamily: 'SpaceGrotesk_700Bold', lineHeight: 36 },
  heroTitle: { fontSize: 22, fontFamily: 'SpaceGrotesk_700Bold', lineHeight: 28 },
  heroDate: { fontSize: 14, fontWeight: '500', letterSpacing: 0.2 },
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
