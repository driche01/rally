/**
 * Trip Hub — Phase 2 entry point.
 *
 * Shown after a planner unlocks Phase 2 for a trip.
 * Hosts a custom bottom tab bar: Polls | Itinerary | Lodging | Travel | Expenses
 *
 * Navigation: pushed from the trip detail (index.tsx) after Phase 2 unlock.
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTrip } from '@/hooks/useTrips';
import { usePermissions } from '@/hooks/usePermissions';
import { getTripStage, STAGE_ACCENT } from '@/lib/tripStage';

// Tab content components
import { PollsTab } from '@/components/hub/PollsTab';
import { ItineraryTab } from '@/components/hub/ItineraryTab';
import { LodgingTab } from '@/components/hub/LodgingTab';
import { TravelTab } from '@/components/hub/TravelTab';
import { ExpensesTab } from '@/components/hub/ExpensesTab';

// ─── Tab definitions ─────────────────────────────────────────────────────────

type TabId = 'polls' | 'itinerary' | 'lodging' | 'travel' | 'expenses';

// ─── Hub screen ──────────────────────────────────────────────────────────────

export default function TripHubScreen() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: trip } = useTrip(id);
  const accentColor = STAGE_ACCENT[trip ? getTripStage(trip) : 'deciding'];
  const {
    isPlanner,
    canManagePolls,
    canManageItinerary,
    canManageLodging,
    canManageTravel,
    canManageExpenses,
  } = usePermissions(id);

  const [activeTab, setActiveTab] = useState<TabId>(
    (initialTab as TabId | undefined) ?? 'itinerary'
  );

  function renderTab() {
    switch (activeTab) {
      case 'polls':     return <PollsTab tripId={id} isPlanner={canManagePolls} />;
      case 'itinerary': return <ItineraryTab tripId={id} isPlanner={canManageItinerary} />;
      case 'lodging':   return <LodgingTab tripId={id} isPlanner={canManageLodging} />;
      case 'travel':    return <TravelTab tripId={id} isPlanner={canManageTravel} />;
      case 'expenses':  return <ExpensesTab tripId={id} isPlanner={canManageExpenses} />;
    }
  }

  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View className="flex-row items-center justify-between border-b border-line bg-cream px-6 pb-3 pt-4">
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text className="text-base" style={{ color: accentColor }}>← Back</Text>
        </Pressable>
        <View className="flex-1 items-center px-4">
          <Text className="text-base text-ink" style={{ fontFamily: 'SpaceGrotesk_700Bold' }} numberOfLines={1}>
            {trip?.name ?? ''}
          </Text>
          {trip?.start_date && trip?.end_date ? (
            <Text className="text-xs text-muted">
              {formatDateRange(trip.start_date, trip.end_date)}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* ── Active tab content ────────────────────────────────────────── */}
      <View className="flex-1" style={{ paddingBottom: insets.bottom }}>
        {renderTab()}
      </View>


    </View>
  );
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (s.getFullYear() !== e.getFullYear()) {
    return `${s.toLocaleDateString('en-US', { ...opts, year: 'numeric' })} – ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
  }
  if (s.getMonth() !== e.getMonth()) {
    return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`;
  }
  return `${s.toLocaleDateString('en-US', { month: 'short' })} ${s.getDate()}–${e.getDate()}`;
}
