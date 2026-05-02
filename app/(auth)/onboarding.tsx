import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { T, headlineFont } from '@/theme';
import { BrandMark } from '@/components/ui';

// ── Onboarding screen ─────────────────────────────────────────────────────────
// Editorial cream surface. Shown to unauthenticated users before login.
// 2026-04-24 brand palette: cream bg, green primary, ink text, Georgia headlines.

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const logoOpacity    = useSharedValue(0);
  const logoTranslate  = useSharedValue(20);
  const heroOpacity    = useSharedValue(0);
  const heroTranslate  = useSharedValue(40);
  const subOpacity     = useSharedValue(0);
  const subTranslate   = useSharedValue(28);
  const actionsOpacity   = useSharedValue(0);
  const actionsTranslate = useSharedValue(28);

  useEffect(() => {
    const cfg = { duration: 600, easing: Easing.out(Easing.cubic) };
    logoOpacity.value    = withDelay(0,   withTiming(1, cfg));
    logoTranslate.value  = withDelay(0,   withTiming(0, cfg));
    heroOpacity.value    = withDelay(150, withTiming(1, cfg));
    heroTranslate.value  = withDelay(150, withTiming(0, cfg));
    subOpacity.value     = withDelay(300, withTiming(1, cfg));
    subTranslate.value   = withDelay(300, withTiming(0, cfg));
    actionsOpacity.value   = withDelay(500, withTiming(1, cfg));
    actionsTranslate.value = withDelay(500, withTiming(0, cfg));
  }, []);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ translateY: logoTranslate.value }],
  }));

  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ translateY: heroTranslate.value }],
  }));

  const subStyle = useAnimatedStyle(() => ({
    opacity: subOpacity.value,
    transform: [{ translateY: subTranslate.value }],
  }));

  const actionsStyle = useAnimatedStyle(() => ({
    opacity: actionsOpacity.value,
    transform: [{ translateY: actionsTranslate.value }],
  }));

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: T.cream,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: 32,
      }}
    >
      {/* Logo mark — canonical "● RALLY" via shared BrandMark component. */}
      <Animated.View style={logoStyle}>
        <BrandMark size="md" />
      </Animated.View>

      {/* Hero headline — let the text wrap naturally so we don't pin to a specific device width. */}
      <Animated.View style={[{ flex: 1, justifyContent: 'center' }, heroStyle]}>
        <Text
          style={{
            ...headlineFont.bold,
            fontSize: 60,
            color: T.ink,
            lineHeight: 64,
            letterSpacing: -1.5,
          }}
        >
          Get your group together.
        </Text>
      </Animated.View>

      {/* Subtext */}
      <Animated.View style={[{ marginBottom: 40 }, subStyle]}>
        <Text style={{ fontSize: 18, color: T.muted, lineHeight: 28 }}>
          Plan great trips with your group — destination, dates, and budget locked in with one link.
        </Text>
      </Animated.View>

      {/* Action buttons — primary routes new users to signup; returning users tap the secondary "Log in". */}
      <Animated.View style={[{ gap: 12 }, actionsStyle]}>
        <Pressable
          onPress={() => router.push('/(auth)/signup')}
          style={({ pressed }) => ({
            backgroundColor: pressed ? T.greenDark : T.green,
            borderRadius: 18,
            paddingVertical: 18,
            alignItems: 'center',
            opacity: pressed ? 0.95 : 1,
          })}
          accessibilityRole="button"
        >
          <Text style={{ fontSize: 17, fontWeight: '700', color: T.ink }}>
            Get started
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/(auth)/login')}
          style={({ pressed }) => ({
            borderRadius: 18,
            paddingVertical: 18,
            alignItems: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
          accessibilityRole="button"
        >
          <Text style={{ fontSize: 15, color: T.muted }}>
            Already have an account?{' '}
            <Text style={{ color: T.green, fontWeight: '600' }}>Log in</Text>
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
