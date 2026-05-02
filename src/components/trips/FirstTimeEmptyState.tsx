/**
 * FirstTimeEmptyState — the trips home empty state for first-time planners.
 *
 * Replaces the generic <EmptyState> on the trips list. The generic version
 * works fine for "no polls yet" / "no expenses yet" but it's a wasted
 * moment on the first launch — that screen is the user's first impression
 * of the product after auth.
 *
 * Plane choreography (current iteration — simple ping-pong):
 *   1. Plane glides left → right across the TOP of the visible area
 *   2. Brief pause off-screen right
 *   3. Plane glides right → left across the BOTTOM of the visible area
 *      (rotated 180° so the nose leads)
 *   4. Brief pause off-screen left
 *   5. Loop forever
 *
 * The plane never crosses the headline / subhead / CTA — it travels only
 * along the very top and very bottom of the empty-state container. The
 * container is flex:1 (parent FlatList sets `flexGrow: 1`), so its height
 * matches the frosted-sheet height and the plane traverses the full
 * visible area top-to-bottom.
 *
 * Background-agnostic: parents render this over the home screen's photo.
 * Headline + subhead carry a soft cream text shadow as insurance against
 * brighter photo regions.
 */
import { useEffect, useState } from 'react';
import {
  Dimensions,
  type LayoutChangeEvent,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';

import { T, headlineFont, shadow } from '@/theme';

// Screen width is fixed at module load — current usage is portrait-only.
const SCREEN_W = Dimensions.get('window').width;

// Plane geometry.
const PLANE_SIZE = 24;
const PLANE_OFFSCREEN_PAD = 160;     // how far past the edge the plane parks
const PLANE_TOP_INSET = 8;           // distance from container top
const PLANE_BOTTOM_INSET = 24;       // distance from container bottom

// Cycle timing — tuned so the plane reads as a steady cruise, not a busy
// distraction. One sweep ≈ 5.8s; total cycle ≈ 13.8s.
// (30% faster than the original 18s pace.)
const TOTAL_CYCLE_MS = 13800;

// Phase splits within the cycle (0..1):
const TOP_SWEEP_END    = 0.42;  // 0.00 - 0.42 — top sweep L→R   (~7.5s)
const TOP_PAUSE_END    = 0.50;  // 0.42 - 0.50 — pause off-right  (~1.5s)
const BOTTOM_SWEEP_END = 0.92;  // 0.50 - 0.92 — bottom sweep R→L (~7.5s)
//                              // 0.92 - 1.00 — pause off-left   (~1.5s)

// Subtle cream halo behind body copy. Invisible on muted regions, lights
// up against bright sky/water in the photo so the text always reads.
const PHOTO_TEXT_SHADOW = {
  textShadowColor: 'rgba(255, 252, 246, 0.55)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
} as const;

export function FirstTimeEmptyState() {
  const router = useRouter();

  // Container height — captured via onLayout. Used to compute BOTTOM_Y for
  // the plane's lower track. Null until layout fires (the worklet hides
  // the plane until it has a real value, otherwise it would flash at 0).
  const [containerH, setContainerH] = useState<number | null>(null);

  // Staggered fade+rise. Cadence mirrors app/(auth)/onboarding.tsx so the
  // two screens feel like one continuous brand moment.
  const headlineO = useSharedValue(0);
  const headlineY = useSharedValue(36);
  const subO      = useSharedValue(0);
  const subY      = useSharedValue(28);
  const ctaO      = useSharedValue(0);
  const ctaY      = useSharedValue(28);

  // Subtle CTA breath — ~3.5% scale, 2.4s cycle.
  const ctaPulse = useSharedValue(1);

  // Plane driver: 0→1 over TOTAL_CYCLE_MS, infinite loop. The worklet
  // splits this single value into the four sweep/pause phases.
  const cycleProgress = useSharedValue(0);

  useEffect(() => {
    const cfg = { duration: 600, easing: Easing.out(Easing.cubic) };
    headlineO.value = withDelay(50,  withTiming(1, cfg));
    headlineY.value = withDelay(50,  withTiming(0, cfg));
    subO.value      = withDelay(220, withTiming(1, cfg));
    subY.value      = withDelay(220, withTiming(0, cfg));
    ctaO.value      = withDelay(420, withTiming(1, cfg));
    ctaY.value      = withDelay(420, withTiming(0, cfg));

    ctaPulse.value = withDelay(
      900,
      withRepeat(
        withSequence(
          withTiming(1.035, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
          withTiming(1.000, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );

    // Linear easing keeps cruise speed uniform across each sweep. We
    // wait until containerH is known before kicking off the plane —
    // otherwise the first cycle's bottom sweep would compute against a
    // null height and snap into place when layout finally fires.
    cycleProgress.value = withRepeat(
      withTiming(1, { duration: TOTAL_CYCLE_MS, easing: Easing.linear }),
      -1,
      false,
    );
  }, []);

  const headlineStyle = useAnimatedStyle(() => ({
    opacity: headlineO.value,
    transform: [{ translateY: headlineY.value }],
  }));
  const subStyle = useAnimatedStyle(() => ({
    opacity: subO.value,
    transform: [{ translateY: subY.value }],
  }));
  const ctaStyle = useAnimatedStyle(() => ({
    opacity: ctaO.value,
    transform: [{ translateY: ctaY.value }, { scale: ctaPulse.value }],
  }));

  // Plane position. Reads containerH via closure — passed as deps so the
  // worklet recompiles when the layout is captured.
  const planeStyle = useAnimatedStyle(() => {
    if (containerH == null) {
      // No layout yet — keep the plane invisible / off-screen so it
      // doesn't flash at (0, 0).
      return { opacity: 0, transform: [{ translateX: -PLANE_OFFSCREEN_PAD }] };
    }

    const t = cycleProgress.value;
    const TOP_Y    = PLANE_TOP_INSET;
    const BOTTOM_Y = containerH - PLANE_SIZE - PLANE_BOTTOM_INSET;
    const LEFT_OFF  = -PLANE_OFFSCREEN_PAD;
    const RIGHT_OFF = SCREEN_W + PLANE_OFFSCREEN_PAD;

    // ── Phase 1: top L→R ──────────────────────────────────────────────
    if (t < TOP_SWEEP_END) {
      const p = t / TOP_SWEEP_END;
      const x = LEFT_OFF + (RIGHT_OFF - LEFT_OFF) * p;
      return {
        opacity: 1,
        transform: [
          { translateX: x },
          { translateY: TOP_Y },
          { rotate: '0deg' },
        ],
      };
    }

    // ── Phase 2: pause off-screen right (still on top track) ──────────
    if (t < TOP_PAUSE_END) {
      return {
        opacity: 1,
        transform: [
          { translateX: RIGHT_OFF },
          { translateY: TOP_Y },
          { rotate: '0deg' },
        ],
      };
    }

    // ── Phase 3: bottom R→L (rotate 180° so nose leads) ───────────────
    if (t < BOTTOM_SWEEP_END) {
      const p = (t - TOP_PAUSE_END) / (BOTTOM_SWEEP_END - TOP_PAUSE_END);
      const x = RIGHT_OFF + (LEFT_OFF - RIGHT_OFF) * p;
      return {
        opacity: 1,
        transform: [
          { translateX: x },
          { translateY: BOTTOM_Y },
          { rotate: '180deg' },
        ],
      };
    }

    // ── Phase 4: pause off-screen left (still on bottom track) ────────
    return {
      opacity: 1,
      transform: [
        { translateX: LEFT_OFF },
        { translateY: BOTTOM_Y },
        { rotate: '180deg' },
      ],
    };
  }, [containerH]);

  function handleContainerLayout(e: LayoutChangeEvent) {
    setContainerH(e.nativeEvent.layout.height);
  }

  return (
    <View
      onLayout={handleContainerLayout}
      style={{
        flex: 1,
        paddingTop: 70,
        paddingHorizontal: 28,
        position: 'relative',
      }}
    >
      {/* Plane absolute layer. pointerEvents="none" so it never blocks
          taps on the CTA. */}
      <Animated.View
        pointerEvents="none"
        style={[
          planeStyle,
          {
            position: 'absolute',
            top: 0,
            left: 0,
            width: PLANE_SIZE,
            height: PLANE_SIZE,
            zIndex: 10,
          },
        ]}
      >
        <Ionicons
          name="airplane"
          size={20}
          color="white"
          style={{
            textShadowColor: 'rgba(0,0,0,0.25)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 4,
          }}
        />
      </Animated.View>

      {/* Content stacked at the top of the container. */}
      <View style={{ alignItems: 'center', gap: 14 }}>
        <Animated.View style={[headlineStyle, { alignItems: 'center' }]}>
          <Text
            style={{
              ...headlineFont.bold,
              fontSize: 40,
              lineHeight: 44,
              color: T.ink,
              textAlign: 'center',
              letterSpacing: -0.5,
              ...PHOTO_TEXT_SHADOW,
            }}
          >
            Where to{'\n'}next?
          </Text>
        </Animated.View>

        <Animated.View style={[subStyle, { alignItems: 'center', maxWidth: 320 }]}>
          <Text
            style={{
              fontSize: 15,
              lineHeight: 22,
              color: T.ink,
              textAlign: 'center',
              fontWeight: '500',
              ...PHOTO_TEXT_SHADOW,
            }}
          >
            Launch a trip, get input, book it.
          </Text>
        </Animated.View>

        <Animated.View style={[ctaStyle, { marginTop: 20 }]}>
          <Pressable
            onPress={() => router.push('/(app)/trips/new')}
            accessibilityRole="button"
            accessibilityLabel="Start your first trip"
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: T.green,
                paddingVertical: 15,
                paddingHorizontal: 28,
                borderRadius: 999,
                opacity: pressed ? 0.92 : 1,
                transform: pressed ? [{ scale: 0.98 }] : [{ scale: 1 }],
              },
              shadow.lg,
            ]}
          >
            <Text
              style={{
                color: 'white',
                fontSize: 16,
                fontWeight: '700',
                letterSpacing: 0.2,
              }}
            >
              Start your first trip
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}
