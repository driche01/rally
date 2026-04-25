import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, ImageBackground, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { TouchableOpacity } from 'react-native-gesture-handler';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PreciseGroupSizeModal } from '@/components/PreciseGroupSizeModal';
import { useDeleteTrip, useTripsWithRespondentCounts, useUpdateTrip } from '@/hooks/useTrips';
import { useAuthStore } from '@/stores/authStore';
import type { TripWithRespondentCount } from '@/lib/api/trips';
import { getTripStage, STAGES, STAGE_LABEL } from '@/lib/tripStage';

const SEASON_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  Winter: 'snow-outline',
  Spring: 'flower-outline',
  Summer: 'sunny-outline',
  Fall: 'leaf-outline',
};

// Stage accent colors — mirror the hero card palette on the dashboard.
// 2026-04-24 brand: green-family for active, soft tints for past, no blue.
const STAGE_COLOR: Record<string, { active: string; past: string; label: string }> = {
  deciding:     { active: '#0F3F2E', past: '#A4B6A1', label: '#0F3F2E' },
  confirmed:    { active: '#0F3F2E', past: '#A4B6A1', label: '#0F3F2E' },
  planning:     { active: '#0F3F2E', past: '#A4B6A1', label: '#0F3F2E' },
  experiencing: { active: '#0F3F2E', past: '#A4B6A1', label: '#0F3F2E' },
  reconciling:  { active: '#5F685F', past: '#C8C8C0', label: '#5F685F' },
  done:         { active: '#163026', past: '#A4B6A1', label: '#163026' },
};

function TripCard({
  trip,
  onDelete,
  onUpdatePrecise,
  currentUserId,
}: {
  trip: TripWithRespondentCount;
  onDelete: (id: string) => void;
  onUpdatePrecise: (tripId: string, precise: number | null) => void;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [preciseModalVisible, setPreciseModalVisible] = useState(false);
  const isPlanner = !!currentUserId && trip.created_by === currentUserId;

  const stage = getTripStage(trip);
  const stageIndex = STAGES.indexOf(stage);
  const stageColor = STAGE_COLOR[stage] ?? STAGE_COLOR.deciding;

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
        <View style={[styles.cardShell, { backgroundColor: 'rgba(255, 255, 255, 0.82)' }]}>
          {/* TouchableOpacity from RNGH integrates with the swipe gesture,
              preventing onPress from firing during horizontal swipes */}
          <TouchableOpacity
            onPress={() => router.push(`/(app)/trips/${trip.id}`)}
            activeOpacity={0.85}
            style={styles.cardLeft}
            accessibilityRole="button"
          >
            <Text style={styles.tripName} numberOfLines={1}>{trip.name}</Text>

            {trip.travel_window ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                {trip.travel_window.split(', ').map((season) => (
                  <View key={season} style={styles.seasonPill}>
                    <Ionicons name={SEASON_ICON[season] ?? 'sunny-outline'} size={12} color="#5F685F" />
                    <Text style={styles.seasonText}>{season}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Tapping the size pill opens the precise-number modal */}
            <Pressable
              onPress={() => setPreciseModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={`Group size: ${sizeLabel}. Tap to set exact number.`}
              style={styles.sizePill}
            >
              <Text style={styles.sizePillText}>{sizeLabel}</Text>
            </Pressable>

            {/* Stage progress bar */}
            <View style={styles.stageBar}>
              {STAGES.map((s, i) => (
                <View
                  key={s}
                  style={[
                    styles.stageSegment,
                    i < stageIndex  && { backgroundColor: stageColor.past },
                    i === stageIndex && { backgroundColor: stageColor.active },
                  ]}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
              <Text style={[styles.stageLabel, { color: stageColor.label }]}>{STAGE_LABEL[stage]}</Text>
              <View style={[styles.rolePill, isPlanner ? styles.rolePillPlanner : styles.rolePillMember]}>
                <Ionicons
                  name={isPlanner ? 'ribbon-outline' : 'person-outline'}
                  size={10}
                  color={isPlanner ? '#7C5A0A' : '#0F3F2E'}
                />
                <Text style={[styles.rolePillText, isPlanner ? styles.rolePillTextPlanner : styles.rolePillTextMember]}>
                  {isPlanner ? 'Planner' : 'Member'}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

        </View>
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
  const { data: trips, isLoading, refetch } = useTripsWithRespondentCounts();
  const deleteTrip = useDeleteTrip();
  const updateTrip = useUpdateTrip();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  function handleDelete(id: string) {
    deleteTrip.mutate(id);
  }

  function handleUpdatePrecise(tripId: string, precise: number | null) {
    updateTrip.mutate({ id: tripId, group_size_precise: precise });
  }

  return (
    <ImageBackground
      source={require('../../../assets/yosemite.jpg')}
      style={{ flex: 1, paddingTop: insets.top }}
      resizeMode="cover"
    >
      {/* Header */}
      <View className="flex-row items-center px-6 pb-5 pt-4">
        <Text
          className="text-3xl font-bold text-white"
          style={{ textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 }}
        >
          rally
        </Text>
      </View>

      {/* Trip list on frosted sheet */}
      <View className="flex-1 overflow-hidden rounded-t-3xl">
        <FlatList
          data={trips ?? []}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 }}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#0F3F2E" />
          }
          ListEmptyComponent={
            !isLoading ? (
              <View className="items-center py-20 gap-3">
                <Text className="text-xl font-semibold text-ink">No trips yet</Text>
                <Text className="text-base text-muted text-center">
                  Tap + below to start your first trip.
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <TripCard trip={item} onDelete={handleDelete} onUpdatePrecise={handleUpdatePrecise} currentUserId={currentUserId} />
          )}
        />
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  cardShell: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardLeft: {
    padding: 14,
    gap: 7,
  },
  tripName: {
    fontSize: 15,
    fontFamily: 'SpaceGrotesk_700Bold',
    color: '#163026',
    lineHeight: 18,
  },
  seasonPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: '#E7DDCF',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#FBF7EF',
  },
  seasonText: {
    fontSize: 10.5,
    color: '#5F685F',
  },
  sizePill: {
    borderWidth: 1,
    borderColor: '#E7DDCF',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#FBF7EF',
    alignSelf: 'flex-start',
  },
  sizePillText: {
    fontSize: 11,
    color: '#5F685F',
  },
  stageBar: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 2,
  },
  stageSegment: {
    flex: 1,
    height: 3,
    borderRadius: 99,
    backgroundColor: '#E7DDCF',
  },
  stageLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 99,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  rolePillPlanner: {
    // Gold tint — premium signal for planners.
    backgroundColor: '#FBE9B6',
  },
  rolePillMember: {
    // Soft green tint — replaces prior light-blue (brand "no blue" rule).
    backgroundColor: '#DFE8D2',
  },
  rolePillText: {
    fontSize: 10,
    fontWeight: '600',
  },
  rolePillTextPlanner: {
    color: '#7C5A0A',
  },
  rolePillTextMember: {
    color: '#0F3F2E',
  },
});
