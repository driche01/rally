/**
 * Forgot password — sends a reset link to the user's email via Supabase.
 *
 * 2026-04-24 brand: cream surface, small "● RALLY" mark, Georgia headline,
 * staggered fade-in matching the rest of the auth flow.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { Button, Input } from '@/components/ui';
import { useResetPassword } from '@/hooks/useAuth';
import { T, headlineFont } from '@/theme';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const resetPassword = useResetPassword();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const logoOpacity     = useSharedValue(0);
  const logoTranslate   = useSharedValue(20);
  const heroOpacity     = useSharedValue(0);
  const heroTranslate   = useSharedValue(28);
  const formOpacity     = useSharedValue(0);
  const formTranslate   = useSharedValue(28);

  useEffect(() => {
    const cfg = { duration: 600, easing: Easing.out(Easing.cubic) };
    logoOpacity.value     = withDelay(0,   withTiming(1, cfg));
    logoTranslate.value   = withDelay(0,   withTiming(0, cfg));
    heroOpacity.value     = withDelay(120, withTiming(1, cfg));
    heroTranslate.value   = withDelay(120, withTiming(0, cfg));
    formOpacity.value     = withDelay(260, withTiming(1, cfg));
    formTranslate.value   = withDelay(260, withTiming(0, cfg));
  }, []);

  const logoStyle = useAnimatedStyle(() => ({ opacity: logoOpacity.value, transform: [{ translateY: logoTranslate.value }] }));
  const heroStyle = useAnimatedStyle(() => ({ opacity: heroOpacity.value, transform: [{ translateY: heroTranslate.value }] }));
  const formStyle = useAnimatedStyle(() => ({ opacity: formOpacity.value, transform: [{ translateY: formTranslate.value }] }));

  async function handleReset() {
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await resetPassword(email.trim().toLowerCase());
      setSent(true);
    } catch {
      setError('Could not send reset link. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.cream }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 32,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand mark + back */}
        <Animated.View style={logoStyle}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: T.green }} />
              <Text style={{ ...headlineFont.bold, fontSize: 20, color: T.green, letterSpacing: 1 }}>
                RALLY
              </Text>
            </View>
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Ionicons name="chevron-back" size={18} color={T.green} />
              <Text style={{ fontSize: 15, color: T.green, fontWeight: '500' }}>Back</Text>
            </Pressable>
          </View>
        </Animated.View>

        {sent ? (
          <Animated.View style={[{ marginTop: 64 }, heroStyle]}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: T.greenSoft,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 24,
              }}
            >
              <Ionicons name="mail-outline" size={28} color={T.green} />
            </View>
            <Text
              style={{
                ...headlineFont.bold,
                fontSize: 44,
                color: T.ink,
                lineHeight: 48,
                letterSpacing: -1.2,
                marginBottom: 12,
              }}
            >
              Check your email.
            </Text>
            <Text style={{ fontSize: 16, color: T.muted, lineHeight: 24, marginBottom: 32 }}>
              We sent a reset link to{' '}
              <Text style={{ color: T.ink, fontWeight: '600' }}>{email}</Text>. Tap it from any device to choose a new password.
            </Text>
            <Button
              variant="secondary"
              onPress={() => router.replace('/(auth)/login')}
              fullWidth
            >
              Back to login
            </Button>
          </Animated.View>
        ) : (
          <>
            {/* Headline */}
            <Animated.View style={[{ marginTop: 64, marginBottom: 32 }, heroStyle]}>
              <Text
                style={{
                  ...headlineFont.bold,
                  fontSize: 44,
                  color: T.ink,
                  lineHeight: 48,
                  letterSpacing: -1.2,
                  marginBottom: 8,
                }}
              >
                Reset password.
              </Text>
              <Text style={{ fontSize: 16, color: T.muted, lineHeight: 24 }}>
                Enter your email and we'll send you a reset link.
              </Text>
            </Animated.View>

            {/* Form */}
            <Animated.View style={[{ gap: 16 }, formStyle]}>
              <Input
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                error={error}
              />
              <Button onPress={handleReset} loading={loading} fullWidth>
                Send reset link
              </Button>
            </Animated.View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
