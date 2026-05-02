/**
 * Signup — new users.
 *
 * Creates the auth.users row + profiles row, then routes:
 *   - claim-phone — if the phone has unclaimed SMS / survey history
 *   - profile-setup — otherwise
 *
 * 2026-04-24 brand: cream surface, small "● RALLY" mark, Georgia headline,
 * staggered fade-in matching the welcome and login screens.
 */
import { Ionicons } from '@expo/vector-icons';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
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
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { BrandMark, Button, Input } from '@/components/ui';
import { useGoogleSignIn, useSignUp } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { T, headlineFont } from '@/theme';

/**
 * Celebration shown after successful signup, before routing to the
 * next step (claim-phone or profile-setup). Total visible time: ~1500ms.
 *   - Check icon: spring scale-in from 0
 *   - Headline: fade + lift
 *   - Background: soft cream wash so the form behind doesn't compete
 *
 * Kept inline (not extracted to a reusable component) — Phase 6.1 calls
 * out other celebrations (trip created, RSVP confirmed) which will get
 * their own screens, not a shared overlay.
 */
const CELEBRATION_DURATION_MS = 1500;

export default function SignupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signUp = useSignUp();
  const googleSignIn = useGoogleSignIn();

  // Pre-fill from route params — set when the login screen redirects
  // someone whose email/phone has no account. Saves them re-typing.
  const params = useLocalSearchParams<{ email?: string; phone?: string }>();
  const prefillEmail = typeof params.email === 'string' ? params.email : '';
  const prefillPhone = typeof params.phone === 'string' ? params.phone : '';

  const [googleLoading, setGoogleLoading] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(prefillEmail);
  const [phone, setPhone] = useState(prefillPhone);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // Set to the email used when Supabase returns user-without-session
  // (email-confirm pending). Drives the "check your inbox" overlay
  // that replaces the auto-celebrate-and-route flow — that flow used
  // to push the user into the app before they were actually signed in.
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState<string | null>(null);
  const [resendingConfirm, setResendingConfirm] = useState(false);
  const [errors, setErrors] = useState<{
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    password?: string;
  }>({});

  // ── Stagger fade-in (matches onboarding + login) ──────────────────────────
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

  // ── Celebration overlay ───────────────────────────────────────────────────
  const celebrationBgOpacity   = useSharedValue(0);
  const celebrationCheckScale  = useSharedValue(0);
  const celebrationTextOpacity = useSharedValue(0);
  const celebrationTextY       = useSharedValue(12);

  const celebrationBgStyle = useAnimatedStyle(() => ({ opacity: celebrationBgOpacity.value }));
  const celebrationCheckStyle = useAnimatedStyle(() => ({
    transform: [{ scale: celebrationCheckScale.value }],
  }));
  const celebrationTextStyle = useAnimatedStyle(() => ({
    opacity: celebrationTextOpacity.value,
    transform: [{ translateY: celebrationTextY.value }],
  }));

  /** Fire the celebration, then resolve when it's safe to navigate. */
  function playCelebration(): Promise<void> {
    setCelebrating(true);
    celebrationBgOpacity.value   = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
    celebrationCheckScale.value  = withDelay(80,  withSpring(1, { damping: 11, stiffness: 160 }));
    celebrationTextOpacity.value = withDelay(280, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    celebrationTextY.value       = withDelay(280, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));
    return new Promise((resolve) => setTimeout(resolve, CELEBRATION_DURATION_MS));
  }

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!firstName.trim()) errs.firstName = 'First name is required';
    if (!lastName.trim()) errs.lastName = 'Last name is required';
    if (!email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = 'Enter a valid email address';
    if (!phone.trim()) errs.phone = 'Phone number is required';
    if (!password || password.length < 8) errs.password = 'Password must be at least 8 characters';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    try {
      const result = await googleSignIn();
      // Route new accounts through the traveler-profile setup step. The
      // setup screen self-checks whether a profile already exists (claim
      // flow may have pre-filled it) and skips through to tabs when so.
      if (result) {
        await playCelebration();
        router.replace('/(app)/profile-setup');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed.';
      Alert.alert('Sign-in failed', message);
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleSignup() {
    if (!validate()) return;
    setLoading(true);
    const cleanEmailForSubmit = email.trim().toLowerCase();
    try {
      const result = await signUp(
        firstName.trim(),
        lastName.trim(),
        cleanEmailForSubmit,
        phone.trim(),
        password,
      );

      // Email-confirmation gate: when the project requires email
      // confirmation, Supabase returns user-without-session. Don't
      // celebrate or route into the app — show the "check your inbox"
      // state so the user knows what's expected next. The auth listener
      // in RootLayout will pick up the session as soon as they tap the
      // link in the confirmation email.
      if (result.user && !result.session) {
        setPendingConfirmEmail(cleanEmailForSubmit);
        return;
      }

      // Phase 3 — if we found unclaimed SMS/survey history for this phone,
      // fire off an OTP and route to the claim screen. The OTP send is
      // best-effort: if it fails we still let signup continue (the user
      // can re-trigger from the claim screen via Resend).
      if (result.claimAvailable && result.normalizedPhone) {
        try {
          await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/claim-otp`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
            },
            body: JSON.stringify({ phone: result.normalizedPhone }),
          });
        } catch {
          // Silent — claim screen has Resend
        }
        await playCelebration();
        router.replace({
          pathname: '/(auth)/claim-phone' as Parameters<typeof router.replace>[0] extends string
            ? string
            : never,
          params: { phone: result.normalizedPhone },
        } as unknown as Parameters<typeof router.replace>[0]);
        return;
      }

      await playCelebration();
      router.replace('/(app)/profile-setup');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Signup failed.';
      const lower = message.toLowerCase();
      const isDuplicate = lower.includes('already');
      // Mirror of the login → signup pre-fill: when the user tries to
      // sign up with an email that already has an account, push them to
      // login with the email pre-filled instead of dead-ending on an
      // alert.
      if (isDuplicate) {
        const cleanEmail = email.trim().toLowerCase();
        Alert.alert(
          'Account exists',
          `${cleanEmail} already has a Rally account. Log in instead.`,
          [{
            text: 'Log in',
            onPress: () => router.replace({
              pathname: '/(auth)/login' as Parameters<typeof router.replace>[0] extends string
                ? string
                : never,
              params: { email: cleanEmail },
            } as unknown as Parameters<typeof router.replace>[0]),
          }],
        );
        return;
      }
      // Supabase rate-limits per-email confirmation sends; the raw
      // "For security purposes, you can only request this after N
      // seconds" message is technically informative but cryptic.
      // Reword so the user knows it's not a permanent failure.
      const isRateLimited =
        lower.includes('rate limit')
        || lower.includes('over_email_send_rate_limit')
        || lower.includes('for security purposes');
      if (isRateLimited) {
        Alert.alert(
          'Too many attempts',
          'Wait a minute, then try again. (Supabase rate-limits confirmation emails per address.)',
        );
        return;
      }
      Alert.alert('Signup failed', message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResendConfirmation() {
    if (!pendingConfirmEmail) return;
    setResendingConfirm(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: pendingConfirmEmail,
      });
      if (error) {
        Alert.alert('Could not resend', error.message);
        return;
      }
      Alert.alert('Sent', `Another confirmation email is on its way to ${pendingConfirmEmail}.`);
    } catch (err) {
      Alert.alert(
        'Could not resend',
        err instanceof Error ? err.message : 'Try again in a moment.',
      );
    } finally {
      setResendingConfirm(false);
    }
  }

  // Email-confirmation pending — replace the form with a clear "check
  // your inbox" surface so the user knows what's expected. Once they
  // tap the link in the email, the auth listener picks up the session
  // and routes them into the app.
  if (pendingConfirmEmail) {
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
            justifyContent: 'center',
          }}
          keyboardShouldPersistTaps="handled"
        >
          <BrandMark size="md" />

          <View style={{ marginTop: 48, alignItems: 'center' }}>
            <View
              style={{
                width: 64, height: 64, borderRadius: 32,
                backgroundColor: T.greenSoft,
                alignItems: 'center', justifyContent: 'center',
                marginBottom: 24,
              }}
            >
              <Ionicons name="mail-outline" size={32} color={T.green} />
            </View>
            <Text
              style={{
                ...headlineFont.bold,
                fontSize: 36,
                color: T.ink,
                letterSpacing: -1,
                textAlign: 'center',
                marginBottom: 12,
              }}
            >
              Check your inbox.
            </Text>
            <Text
              style={{
                fontSize: 16, color: T.muted, lineHeight: 24,
                textAlign: 'center', marginBottom: 8,
              }}
            >
              We sent a confirmation link to
            </Text>
            <Text
              style={{
                fontSize: 16, color: T.ink, fontWeight: '600',
                textAlign: 'center', marginBottom: 24,
              }}
            >
              {pendingConfirmEmail}
            </Text>
            <Text
              style={{
                fontSize: 14, color: T.muted, lineHeight: 20,
                textAlign: 'center', marginBottom: 32,
              }}
            >
              Tap the link to finish setting up your Rally account. You'll be signed in automatically.
            </Text>

            <Button
              variant="secondary"
              onPress={handleResendConfirmation}
              loading={resendingConfirm}
              fullWidth
            >
              Resend email
            </Button>

            <Pressable
              onPress={() => setPendingConfirmEmail(null)}
              style={{ marginTop: 16 }}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={{ fontSize: 14, color: T.green, fontWeight: '600' }}>
                Use a different email
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
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
        {/* Brand mark — canonical "● RALLY" via shared BrandMark. */}
        <Animated.View style={logoStyle}>
          <BrandMark size="md" />
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
            Get started.
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={{ fontSize: 14, color: T.muted, lineHeight: 20 }}
          >
            One account, one link. Your group plans the rest.
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
            <Text style={{ fontSize: 12, color: T.muted }}>or sign up with email</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: T.line }} />
          </View>

          <View style={{ gap: 16 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Input
                  label="First name"
                  placeholder="Jane"
                  value={firstName}
                  onChangeText={setFirstName}
                  autoComplete="given-name"
                  autoCapitalize="words"
                  error={errors.firstName}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Input
                  label="Last name"
                  placeholder="Smith"
                  value={lastName}
                  onChangeText={setLastName}
                  autoComplete="family-name"
                  autoCapitalize="words"
                  error={errors.lastName}
                />
              </View>
            </View>
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
              label="Phone number"
              placeholder="+1 555 000 0000"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              error={errors.phone}
            />
            <Input
              label="Password"
              placeholder="Min. 8 characters"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              textContentType="oneTimeCode"
              error={errors.password}
            />

            <Button onPress={handleSignup} loading={loading} fullWidth>
              Create account
            </Button>
          </View>
        </Animated.View>

        {/* Footer */}
        <Animated.View style={[{ marginTop: 32, alignItems: 'center' }, footerStyle]}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Text style={{ color: T.muted }}>Already have an account?</Text>
            <Link href="/(auth)/login" asChild>
              <Text style={{ fontWeight: '600', color: T.green }}>Log in</Text>
            </Link>
          </View>
        </Animated.View>
      </ScrollView>

      {/* Celebration overlay — shown for ~1500ms after a successful signup,
          then the surrounding handler navigates to the next step. */}
      {celebrating ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: T.cream,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 32,
            },
            celebrationBgStyle,
          ]}
        >
          <Animated.View
            style={[
              {
                width: 96,
                height: 96,
                borderRadius: 48,
                backgroundColor: T.greenSoft,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 24,
              },
              celebrationCheckStyle,
            ]}
          >
            <Ionicons name="checkmark" size={52} color={T.green} />
          </Animated.View>
          <Animated.View style={celebrationTextStyle}>
            <Text
              style={{
                ...headlineFont.bold,
                fontSize: 36,
                color: T.ink,
                letterSpacing: -1,
                textAlign: 'center',
                marginBottom: 6,
              }}
            >
              You're in.
            </Text>
            <Text style={{ fontSize: 16, color: T.muted, textAlign: 'center' }}>
              Setting up your Rally…
            </Text>
          </Animated.View>
        </Animated.View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
