/**
 * Claim phone — OTP verification screen.
 *
 * Reached after signup when `check_claim_available(phone)` returned true,
 * meaning Rally has SMS / survey history attached to that phone but no
 * auth account yet. The user enters the 6-digit code we just sent to
 * their phone, the `claim_account_with_otp` RPC verifies + merges
 * trip_members in one transaction, then they land in My Trips with
 * their pre-existing trips already showing.
 *
 * Skip button is intentionally prominent — the user already has a
 * working account; claiming history is bonus, not gated.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
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
import { capture, Events } from '@/lib/analytics';

const HEADLINE_FONT = Platform.OS === 'android' ? 'serif' : 'Georgia';
const RESEND_COOLDOWN_S = 30;

export default function ClaimPhoneScreen() {
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

  // Countdown for the resend button
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Autofocus the OTP input
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 250);
  }, []);

  async function handleVerify() {
    if (!normalized) {
      setError('We don\'t have a phone on file. Skip for now.');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code we sent you.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('claim_account_with_otp', {
        p_phone: normalized,
        p_code: code,
      });
      if (rpcErr) {
        setError('Something went wrong. Try again?');
        return;
      }
      const result = (data ?? {}) as { ok?: boolean; reason?: string; trips_added?: number };
      if (!result.ok) {
        setError(reasonToCopy(result.reason));
        return;
      }
      capture(Events.NOTIFICATION_OPTED_IN, {
        flow: 'phone_claim',
        trips_added: result.trips_added ?? 0,
      });
      const added = result.trips_added ?? 0;
      Alert.alert(
        added > 0 ? "You're all set" : "You're verified",
        added > 0
          ? `Added you to ${added} trip${added === 1 ? '' : 's'} from your text history.`
          : 'Your phone is verified — you\'ll see new trips here as your group plans them.',
        [{ text: 'Open Rally', onPress: () => router.replace('/(app)/(tabs)') }],
      );
    } catch {
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
      await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/claim-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
        },
        body: JSON.stringify({ phone: normalized }),
      });
      setResendIn(RESEND_COOLDOWN_S);
    } catch {
      setError('Could not resend the code. Try again in a moment.');
    } finally {
      setResending(false);
    }
  }

  function handleSkip() {
    capture(Events.NOTIFICATION_OPTED_IN, { flow: 'phone_claim_skipped' });
    router.replace('/(app)/(tabs)');
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-cream"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 80, paddingBottom: 40 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: '#DFE8D2',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}
        >
          <Ionicons name="chatbubble-ellipses" size={28} color="#0F3F2E" />
        </View>

        <Text
          style={{
            fontFamily: HEADLINE_FONT,
            fontSize: 36,
            color: '#163026',
            fontWeight: '700',
            letterSpacing: -1,
            marginBottom: 10,
          }}
        >
          Check your texts
        </Text>
        <Text style={{ color: '#5F685F', fontSize: 16, lineHeight: 24, marginBottom: 8 }}>
          We sent a 6-digit code to
        </Text>
        <Text style={{ color: '#163026', fontSize: 16, fontWeight: '700', marginBottom: 24 }}>
          {normalized ?? phone ?? 'your phone'}
        </Text>
        <Text style={{ color: '#5F685F', fontSize: 14, lineHeight: 20, marginBottom: 24 }}>
          Confirm it's you and we'll pull in any trips from your text history.
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
          placeholderTextColor="#9DA8A0"
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          style={{
            backgroundColor: '#FFFAF2',
            borderWidth: 1,
            borderColor: error ? '#C13515' : '#E7DDCF',
            borderRadius: 12,
            paddingHorizontal: 18,
            paddingVertical: 16,
            fontSize: 28,
            fontWeight: '600',
            color: '#163026',
            letterSpacing: 8,
            textAlign: 'center',
            marginBottom: 8,
          }}
        />
        {error ? (
          <Text style={{ color: '#C13515', fontSize: 13, marginBottom: 8 }}>{error}</Text>
        ) : null}

        <Button onPress={handleVerify} loading={loading} fullWidth className="mt-4">
          Verify and continue
        </Button>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 }}>
          <Pressable onPress={handleResend} disabled={resendIn > 0 || resending}>
            <Text
              style={{
                color: resendIn > 0 || resending ? '#9DA8A0' : '#0F3F2E',
                fontSize: 14,
                fontWeight: '600',
              }}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : resending ? 'Sending…' : 'Resend code'}
            </Text>
          </Pressable>
          <Pressable onPress={handleSkip}>
            <Text style={{ color: '#5F685F', fontSize: 14, fontWeight: '600' }}>Skip for now</Text>
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
    case 'no_match':           return "Verified — but we don't have any trips on that phone yet.";
    case 'not_authenticated':  return 'Your session expired. Please sign in again.';
    default:                   return 'Something went wrong. Try again?';
  }
}
