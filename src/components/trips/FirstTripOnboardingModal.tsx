/**
 * FirstTripOnboardingModal — one-time post-creation explainer.
 *
 * Shows the planner what Rally is about to do over the next N days
 * after they create their first trip. Mounted on the trip detail
 * screen (so the celebration overlay finishes first), gates on a
 * single AsyncStorage key so it only ever shows once per device.
 *
 * Body bullets pull live from the trip — the date and participant-
 * count strings reflect what was actually configured. If book_by
 * isn't set on this trip, the modal doesn't show (cadence wouldn't
 * fire anyway).
 */
import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { computeCadence, formatCadenceDate } from '@/lib/cadence';
import type { Trip } from '@/types/database';

const STORAGE_KEY = 'rally_first_trip_onboarded';

async function getFlag(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  }
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  return (await AsyncStorage.getItem(STORAGE_KEY)) === 'true';
}

async function setFlag(): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(STORAGE_KEY, 'true');
    return;
  }
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem(STORAGE_KEY, 'true');
}

interface Props {
  trip: Trip | undefined;
  /** True when this is the user's first trip ever — caller decides. */
  isFirstTrip?: boolean;
}

export function FirstTripOnboardingModal({ trip, isFirstTrip = true }: Props) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!trip || !trip.book_by_date || !isFirstTrip) return;
    let cancelled = false;
    (async () => {
      const seen = await getFlag();
      if (!cancelled && !seen) {
        // Small delay so the celebrate overlay finishes first.
        setTimeout(() => { if (!cancelled) setVisible(true); }, 1100);
      }
    })();
    return () => { cancelled = true; };
  }, [trip?.id, trip?.book_by_date, isFirstTrip]);

  function handleDismiss() {
    setVisible(false);
    void setFlag();
  }

  if (!trip || !trip.book_by_date || !trip.responses_due_date) return null;

  const cadence = computeCadence({ responsesDueDate: trip.responses_due_date });
  const nudgeCount = cadence.filter((c) => c.kind !== 'initial').length;
  const responsesDueLabel = formatCadenceDate(trip.responses_due_date);
  const bookByLabel = formatCadenceDate(trip.book_by_date);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleDismiss}
    >
      <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.iconWrap}>
          <Ionicons name="sparkles" size={32} color="#0F3F2E" />
        </View>

        <Text style={styles.title}>Rally's running point on this trip</Text>
        <Text style={styles.subtitle}>
          Here's what'll happen automatically — you can change any of it from the dashboard.
        </Text>

        <View style={styles.bullets}>
          <Bullet
            icon="paper-plane-outline"
            title="Texts your group on day one"
            body="Every participant gets a 1:1 SMS with a no-login survey link as soon as they join."
          />
          <Bullet
            icon="time-outline"
            title={`${nudgeCount} reminder${nudgeCount === 1 ? '' : 's'} for non-responders`}
            body={`If anyone hasn't responded, Rally nudges them on a deterministic cadence ending ${responsesDueLabel}.`}
          />
          <Bullet
            icon="alert-circle-outline"
            title="Surfaces a recommendation when responses are in"
            body={`When the response window closes, Rally posts a pick to your decision queue. You approve, edit, or hold.`}
          />
          <Bullet
            icon="lock-closed-outline"
            title="Locks in by your book-by date"
            body={`You set ${bookByLabel} as the deadline. Rally splits the lock-in SMS so non-responders get a tailored message.`}
          />
        </View>

        <Pressable style={styles.cta} onPress={handleDismiss} accessibilityRole="button">
          <Text style={styles.ctaText}>Got it — let's start</Text>
        </Pressable>

        <Text style={styles.footer}>
          You're in control. Pause nudges, edit the schedule, or undo a lock from this trip's dashboard.
        </Text>
      </View>
    </Modal>
  );
}

function Bullet({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  return (
    <View style={styles.bullet}>
      <View style={styles.bulletIcon}>
        <Ionicons name={icon} size={18} color="#0F3F2E" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.bulletTitle}>{title}</Text>
        <Text style={styles.bulletBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFCF6',
    paddingHorizontal: 24,
    gap: 14,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#DFE8D2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#163026', lineHeight: 30 },
  subtitle: { fontSize: 15, color: '#5F685F', lineHeight: 21 },

  bullets: { gap: 14, marginTop: 8 },
  bullet: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  bulletIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#DFE8D2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletTitle: { fontSize: 15, fontWeight: '700', color: '#163026' },
  bulletBody: { fontSize: 13, color: '#5F685F', lineHeight: 18 },

  cta: {
    marginTop: 'auto',
    backgroundColor: '#0F3F2E',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaText: { fontSize: 16, fontWeight: '700', color: 'white' },

  footer: { fontSize: 12, color: '#888', textAlign: 'center', marginTop: 8 },
});
