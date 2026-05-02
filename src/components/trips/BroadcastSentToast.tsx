/**
 * Transient confirmation pill for the planner's text-blast send.
 *
 * Mounted on the trip dashboard — when the broadcast modal closes after
 * a successful send, the parent flips `state` to a `{ sent, failed }`
 * value, which animates a green/amber pill in for ~1.8s and fades out.
 * Failed-row count is surfaced so partial fan-outs don't read as full
 * success.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface BroadcastSentState {
  sent: number;
  failed: number;
}

interface Props {
  state: BroadcastSentState | null;
  onDismiss: () => void;
}

const HOLD_MS = 1800;
const FADE_MS = 220;

export function BroadcastSentToast({ state, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;

  useEffect(() => {
    if (!state) return;
    const seq = Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: FADE_MS, useNativeDriver: true }),
      ]),
      Animated.delay(HOLD_MS),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -8, duration: FADE_MS, useNativeDriver: true }),
      ]),
    ]);
    seq.start(({ finished }) => {
      if (finished) onDismiss();
    });
    return () => seq.stop();
  }, [state, opacity, translateY, onDismiss]);

  if (!state) return null;

  const hasFailures = state.failed > 0;
  const peopleWord = state.sent === 1 ? 'person' : 'people';
  const label = hasFailures
    ? `Sent to ${state.sent} · ${state.failed} failed`
    : `Sent to ${state.sent} ${peopleWord}`;

  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 12 }]}>
      <Animated.View
        style={[
          styles.pill,
          hasFailures ? styles.pillWarn : styles.pillOk,
          { opacity, transform: [{ translateY }] },
        ]}
      >
        <Ionicons
          name={hasFailures ? 'alert-circle' : 'checkmark-circle'}
          size={16}
          color="white"
        />
        <Text style={styles.label}>{label}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  pillOk: { backgroundColor: '#1D9E75' },
  pillWarn: { backgroundColor: '#C97A2D' },
  label: { color: 'white', fontSize: 14, fontWeight: '600' },
});
