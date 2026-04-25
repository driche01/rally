/**
 * Notification Permission Primer
 *
 * Shown before the iOS system notification permission dialog.
 * Explains the value of notifications so users are more likely to allow them.
 * Navigate here instead of calling requestNotificationPermission() directly.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestNotificationPermission } from '@/lib/notifications';
import { log } from '@/lib/logger';
import { capture, Events } from '@/lib/analytics';

const BENEFITS = [
  {
    icon: 'people-outline' as const,
    title: 'Crew activity',
    description: 'Know when someone joins or votes on a poll',
  },
  {
    icon: 'checkmark-circle-outline' as const,
    title: 'Trip confirmed',
    description: 'Get the heads up when your planner locks it in',
  },
  {
    icon: 'calendar-outline' as const,
    title: 'Reminders',
    description: 'Nudges to vote before polls close',
  },
];

export default function NotificationPrimerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  async function handleAllow() {
    const granted = await requestNotificationPermission();
    log.action(Events.NOTIFICATION_OPTED_IN, { granted });
    capture(Events.NOTIFICATION_OPTED_IN, { granted });
    router.back();
  }

  function handleSkip() {
    log.action('notification_primer_skipped');
    router.back();
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#0F0E0D',
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 28,
      }}
    >
      {/* Icon */}
      <View style={{ alignItems: 'center', marginTop: 32, marginBottom: 28 }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 22,
            backgroundColor: '#0F3F2E',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="notifications" size={36} color="white" />
        </View>
      </View>

      {/* Headline */}
      <Text
        style={{
          fontSize: 28,
          fontFamily: 'SpaceGrotesk_700Bold',
          color: '#FFFFFF',
          textAlign: 'center',
          lineHeight: 34,
          marginBottom: 10,
        }}
      >
        Stay in the loop
      </Text>
      <Text
        style={{
          fontSize: 15,
          color: '#A3A3A3',
          textAlign: 'center',
          lineHeight: 22,
          marginBottom: 36,
        }}
      >
        Get notified when your crew makes moves — so nothing falls through the cracks.
      </Text>

      {/* Benefits */}
      <View style={{ gap: 20, marginBottom: 40 }}>
        {BENEFITS.map((b) => (
          <View key={b.title} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: 'rgba(216, 90, 48, 0.15)',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 1,
              }}
            >
              <Ionicons name={b.icon} size={20} color="#0F3F2E" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#FFFFFF', marginBottom: 2 }}>
                {b.title}
              </Text>
              <Text style={{ fontSize: 13, color: '#737373', lineHeight: 18 }}>
                {b.description}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* CTAs */}
      <View style={{ gap: 12, marginTop: 'auto' }}>
        <Pressable
          onPress={handleAllow}
          style={{
            backgroundColor: '#0F3F2E',
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>
            Turn on notifications
          </Text>
        </Pressable>
        <Pressable
          onPress={handleSkip}
          style={{ paddingVertical: 12, alignItems: 'center' }}
        >
          <Text style={{ fontSize: 14, color: '#525252' }}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}
