/**
 * Trip Recap — F9 Post-trip moment.
 *
 * Shown automatically when a planner closes a trip from the Hub.
 * Celebrates the completed trip and offers one-tap to start the next one
 * with the same group size pre-filled.
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTrip, useCreateTrip } from '@/hooks/useTrips';
import { useRespondents } from '@/hooks/useRespondents';
import { useItineraryBlocks } from '@/hooks/useItinerary';
import { useExpenses } from '@/hooks/useExpenses';
import { usePolls } from '@/hooks/usePolls';
import { capture } from '@/lib/analytics';

export default function TripRecapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: trip } = useTrip(id);
  const { data: respondents = [] } = useRespondents(id);
  const { data: blocks = [] } = useItineraryBlocks(id);
  const { data: expenses = [] } = useExpenses(id);
  const { data: polls = [] } = usePolls(id);

  const createTrip = useCreateTrip();

  // Fade-in animation
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [opacity]);

  // ── Derived stats ──────────────────────────────────────────────────────────

  const totalExpensesCents = expenses.reduce((sum, e) => sum + e.amount_cents, 0);

  const decidedPoll = polls.find((p) => p.status === 'decided' && p.type === 'destination');
  const decidedDestination =
    decidedPoll?.poll_options.find((o) => o.id === decidedPoll.decided_option_id)?.label ?? null;

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleStartNextTrip() {
    if (!trip) return;
    try {
      const newTrip = await createTrip.mutateAsync({
        name: trip.name,
        group_size_bucket: trip.group_size_bucket,
        group_size_precise: trip.group_size_precise,
      });
      capture('trip_created_from_recap', { source_trip_id: id });
      router.replace(`/(app)/trips/${newTrip.id}`);
    } catch {
      // Stay on recap — user can tap again or navigate home manually
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function formatDateRange(start: string | null, end: string | null): string | null {
    if (!start || !end) return null;
    const s = new Date(start + 'T12:00:00');
    const e = new Date(end + 'T12:00:00');
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    if (s.getFullYear() !== e.getFullYear()) {
      return `${s.toLocaleDateString('en-US', { ...opts, year: 'numeric' })} – ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
    }
    return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`;
  }

  const dateRange = trip ? formatDateRange(trip.start_date, trip.end_date) : null;
  const expensesTotal =
    totalExpensesCents > 0
      ? `$${(totalExpensesCents / 100).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Animated.View className="flex-1 bg-neutral-50" style={{ opacity, paddingTop: insets.top }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 48 }}
        showsVerticalScrollIndicator={false}
      >

        {/* Hero */}
        <View className="items-center pt-12 pb-8">
          <Text style={{ fontSize: 56, marginBottom: 16 }}>🎉</Text>
          <Text className="text-3xl font-bold text-neutral-800 text-center mb-2">
            What a trip!
          </Text>
          {trip ? (
            <Text className="text-lg font-semibold text-coral-500 text-center">
              {trip.name}
            </Text>
          ) : null}
          {dateRange ? (
            <Text className="mt-1 text-sm text-neutral-400">{dateRange}</Text>
          ) : null}
          {decidedDestination ? (
            <View className="mt-3 flex-row items-center gap-1.5">
              <Ionicons name="location-outline" size={14} color="#D85A30" />
              <Text className="text-sm font-medium text-coral-600">{decidedDestination}</Text>
            </View>
          ) : null}
        </View>

        {/* Stats row */}
        <View className="mb-8 flex-row gap-3">
          <StatCard
            icon="people-outline"
            value={respondents.length}
            label={respondents.length === 1 ? 'attendee' : 'attendees'}
          />
          <StatCard
            icon="calendar-outline"
            value={blocks.length}
            label={blocks.length === 1 ? 'activity' : 'activities'}
          />
          {expensesTotal ? (
            <StatCard icon="receipt-outline" value={expensesTotal} label="tracked" />
          ) : (
            <StatCard
              icon="receipt-outline"
              value={expenses.length}
              label={expenses.length === 1 ? 'expense' : 'expenses'}
            />
          )}
        </View>

        {/* Divider */}
        <View className="h-px bg-neutral-200 mb-8" />

        {/* Next trip CTA */}
        <View className="gap-4">
          <Text className="text-lg font-bold text-neutral-800 text-center">
            Ready for the next trip?
          </Text>
          <Text className="text-sm text-neutral-500 text-center leading-5">
            Your crew size is pre-filled.{'\n'}Just pick a destination and let's go again.
          </Text>

          <Pressable
            onPress={handleStartNextTrip}
            disabled={createTrip.isPending || !trip}
            className="items-center justify-center rounded-2xl bg-coral-500 py-4"
            style={{
              opacity: createTrip.isPending || !trip ? 0.7 : 1,
              shadowColor: '#D85A30',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 6,
            }}
            accessibilityRole="button"
          >
            {createTrip.isPending ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-base font-bold text-white">Plan another rally →</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => router.replace('/(app)/(tabs)')}
            className="items-center py-3"
            accessibilityRole="button"
          >
            <Text className="text-sm text-neutral-400">Back to all rallies</Text>
          </Pressable>
        </View>

      </ScrollView>
    </Animated.View>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  value: number | string;
  label: string;
}) {
  return (
    <View
      className="flex-1 items-center rounded-2xl bg-white py-4 px-3 gap-1"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 2,
      }}
    >
      <Ionicons name={icon} size={20} color="#D85A30" />
      <Text className="text-xl font-bold text-neutral-800">{value}</Text>
      <Text className="text-xs text-neutral-400 text-center">{label}</Text>
    </View>
  );
}
