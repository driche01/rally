import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, ImageBackground, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { TouchableOpacity } from 'react-native-gesture-handler';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProgressBar, Badge } from '@/components/ui';
import { PreciseGroupSizeModal } from '@/components/PreciseGroupSizeModal';
import { useDeleteTrip, useTripsWithRespondentCounts, useUpdateTrip } from '@/hooks/useTrips';
import { useSignOut } from '@/hooks/useAuth';
import { getParticipationRate } from '@/types/database';
import type { TripWithRespondentCount } from '@/lib/api/trips';

const SEASON_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  Winter: 'snow-outline',
  Spring: 'flower-outline',
  Summer: 'sunny-outline',
  Fall: 'leaf-outline',
};

function MemberBar({ memberCount, total }: { memberCount: number; total: number }) {
  const percent = Math.min(100, Math.round((memberCount / total) * 100));
  return (
    <View>
      <View className="mb-1 flex-row items-center justify-between">
        <View className="flex-row items-center gap-1">
          <Ionicons name="people-outline" size={12} color="#3B82F6" />
          <Text className="text-xs text-blue-500">
            {memberCount} of {total} joined
          </Text>
        </View>
        <Text className="text-xs text-blue-400">{percent}%</Text>
      </View>
      <View className="h-1.5 overflow-hidden rounded-full bg-blue-100">
        <View
          className="h-full rounded-full bg-blue-400"
          style={{ width: `${percent}%` }}
        />
      </View>
    </View>
  );
}

function TripCard({
  trip,
  onDelete,
  onUpdatePrecise,
}: {
  trip: TripWithRespondentCount;
  onDelete: (id: string) => void;
  onUpdatePrecise: (tripId: string, precise: number | null) => void;
}) {
  const router = useRouter();
  const [preciseModalVisible, setPreciseModalVisible] = useState(false);

  const { count, total, percent } = getParticipationRate(
    trip.respondentCount,
    trip.group_size_bucket,
    trip.group_size_precise,
  );

  // Label for the badge: prefer precise number, fall back to bucket range
  const sizeLabel = trip.group_size_precise != null
    ? `${trip.group_size_precise} people`
    : `${trip.group_size_bucket} people`;

  function confirmDelete() {
    Alert.alert('Delete this rally?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(trip.id) },
    ]);
  }

  function renderRightActions() {
    return (
      <Pressable
        onPress={confirmDelete}
        style={{
          backgroundColor: '#EF4444',
          borderRadius: 16,
          marginLeft: 8,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 22,
        }}
        accessibilityRole="button"
        accessibilityLabel="Delete trip"
      >
        <Ionicons name="trash-outline" size={22} color="white" />
        <Text style={{ color: 'white', fontSize: 11, fontWeight: '600', marginTop: 4 }}>Delete</Text>
      </Pressable>
    );
  }

  return (
    <>
      <Swipeable
        renderRightActions={renderRightActions}
        overshootRight={false}
        friction={2}
        containerStyle={{ marginBottom: 12 }}
      >
        {/* TouchableOpacity from RNGH integrates with the swipe gesture,
            preventing onPress from firing during horizontal swipes */}
        <TouchableOpacity
          onPress={() => router.push(`/(app)/trips/${trip.id}`)}
          onLongPress={() => router.push(`/(app)/trips/${trip.id}/edit`)}
          activeOpacity={0.85}
          style={[styles.card, { backgroundColor: 'rgba(255, 255, 255, 0.82)' }]}
          accessibilityRole="button"
        >
          <View className="flex-row items-start justify-between">
            <View className="flex-1 gap-1">
              <Text className="text-lg font-semibold text-neutral-800" numberOfLines={1}>
                {trip.name}
              </Text>
              {trip.travel_window ? (
                <View className="flex-row gap-1.5">
                  {trip.travel_window.split(', ').map((season) => (
                    <View key={season} className="flex-row items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 py-1">
                      <Ionicons name={SEASON_ICON[season] ?? 'sunny-outline'} size={12} color="#737373" />
                      <Text className="text-xs text-neutral-500">{season}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
            {/* Tapping the badge opens the precise-number modal */}
            <Pressable
              onPress={() => setPreciseModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={`Group size: ${sizeLabel}. Tap to set exact number.`}
              hitSlop={8}
            >
              <Badge variant="muted">{sizeLabel}</Badge>
            </Pressable>
          </View>

          <View className="mt-3 gap-2">
            <ProgressBar
              value={percent}
              max={100}
              label={`${count} of ${total} responded`}
              showPercent
            />
            <MemberBar memberCount={trip.memberCount} total={total} />
          </View>
        </TouchableOpacity>
      </Swipeable>

      <PreciseGroupSizeModal
        visible={preciseModalVisible}
        current={trip.group_size_precise ?? null}
        onSave={(n) => {
          onUpdatePrecise(trip.id, n);
          setPreciseModalVisible(false);
        }}
        onClose={() => setPreciseModalVisible(false)}
      />
    </>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signOut = useSignOut();
  const { data: trips, isLoading, refetch } = useTripsWithRespondentCounts();
  const deleteTrip = useDeleteTrip();
  const updateTrip = useUpdateTrip();

  function handleDelete(id: string) {
    deleteTrip.mutate(id);
  }

  function handleUpdatePrecise(tripId: string, precise: number | null) {
    updateTrip.mutate({ id: tripId, group_size_precise: precise });
  }

  return (
    <ImageBackground
      source={require('../../assets/yosemite.jpg')}
      style={{ flex: 1, paddingTop: insets.top }}
      resizeMode="cover"
    >
      {/* Header */}
      <View className="flex-row items-center justify-between px-6 pb-5 pt-4">
        <Text
          className="text-3xl font-bold text-white"
          style={{ textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 }}
        >
          rally
        </Text>
        {trips && trips.length > 0 ? (
          <Pressable
            onPress={() => router.push('/(app)/trips/new')}
            className="flex-row items-center gap-1 rounded-xl bg-coral-500 px-4 py-2"
            accessibilityRole="button"
            accessibilityLabel="Add rally"
          >
            <Ionicons name="add" size={16} color="white" />
            <Text className="text-sm font-semibold text-white">Add a rally</Text>
          </Pressable>
        ) : <View />}
      </View>

      {/* Trip list on frosted sheet */}
      <View className="flex-1 overflow-hidden rounded-t-3xl">
        <FlatList
          data={trips ?? []}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: insets.bottom + 100 }}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#FF6B5B" />
          }
          ListEmptyComponent={
            !isLoading ? (
              <View className="items-center py-20 gap-4">
                <Text className="text-xl font-semibold text-neutral-800">
                  No trips yet
                </Text>
                <Pressable
                  onPress={() => router.push('/(app)/trips/new')}
                  className="items-center justify-center rounded-full bg-coral-500 px-8 py-3"
                  style={{ elevation: 4, shadowColor: '#FF6B5B', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}
                  accessibilityRole="button"
                  accessibilityLabel="Get started"
                >
                  <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>Get started</Text>
                </Pressable>
                <Text className="text-base text-neutral-400">
                  Create your first rally to get started.
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <TripCard trip={item} onDelete={handleDelete} onUpdatePrecise={handleUpdatePrecise} />
          )}
        />
      </View>

      {/* Sign out */}
      <View
        className="absolute bottom-0 right-0 pr-6"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
        <Pressable
          onPress={() =>
            Alert.alert('Sign out?', '', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
            ])
          }
          className="h-12 w-12 items-center justify-center rounded-full bg-white/80"
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Ionicons name="log-out-outline" size={22} color="#6B6B6B" />
        </Pressable>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
});
