/**
 * Login OTP — phone-based login verification screen.
 *
 * Reached from the login screen's "Phone" tab after the user enters
 * their phone and taps "Send code". The phone is passed as a route
 * param. We:
 *   1. Auto-focus the 6-digit input.
 *   2. On 6 digits, POST {phone, code} to `verify-phone-login-otp`.
 *   3. The edge function returns { token_hash, email } on success;
 *      we mint a session via `supabase.auth.verifyOtp({ token_hash,
 *      type: 'magiclink' })` and route to the home tabs.
 *
 * Visually parallels claim-phone.tsx — same layout, same styling — but
 * the data flow is different (claim-phone calls a SECURITY DEFINER RPC
 * while authenticated; this calls our edge function pre-auth).
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { normalizePhone } from '@/lib/phone';
import { log } from '@/lib/logger';
import { capture, Events } from '@/lib/analytics';
import { T, headlineFont } from '@/theme';

const RESEND_COOLDOWN_S = 30;
const PLACEHOLDER = '#9DA8A0';

export default function LoginOtpScreen() {
  const router = useRouter();
  const { phone: phoneParam } = useLocalSearchParams<{ phone?: string }>();
  const phone = (phoneParam ?? '').toString();
  const normalized = normalizePhone(phone);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(RESEND_COOLDOWN_S);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 250);
  }, []);

  async function handleVerify() {
    if (!normalized) {
      setError("We couldn't read that phone number. Go back and try again.");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code we sent you.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/verify-phone-login-otp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
          },
          body: JSON.stringify({ phone: normalized, code }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        token_hash?: string;
      };

      if (!data.ok || !data.token_hash) {
        setError(reasonToCopy(data.reason));
        return;
      }

      // Mint the session.
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash,
        type: 'magiclink',
      });
      if (verifyErr) {
        log.error('phone_login_session_mint_failed', verifyErr);
        setError('Something went wrong. Try again?');
        return;
      }

      log.action('signed_in', { method: 'phone' });
      capture(Events.NOTIFICATION_OPTED_IN, { flow: 'phone_login' });
      router.replace('/(app)/(tabs)');
    } catch (err) {
      log.error('phone_login_verify_failed', err);
      setError('Something went wrong. Try again?');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendIn > 0 || resending) return;
    if (!normalized) return;
    setResending(true);
    setError('');
    try {
      await fetch(
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
      setResendIn(RESEND_COOLDOWN_S);
    } catch {
      setError('Could not resend the code. Try again in a moment.');
    } finally {
      setResending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.cream }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 80, paddingBottom: 40 }}>
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
          <Ionicons name="chatbubble-ellipses" size={28} color={T.green} />
        </View>

        <Text
          style={{
            ...headlineFont.bold,
            fontSize: 36,
            color: T.ink,
            letterSpacing: -1,
            marginBottom: 10,
          }}
        >
          Check your texts
        </Text>
        <Text style={{ color: T.muted, fontSize: 16, lineHeight: 24, marginBottom: 8 }}>
          We sent a 6-digit code to
        </Text>
        <Text style={{ color: T.ink, fontSize: 16, fontWeight: '700', marginBottom: 24 }}>
          {normalized ?? phone ?? 'your phone'}
        </Text>

        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(t) => {
            const digits = t.replace(/\D/g, '').slice(0, 6);
            setCode(digits);
            if (error) setError('');
            if (digits.length === 6) {
              setTimeout(() => handleVerify(), 150);
            }
          }}
          placeholder="123456"
          placeholderTextColor={PLACEHOLDER}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          style={{
            backgroundColor: T.card,
            borderWidth: 1,
            borderColor: error ? T.error : T.line,
            borderRadius: 12,
            paddingHorizontal: 18,
            paddingVertical: 16,
            fontSize: 28,
            fontWeight: '600',
            color: T.ink,
            letterSpacing: 8,
            textAlign: 'center',
            marginBottom: 8,
          }}
        />
        {error ? (
          <Text style={{ color: T.error, fontSize: 13, marginBottom: 8 }}>{error}</Text>
        ) : null}

        <Button onPress={handleVerify} loading={loading} fullWidth className="mt-4">
          Log in
        </Button>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 }}>
          <Pressable onPress={handleResend} disabled={resendIn > 0 || resending}>
            <Text
              style={{
                color: resendIn > 0 || resending ? PLACEHOLDER : T.green,
                fontSize: 14,
                fontWeight: '600',
              }}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : resending ? 'Sending…' : 'Resend code'}
            </Text>
          </Pressable>
          <Pressable onPress={() => router.back()}>
            <Text style={{ color: T.muted, fontSize: 14, fontWeight: '600' }}>Use a different number</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function reasonToCopy(reason: string | undefined): string {
  switch (reason) {
    case 'expired':            return 'That code expired. Tap "Resend" for a fresh one.';
    case 'too_many_attempts':  return 'Too many tries. Tap "Resend" for a new code.';
    case 'invalid_code':       return "That code didn't match. Try again or tap 'Resend'.";
    case 'no_account':         return "We don't have an account for that phone. Try email instead, or sign up.";
    default:                   return 'Something went wrong. Try again?';
  }
}
