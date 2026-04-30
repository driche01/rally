/**
 * Login — returning users.
 *
 * Two paths:
 *   1. Email + password (Supabase auth.signInWithPassword)
 *   2. Phone + 6-digit OTP — phone is entered here, code is sent by the
 *      `request-phone-login-otp` edge function, then we route to
 *      `/(auth)/login-otp` to verify the code and mint a session.
 *   3. Google sign-in (passthrough to useGoogleSignIn).
 *
 * 2026-04-24 brand: cream surface, small "● RALLY" mark, Georgia headline,
 * staggered fade-in matching the welcome screen.
 */
import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
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
import { useGoogleSignIn, useSignIn } from '@/hooks/useAuth';
import { log } from '@/lib/logger';
import { normalizePhone } from '@/lib/phone';
import { T, headlineFont } from '@/theme';

type Mode = 'email' | 'phone';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signIn = useSignIn();
  const googleSignIn = useGoogleSignIn();

  const [mode, setMode] = useState<Mode>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; phone?: string }>({});

  // ── Stagger fade-in (matches onboarding) ──────────────────────────────────
  const logoOpacity     = useSharedValue(0);
  const logoTranslate   = useSharedValue(20);
  const heroOpacity     = useSharedValue(0);
  const heroTranslate   = useSharedValue(28);
  const formOpacity     = useSharedValue(0);
  const formTranslate   = useSharedValue(28);
  const footerOpacity   = useSharedValue(0);
  const footerTranslate = useSharedValue(20);

  useEffect(() => {
    const cfg = { duration: 600, easing: Easing.out(Easing.cubic) };
    logoOpacity.value     = withDelay(0,   withTiming(1, cfg));
    logoTranslate.value   = withDelay(0,   withTiming(0, cfg));
    heroOpacity.value     = withDelay(120, withTiming(1, cfg));
    heroTranslate.value   = withDelay(120, withTiming(0, cfg));
    formOpacity.value     = withDelay(260, withTiming(1, cfg));
    formTranslate.value   = withDelay(260, withTiming(0, cfg));
    footerOpacity.value   = withDelay(420, withTiming(1, cfg));
    footerTranslate.value = withDelay(420, withTiming(0, cfg));
  }, []);

  const logoStyle   = useAnimatedStyle(() => ({ opacity: logoOpacity.value,   transform: [{ translateY: logoTranslate.value   }] }));
  const heroStyle   = useAnimatedStyle(() => ({ opacity: heroOpacity.value,   transform: [{ translateY: heroTranslate.value   }] }));
  const formStyle   = useAnimatedStyle(() => ({ opacity: formOpacity.value,   transform: [{ translateY: formTranslate.value   }] }));
  const footerStyle = useAnimatedStyle(() => ({ opacity: footerOpacity.value, transform: [{ translateY: footerTranslate.value }] }));

  // ── Handlers ──────────────────────────────────────────────────────────────
  function validateEmail(): boolean {
    const errs: typeof errors = {};
    if (!email.trim()) errs.email = 'Email is required';
    if (!password) errs.password = 'Password is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validatePhone(): boolean {
    const errs: typeof errors = {};
    const normalized = normalizePhone(phone);
    if (!normalized) errs.phone = 'Enter a valid phone number';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleEmailLogin() {
    if (!validateEmail()) return;
    setLoading(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      log.action('signed_in', { method: 'email' });
      router.replace('/(app)/(tabs)');
    } catch (err) {
      log.error('sign_in_failed', err, { method: 'email' });
      Alert.alert('Login failed', 'Incorrect email or password.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePhoneSendCode() {
    if (!validatePhone()) return;
    const normalized = normalizePhone(phone);
    if (!normalized) return;

    setLoading(true);
    try {
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/request-phone-login-otp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
          },
          body: JSON.stringify({ phone: normalized }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        if (data.error === 'rate_limited') {
          Alert.alert('Too many requests', 'Try again in a few minutes.');
        } else {
          // Don't leak whether the phone is on file. Always pretend it sent.
          // The OTP screen will surface a generic error if verification fails.
        }
      }
      log.action('phone_login_code_requested');
      router.push({
        pathname: '/(auth)/login-otp' as Parameters<typeof router.push>[0] extends string ? string : never,
        params: { phone: normalized },
      } as unknown as Parameters<typeof router.push>[0]);
    } catch (err) {
      log.error('phone_login_request_failed', err);
      Alert.alert('Could not send code', 'Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    try {
      const result = await googleSignIn();
      if (result) {
        log.action('signed_in', { method: 'google' });
        router.replace('/(app)/(tabs)');
      }
    } catch (err: unknown) {
      log.error('sign_in_failed', err, { method: 'google' });
      const message = err instanceof Error ? err.message : 'Google sign-in failed.';
      Alert.alert('Sign-in failed', message);
    } finally {
      setGoogleLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
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
        {/* Brand mark */}
        <Animated.View style={logoStyle}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: T.green }} />
            <Text style={{ ...headlineFont.bold, fontSize: 20, color: T.green, letterSpacing: 1 }}>
              RALLY
            </Text>
          </View>
        </Animated.View>

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
            Welcome back.
          </Text>
          <Text style={{ fontSize: 16, color: T.muted, lineHeight: 24 }}>
            Log in to pick up where your group left off.
          </Text>
        </Animated.View>

        {/* Form */}
        <Animated.View style={formStyle}>
          {/* Google sign-in.
              Layout lives on the inner View (static style) so NativeWind's
              JSX runtime doesn't drop it on native — see investigation
              2026-04-30. Pressable only toggles backgroundColor on press. */}
          <Pressable
            onPress={handleGoogleSignIn}
            disabled={googleLoading}
            accessibilityRole="button"
            style={{ alignSelf: 'stretch', marginBottom: 16 }}
          >
            {({ pressed }) => (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: T.line,
                  backgroundColor: pressed ? T.creamWarm : T.card,
                  paddingVertical: 14,
                }}
              >
                {googleLoading ? (
                  <Text style={{ fontSize: 14, fontWeight: '500', color: T.muted }}>
                    Signing in…
                  </Text>
                ) : (
                  <>
                    <Ionicons name="logo-google" size={18} color="#4285F4" />
                    <Text style={{ fontSize: 14, fontWeight: '500', color: T.ink }}>
                      Continue with Google
                    </Text>
                  </>
                )}
              </View>
            )}
          </Pressable>

          {/* Divider */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: T.line }} />
            <Text style={{ fontSize: 12, color: T.muted }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: T.line }} />
          </View>

          {/* Mode tabs — segmented control between email and phone login. */}
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: T.creamWarm,
              borderRadius: 12,
              padding: 4,
              marginBottom: 16,
            }}
          >
            {(['email', 'phone'] as const).map((m) => {
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => {
                    setMode(m);
                    setErrors({});
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 9,
                    backgroundColor: active ? T.card : 'transparent',
                    alignItems: 'center',
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: active ? '600' : '500',
                      color: active ? T.ink : T.muted,
                    }}
                  >
                    {m === 'email' ? 'Email' : 'Phone'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {mode === 'email' ? (
            <View style={{ gap: 16 }}>
              <Input
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                error={errors.email}
              />
              <Input
                label="Password"
                placeholder="Your password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="password"
                error={errors.password}
              />
              <Link href="/(auth)/forgot-password" asChild>
                <Text style={{ alignSelf: 'flex-end', fontSize: 14, color: T.green, fontWeight: '500' }}>
                  Forgot password?
                </Text>
              </Link>
              <Button onPress={handleEmailLogin} loading={loading} fullWidth>
                Log in
              </Button>
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              <Input
                label="Phone number"
                placeholder="+1 555 000 0000"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="tel"
                error={errors.phone}
                hint={errors.phone ? undefined : "We'll text you a 6-digit code."}
              />
              <Button onPress={handlePhoneSendCode} loading={loading} fullWidth>
                Send code
              </Button>
            </View>
          )}
        </Animated.View>

        {/* Footer */}
        <Animated.View style={[{ marginTop: 32, alignItems: 'center' }, footerStyle]}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Text style={{ color: T.muted }}>New to Rally?</Text>
            <Link href="/(auth)/signup" asChild>
              <Text style={{ fontWeight: '600', color: T.green }}>Sign up</Text>
            </Link>
          </View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
