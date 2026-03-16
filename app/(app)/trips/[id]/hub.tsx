/**
 * Trip Hub — Phase 2 entry point.
 *
 * Shown after a planner unlocks Phase 2 for a trip.
 * Hosts a custom bottom tab bar: Polls | Itinerary | Lodging | Expenses | Chat
 *
 * Navigation: pushed from the trip detail (index.tsx) after Phase 2 unlock.
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTrip, useCloseTrip } from '@/hooks/useTrips';
import { capture } from '@/lib/analytics';

// Tab content components
import { PollsTab } from '@/components/hub/PollsTab';
import { ItineraryTab } from '@/components/hub/ItineraryTab';
import { LodgingTab } from '@/components/hub/LodgingTab';
import { ChatTab } from '@/components/hub/ChatTab';
import { ExpensesTab } from '@/components/hub/ExpensesTab';

// ─── Tab definitions ─────────────────────────────────────────────────────────

type TabId = 'polls' | 'itinerary' | 'lodging' | 'expenses' | 'chat';

const TABS: {
  id: TabId;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconActive: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { id: 'polls',     label: 'Polls',     icon: 'stats-chart-outline',  iconActive: 'stats-chart' },
  { id: 'itinerary', label: 'Itinerary', icon: 'calendar-outline',     iconActive: 'calendar' },
  { id: 'lodging',   label: 'Lodging',   icon: 'home-outline',         iconActive: 'home' },
  { id: 'expenses',  label: 'Expenses',  icon: 'receipt-outline',      iconActive: 'receipt' },
  { id: 'chat',      label: 'Chat',      icon: 'chatbubble-outline',   iconActive: 'chatbubble' },
];

// ─── Hub screen ──────────────────────────────────────────────────────────────

export default function TripHubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: trip } = useTrip(id);

  const [activeTab, setActiveTab] = useState<TabId>('itinerary');
  const closeTrip = useCloseTrip();

  function handleCloseTrip() {
    Alert.alert(
      'Close this trip?',
      'This marks the trip as complete. Your data stays intact.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close trip',
          style: 'destructive',
          onPress: async () => {
            try {
              await closeTrip.mutateAsync(id);
              capture('trip_closed', { trip_id: id });
              router.replace(`/(app)/trips/${id}/recap`);
            } catch {
              Alert.alert('Error', 'Could not close the trip. Please try again.');
            }
          },
        },
      ]
    );
  }

  function renderTab() {
    switch (activeTab) {
      case 'polls':     return <PollsTab tripId={id} />;
      case 'itinerary': return <ItineraryTab tripId={id} />;
      case 'lodging':   return <LodgingTab tripId={id} />;
      case 'expenses':  return <ExpensesTab tripId={id} />;
      case 'chat':      return <ChatTab tripId={id} />;
    }
  }

  return (
    <View className="flex-1 bg-neutral-50" style={{ paddingTop: insets.top }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View className="flex-row items-center justify-between border-b border-neutral-200 bg-neutral-50 px-6 pb-3 pt-4">
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text className="text-base text-coral-500">← Trips</Text>
        </Pressable>
        <View className="flex-1 items-center px-4">
          <Text className="text-base font-bold text-neutral-800" numberOfLines={1}>
            {trip?.name ?? ''}
          </Text>
          {trip?.start_date && trip?.end_date ? (
            <Text className="text-xs text-neutral-400">
              {formatDateRange(trip.start_date, trip.end_date)}
            </Text>
          ) : null}
        </View>
        {/* Close trip */}
        <Pressable
          onPress={handleCloseTrip}
          style={{ width: 60, alignItems: 'flex-end' }}
          accessibilityRole="button"
          accessibilityLabel="Close trip"
        >
          <Ionicons name="checkmark-done-outline" size={22} color="#A8A8A8" />
        </Pressable>
      </View>

      {/* ── Active tab content ────────────────────────────────────────── */}
      <View className="flex-1">
        {renderTab()}
      </View>

      {/* ── Custom tab bar ───────────────────────────────────────────── */}
      <View
        style={{ paddingBottom: insets.bottom }}
        className="border-t border-neutral-200 bg-white"
      >
        <View className="flex-row">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                className="flex-1 items-center py-2"
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
              >
                <Ionicons
                  name={isActive ? tab.iconActive : tab.icon}
                  size={22}
                  color={isActive ? '#FF6B5B' : '#A8A8A8'}
                />
                <Text
                  className={[
                    'mt-0.5 text-[10px]',
                    isActive ? 'font-semibold text-coral-500' : 'text-neutral-400',
                  ].join(' ')}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
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
