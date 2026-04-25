import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';

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

  const HEADLINE_FONT = Platform.OS === 'android' ? 'serif' : 'Georgia';

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#FBF7EF',
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: 32,
      }}
    >
      {/* Logo mark */}
      <Animated.View style={logoStyle}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#0F3F2E' }}
          />
          <Text
            style={{
              fontFamily: HEADLINE_FONT,
              fontSize: 20,
              fontWeight: '700',
              color: '#0F3F2E',
              letterSpacing: 1,
            }}
          >
            RALLY
          </Text>
        </View>
      </Animated.View>

      {/* Hero headline */}
      <Animated.View style={[{ flex: 1, justifyContent: 'center' }, heroStyle]}>
        <Text
          style={{
            fontFamily: HEADLINE_FONT,
            fontSize: 60,
            fontWeight: '700',
            color: '#163026',
            lineHeight: 64,
            letterSpacing: -1.5,
          }}
        >
          Get your{'\n'}group{'\n'}together.
        </Text>
      </Animated.View>

      {/* Subtext */}
      <Animated.View style={[{ marginBottom: 40 }, subStyle]}>
        <Text
          style={{
            fontSize: 18,
            color: '#5F685F',
            lineHeight: 28,
          }}
        >
          Plan great trips with your group —{'\n'}
          destination, dates, and budget{'\n'}
          locked in with one link.
        </Text>
      </Animated.View>

      {/* Action buttons */}
      <Animated.View style={[{ gap: 12 }, actionsStyle]}>
        <Pressable
          onPress={() => router.push('/(auth)/login')}
          style={({ pressed }) => ({
            backgroundColor: pressed ? '#174F3C' : '#0F3F2E',
            borderRadius: 18,
            paddingVertical: 18,
            alignItems: 'center',
            opacity: pressed ? 0.95 : 1,
          })}
          accessibilityRole="button"
        >
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>
            Let's go
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/(auth)/signup')}
          style={({ pressed }) => ({
            borderRadius: 18,
            paddingVertical: 18,
            alignItems: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
          accessibilityRole="button"
        >
          <Text style={{ fontSize: 15, color: '#5F685F' }}>
            New here?{' '}
            <Text style={{ color: '#0F3F2E', fontWeight: '600' }}>Sign up</Text>
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
