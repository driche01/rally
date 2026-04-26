/**
 * Public join page for the 1:1 SMS pivot (Phase 1).
 *
 * Flow:
 *   - rally://join/CODE  (deep link)
 *   - https://rallysurveys.netlify.app/join/CODE  (web)
 *
 * Three states: loading preview → form → "check your phone" success.
 *
 * No auth. The form posts to the sms-join-submit edge function which
 * normalizes the phone, dedups, rate-limits, and texts a confirmation.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Button, Input } from '@/components/ui';
import { normalizePhone } from '@/lib/phone';
import {
  getJoinLinkPreview,
  submitJoinLink,
  type SubmitJoinLinkResult,
} from '@/lib/api/joinLink';
import type { JoinLinkPreview } from '@/types/database';

const IS_WEB = Platform.OS === 'web';

const REASON_COPY: Record<string, string> = {
  invalid_code: "This invite link doesn't look right. Double-check the URL.",
  expired: 'This invite has expired — ask whoever invited you for a fresh one.',
  revoked: 'This invite has been revoked.',
  capacity_reached: 'This invite is full.',
  invalid_phone: "That phone number didn't look right. Try again with the digits only.",
  rate_limited: 'A lot of submissions from this network — try again in a bit.',
  sms_send_failed: "Couldn't send the confirmation text. Hit retry below.",
  missing_fields: 'Add your name and phone to continue.',
  field_too_long: 'That name or email is too long.',
  server_error: 'Something went wrong on our end. Try again.',
};

function WebShell({ children }: { children: React.ReactNode }) {
  if (!IS_WEB) return <>{children}</>;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#F4ECDF',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 480,
          backgroundColor: 'white',
          borderRadius: 24,
          overflow: 'hidden',
          // @ts-ignore web-only
          boxShadow: '0 4px 40px rgba(0,0,0,0.10)',
        }}
      >
        {children}
      </View>
    </View>
  );
}

function formatDateRange(dates: { start?: string; end?: string } | null | undefined): string {
  if (!dates?.start || !dates?.end) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const s = new Date(dates.start + 'T12:00:00');
  const e = new Date(dates.end + 'T12:00:00');
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return '';
  return `${months[s.getMonth()]} ${s.getDate()}\u2013${e.getDate()}`;
}

export default function JoinScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = (params.code ?? '').toString().trim().toUpperCase();
  const insets = useSafeAreaInsets();

  const [preview, setPreview] = useState<JoinLinkPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitJoinLinkResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const phoneRef = useRef<TextInput>(null);

  useEffect(() => {
    let cancelled = false;
    if (!code) {
      setPreviewError('invalid_code');
      return () => {};
    }
    (async () => {
      const p = await getJoinLinkPreview(code);
      if (cancelled) return;
      if (!p.ok) {
        setPreviewError(p.reason ?? 'invalid_code');
        return;
      }
      setPreview(p);
    })();
    return () => { cancelled = true; };
  }, [code]);

  const dateLabel = useMemo(() => formatDateRange(preview?.dates), [preview?.dates]);
  const plannerLabel = preview?.planner_name ?? 'A friend';

  async function handleSubmit() {
    setFormError(null);
    const trimmedName = name.trim();
    const normalized = normalizePhone(phone);
    if (!trimmedName) {
      setFormError('Add your name first.');
      return;
    }
    if (!normalized) {
      setFormError("That phone number didn't look right.");
      phoneRef.current?.focus();
      return;
    }
    setSubmitting(true);
    const result = await submitJoinLink({
      code,
      phone: normalized,
      displayName: trimmedName,
      email: email.trim() || null,
    });
    setSubmitting(false);
    setSubmitResult(result);
    if (!result.ok) {
      const copy = REASON_COPY[result.reason] ?? 'Something went wrong. Try again.';
      setFormError(copy);
    }
  }

  // ─── Preview-load error ───────────────────────────────────────────────
  if (previewError) {
    return (
      <WebShell>
        <View style={{ padding: 32, alignItems: 'center', minHeight: IS_WEB ? 360 : 0 }}>
          <Ionicons name="alert-circle-outline" size={48} color="#D85A30" />
          <Text className="mt-4 text-center text-xl font-semibold text-ink">
            {previewError === 'invalid_or_expired'
              ? 'This invite has expired'
              : "This invite link doesn't work"}
          </Text>
          <Text className="mt-2 text-center text-base text-muted">
            Ask whoever sent it for a fresh link.
          </Text>
        </View>
      </WebShell>
    );
  }

  // ─── Loading ──────────────────────────────────────────────────────────
  if (!preview) {
    return (
      <WebShell>
        <View style={{ padding: 32, alignItems: 'center', minHeight: IS_WEB ? 360 : 0 }}>
          <ActivityIndicator size="large" color="#1D9E75" />
          <Text className="mt-3 text-base text-muted">Loading invite…</Text>
        </View>
      </WebShell>
    );
  }

  // ─── Success state ────────────────────────────────────────────────────
  if (submitResult?.ok) {
    const headline =
      submitResult.reason === 'already_joined'
        ? "You're already in"
        : submitResult.reason === 'duplicate_recent'
          ? 'Check your phone'
          : 'Check your phone';
    const body =
      submitResult.reason === 'already_joined'
        ? `${plannerLabel} already added you to this trip. Look for texts from Rally.`
        : `I just texted ${normalizePhone(phone)}. Reply YES to join the trip.`;

    return (
      <WebShell>
        <ScrollView
          contentContainerStyle={{ padding: 32, paddingBottom: 32 + insets.bottom }}
        >
          <View style={{ alignItems: 'center' }}>
            <View
              style={{
                width: 64, height: 64, borderRadius: 32,
                backgroundColor: '#E6F4EF', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Ionicons name="checkmark-circle" size={48} color="#1D9E75" />
            </View>
            <Text className="mt-5 text-center text-2xl font-semibold text-ink">{headline}</Text>
            <Text className="mt-3 text-center text-base text-muted">{body}</Text>

            {submitResult.reason !== 'already_joined' ? (
              <Pressable
                onPress={() => {
                  setSubmitResult(null);
                  setFormError(null);
                }}
                style={{ marginTop: 24 }}
                accessibilityRole="button"
              >
                <Text className="text-sm text-muted underline">Didn't get the text? Try again</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </WebShell>
    );
  }

  // ─── Form ─────────────────────────────────────────────────────────────
  return (
    <WebShell>
      <KeyboardAvoidingView behavior={IS_WEB ? undefined : 'padding'} style={{ flex: IS_WEB ? 0 : 1 }}>
        <ScrollView
          contentContainerStyle={{
            padding: 24,
            paddingTop: IS_WEB ? 32 : 24 + insets.top,
            paddingBottom: 32 + insets.bottom,
          }}
        >
          {/* Planner identity — leading the page so the recipient sees who
              invited them before anything else. Phase 8b trust signal. */}
          <View className="flex-row items-center gap-3">
            <Avatar name={plannerLabel} size="md" />
            <View style={{ flex: 1 }}>
              <Text className="text-sm font-medium text-coral">Trip invite</Text>
              <Text className="text-base font-semibold text-ink">{plannerLabel}</Text>
            </View>
          </View>

          <Text className="mt-5 text-3xl font-bold text-ink">
            {plannerLabel} added you to a trip
          </Text>

          {(preview.destination || dateLabel) ? (
            <View className="mt-4 gap-1">
              {preview.destination ? (
                <View className="flex-row items-center gap-2">
                  <Ionicons name="location-outline" size={18} color="#2C2C2A" />
                  <Text className="text-base text-ink">{preview.destination}</Text>
                </View>
              ) : null}
              {dateLabel ? (
                <View className="flex-row items-center gap-2">
                  <Ionicons name="calendar-outline" size={18} color="#2C2C2A" />
                  <Text className="text-base text-ink">{dateLabel}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Social proof — show names if ≤3, count otherwise. */}
          {preview.joined_names.length > 0 ? (
            <View className="mt-5 flex-row items-center gap-2">
              <Ionicons name="people-outline" size={16} color="#666" />
              <Text className="text-sm text-muted">
                {preview.joined_names.length <= 3
                  ? `${preview.joined_names.join(', ')} ${preview.joined_names.length === 1 ? 'is' : 'are'} already in`
                  : `${preview.member_count} friends already joined`}
              </Text>
            </View>
          ) : null}

          {/* "What is Rally?" reassurance — small print under the social proof. */}
          <View className="mt-6 rounded-xl bg-cream-warm p-4" style={{ backgroundColor: '#F4ECDF' }}>
            <Text className="text-xs font-semibold text-ink" style={{ letterSpacing: 0.4 }}>
              WHAT IS RALLY?
            </Text>
            <Text className="mt-1 text-sm text-ink" style={{ lineHeight: 19 }}>
              Rally helps your friend group plan trips together. We'll text you when there's
              a decision to weigh in on. No spam, no daily texts.
            </Text>
          </View>

          <View className="mt-8 gap-4">
            <Input
              label="Your name"
              value={name}
              onChangeText={setName}
              placeholder="First name is fine"
              autoComplete="name"
              autoCapitalize="words"
              returnKeyType="next"
              onSubmitEditing={() => phoneRef.current?.focus()}
            />
            <Input
              ref={phoneRef}
              label="Mobile number"
              value={phone}
              onChangeText={setPhone}
              placeholder="(555) 123-4567"
              keyboardType="phone-pad"
              autoComplete="tel"
              hint="I'll text a confirmation. Standard message rates apply."
            />
            <Input
              label="Email (optional)"
              value={email}
              onChangeText={setEmail}
              placeholder="optional"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            {formError ? (
              <Text className="text-sm text-red-500">{formError}</Text>
            ) : null}

            <Button
              onPress={handleSubmit}
              disabled={submitting || !name.trim() || !phone.trim()}
              loading={submitting}
            >
              Join the trip
            </Button>

            <Text className="mt-2 text-center text-xs text-muted">
              By joining, you agree to receive SMS from Rally. Reply STOP anytime to opt out.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </WebShell>
  );
}
