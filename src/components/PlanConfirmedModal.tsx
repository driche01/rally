/**
 * PlanConfirmedModal — the Phase 1→2 handoff moment.
 *
 * Shown automatically when a planner marks a destination poll as decided.
 * Also accessible via the "Build the trip →" button on the trip detail.
 *
 * Flow:
 *   1. Celebratory confirmation ("Tahoe it is!")
 *   2. "Now let's build the trip" CTA
 *   3. → Paywall (if not unlocked) or Trip Hub (if already unlocked)
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  tripId: string;
  tripName: string;
  decidedDestination: string | null;
  phase2Unlocked: boolean;
  onClose: () => void;
}

export function PlanConfirmedModal({
  visible,
  tripId,
  tripName,
  decidedDestination,
  phase2Unlocked,
  onClose,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Fade + scale in animation
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, tension: 120, friction: 10, useNativeDriver: true }),
      ]).start();
    } else {
      opacity.setValue(0);
      scale.setValue(0.92);
    }
  }, [visible, opacity, scale]);

  function handleBuildTrip() {
    onClose();
    router.push(`/(app)/trips/${tripId}/hub`);
  }

  const destination = decidedDestination || tripName;
  const headline = decidedDestination
    ? `${decidedDestination} it is! 🎉`
    : 'The plan is locked in! 🎉';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Animated.View
          style={{
            transform: [{ scale }],
            opacity,
            backgroundColor: 'white',
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingBottom: insets.bottom + 16,
          }}
        >
          <Pressable onPress={() => {}} style={{ padding: 28, gap: 24 }}>

            {/* Drag handle */}
            <View style={{ alignItems: 'center', marginTop: -8, marginBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#E5E5E5' }} />
            </View>

            {/* Celebration icon */}
            <View style={{ alignItems: 'center' }}>
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  backgroundColor: '#FFF4F2',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 8,
                }}
              >
                <Text style={{ fontSize: 36 }}>🎉</Text>
              </View>

              <Text
                style={{
                  fontSize: 24,
                  fontWeight: '700',
                  color: '#1C1C1C',
                  textAlign: 'center',
                  marginBottom: 8,
                }}
              >
                {headline}
              </Text>

              <Text
                style={{
                  fontSize: 15,
                  color: '#737373',
                  textAlign: 'center',
                  lineHeight: 22,
                  maxWidth: 280,
                }}
              >
                Your group decided on{' '}
                <Text style={{ color: '#FF6B5B', fontWeight: '600' }}>{destination}</Text>
                {'. '}
                Time to turn that decision into a real trip.
              </Text>
            </View>

            {/* Divider */}
            <View style={{ height: 1, backgroundColor: '#F0F0F0' }} />

            {/* What you'll build preview */}
            <View style={{ gap: 12 }}>
              {[
                { icon: 'calendar-outline' as const, text: 'Day-by-day itinerary your group can see' },
                { icon: 'home-outline' as const,     text: 'Compare and vote on where to stay' },
                { icon: 'receipt-outline' as const,  text: 'Split expenses — no Splitwise needed' },
                { icon: 'chatbubble-outline' as const, text: 'Group updates tied to the plan' },
              ].map(({ icon, text }) => (
                <View key={text} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      backgroundColor: '#FFF4F2',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name={icon} size={16} color="#FF6B5B" />
                  </View>
                  <Text style={{ flex: 1, fontSize: 14, color: '#525252' }}>{text}</Text>
                </View>
              ))}
            </View>

            {/* CTA */}
            <Pressable
              onPress={handleBuildTrip}
              style={{
                backgroundColor: '#FF6B5B',
                borderRadius: 16,
                paddingVertical: 16,
                alignItems: 'center',
                marginTop: 4,
              }}
              accessibilityRole="button"
            >
              <Text style={{ fontSize: 16, fontWeight: '700', color: 'white' }}>
                Now let's build the trip →
              </Text>
            </Pressable>

          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
