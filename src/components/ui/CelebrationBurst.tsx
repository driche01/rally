/**
 * CelebrationBurst — confetti particle burst overlay.
 * Used on trip created, RSVP confirmed, and poll decided.
 *
 * Usage:
 *   const { celebrate, CelebrationOverlay } = useCelebration();
 *   ...
 *   celebrate();          // trigger
 *   return <View>...{CelebrationOverlay}</View>;
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  Easing,
} from 'react-native-reanimated';

// ── Particle config ────────────────────────────────────────────────────────────

const COLORS = ['#E05A28', '#1A9E5A', '#FFFFFF', '#F5A87F', '#F5C84A', '#4A90D9'];

// 20 deterministic particles spread around 360°
const PARTICLES: ParticleConfig[] = [
  { angle: 0,   dist: 130, size: 10, color: COLORS[0], rect: false, delay: 0   },
  { angle: 18,  dist: 100, size: 7,  color: COLORS[1], rect: true,  delay: 20  },
  { angle: 36,  dist: 160, size: 12, color: COLORS[2], rect: false, delay: 40  },
  { angle: 54,  dist: 90,  size: 8,  color: COLORS[3], rect: true,  delay: 10  },
  { angle: 72,  dist: 140, size: 6,  color: COLORS[4], rect: false, delay: 30  },
  { angle: 90,  dist: 110, size: 9,  color: COLORS[5], rect: true,  delay: 0   },
  { angle: 108, dist: 150, size: 11, color: COLORS[0], rect: false, delay: 50  },
  { angle: 126, dist: 95,  size: 7,  color: COLORS[1], rect: false, delay: 15  },
  { angle: 144, dist: 170, size: 8,  color: COLORS[2], rect: true,  delay: 35  },
  { angle: 162, dist: 115, size: 10, color: COLORS[3], rect: false, delay: 25  },
  { angle: 180, dist: 135, size: 6,  color: COLORS[4], rect: true,  delay: 45  },
  { angle: 198, dist: 105, size: 9,  color: COLORS[5], rect: false, delay: 5   },
  { angle: 216, dist: 155, size: 12, color: COLORS[0], rect: true,  delay: 55  },
  { angle: 234, dist: 88,  size: 7,  color: COLORS[1], rect: false, delay: 20  },
  { angle: 252, dist: 145, size: 8,  color: COLORS[2], rect: false, delay: 40  },
  { angle: 270, dist: 120, size: 10, color: COLORS[3], rect: true,  delay: 10  },
  { angle: 288, dist: 165, size: 6,  color: COLORS[4], rect: false, delay: 30  },
  { angle: 306, dist: 98,  size: 11, color: COLORS[5], rect: true,  delay: 0   },
  { angle: 324, dist: 140, size: 8,  color: COLORS[0], rect: false, delay: 45  },
  { angle: 342, dist: 112, size: 9,  color: COLORS[1], rect: true,  delay: 25  },
];

interface ParticleConfig {
  angle: number;   // degrees
  dist: number;    // max travel distance px
  size: number;    // diameter/height px
  color: string;
  rect: boolean;   // rectangle shape vs circle
  delay: number;   // ms
}

// ── Particle component ─────────────────────────────────────────────────────────

function Particle({ angle, dist, size, color, rect, delay }: ParticleConfig) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) })
    );
  }, []);

  const rad = (angle * Math.PI) / 180;

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    // x moves linearly, y has gravity (accelerates downward)
    const x = Math.cos(rad) * dist * p;
    const y = Math.sin(rad) * dist * p + 120 * p * p;
    const opacity = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
    return {
      opacity: Math.max(0, opacity),
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: `${p * 480}deg` },
      ],
    };
  });

  const width = rect ? Math.max(3, size * 0.35) : size;

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width,
          height: size,
          borderRadius: rect ? 2 : size / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

// ── CelebrationBurst overlay ───────────────────────────────────────────────────

interface CelebrationBurstProps {
  onDone?: () => void;
}

export function CelebrationBurst({ onDone }: CelebrationBurstProps) {
  useEffect(() => {
    const t = setTimeout(() => onDone?.(), 1800);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.center}>
        {PARTICLES.map((p, i) => (
          <Particle key={i} {...p} />
        ))}
      </View>
    </View>
  );
}

// ── useCelebration hook ────────────────────────────────────────────────────────

export function useCelebration() {
  const [visible, setVisible] = useState(false);

  function celebrate() {
    setVisible(true);
  }

  const CelebrationOverlay = visible ? (
    <CelebrationBurst onDone={() => setVisible(false)} />
  ) : null;

  return { celebrate, CelebrationOverlay };
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
