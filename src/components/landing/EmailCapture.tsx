/**
 * Reusable email-capture form for the closed-beta waitlist.
 *
 * One component, three surfaces:
 *  - Landing hero (variant="inline")
 *  - Landing final CTA (variant="inline" or "card")
 *  - Respond-page post-submit prompt (variant="card")
 *
 * All callers attribute via `source` and (optionally) `tripId` so we can
 * see in `beta_signups` which surface drove the signup.
 */
import { useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { joinBetaList } from '@/lib/api/beta';
import { capture, Events } from '@/lib/analytics';
import { T } from '@/theme';

const HEADLINE_FONT = Platform.OS === 'android' ? 'serif' : 'Georgia';

// Brand tokens via T (single source of truth — see src/theme/colors.ts).
const C = {
  green:     T.green,
  green2:    T.greenDark,
  greenSoft: T.greenSoft,
  ink:       T.ink,
  muted:     T.muted,
  line:      T.line,
  card:      T.card,
  white:     T.white,
  error:     T.error,
};

interface EmailCaptureProps {
  /** Attribution tag stored in beta_signups.source */
  source: string;
  /** Optional trip UUID — when set, signup is attributed to the trip */
  tripId?: string | null;
  /**
   * Visual variant:
   *  - 'inline' — flat row, email + button side-by-side on desktop, stacked on mobile
   *  - 'card'   — boxed card with optional title + subtitle, button below the field
   */
  variant?: 'inline' | 'card';
  /** Override the submit-button label */
  ctaLabel?: string;
  /** Card-variant heading */
  title?: string;
  /** Card-variant subtitle */
  subtitle?: string;
  /** Small caption below the form (inline variant default: "Be the first to plan with Rally") */
  caption?: string;
  /** Override the success-state heading */
  successTitle?: string;
  /** Override the success-state body */
  successBody?: string;
  /** When true, the form stacks email + button vertically even on wide screens */
  forceStack?: boolean;
}

export function EmailCapture({
  source,
  tripId,
  variant = 'inline',
  ctaLabel = 'Get me on the list',
  title,
  subtitle,
  caption,
  successTitle,
  successBody,
  forceStack = false,
}: EmailCaptureProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Enter your email');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("That doesn't look like a valid email");
      return;
    }
    setError('');
    setLoading(true);
    try {
      await joinBetaList({ email: trimmed, source, tripId: tripId ?? null });
      capture(Events.DOWNLOAD_PROMPT_TAPPED, {
        action: 'beta_signup',
        source,
        trip_id: tripId ?? null,
      });
      setSuccess(true);
    } catch {
      setError('Something went wrong — try again?');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <SuccessState
        variant={variant}
        title={successTitle ?? "You're on the list."}
        body={successBody ?? `We'll email ${email} as soon as Rally opens up.`}
      />
    );
  }

  const Form = (
    <FormBlock
      email={email}
      setEmail={(e) => {
        setEmail(e);
        if (error) setError('');
      }}
      error={error}
      loading={loading}
      ctaLabel={ctaLabel}
      onSubmit={handleSubmit}
      forceStack={forceStack}
    />
  );

  if (variant === 'card') {
    return (
      <View
        style={{
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.line,
          borderRadius: 18,
          paddingHorizontal: 20,
          paddingVertical: 22,
          width: '100%',
          maxWidth: 480,
          alignSelf: 'center',
          gap: 14,
        }}
      >
        {title ? (
          <Text
            style={{
              fontFamily: HEADLINE_FONT,
              fontSize: 24,
              fontWeight: '700',
              color: C.green,
              letterSpacing: -0.6,
              textAlign: 'center',
            }}
          >
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text
            style={{
              color: C.muted,
              textAlign: 'center',
              fontSize: 15,
              lineHeight: 22,
              marginTop: -4,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
        {Form}
        {caption ? (
          <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center' }}>{caption}</Text>
        ) : null}
      </View>
    );
  }

  // Inline variant
  return (
    <View style={{ gap: 8, width: '100%', maxWidth: 480 }}>
      {Form}
      {caption ? (
        <Text style={{ color: C.muted, fontSize: 13 }}>{caption}</Text>
      ) : null}
    </View>
  );
}

function FormBlock({
  email,
  setEmail,
  error,
  loading,
  ctaLabel,
  onSubmit,
  forceStack,
}: {
  email: string;
  setEmail: (e: string) => void;
  error: string;
  loading: boolean;
  ctaLabel: string;
  onSubmit: () => void;
  forceStack: boolean;
}) {
  return (
    <View>
      <View style={{ flexDirection: forceStack ? 'column' : 'row', gap: 8, alignItems: 'stretch' }}>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor="#9DA8A0"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          style={{
            flex: forceStack ? undefined : 1,
            backgroundColor: C.card,
            borderWidth: 1,
            borderColor: error ? C.error : C.line,
            borderRadius: 999,
            paddingHorizontal: 18,
            paddingVertical: 14,
            fontSize: 15,
            color: C.ink,
            minHeight: 48,
          }}
          onSubmitEditing={onSubmit}
        />
        <Pressable
          onPress={onSubmit}
          disabled={loading}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
            backgroundColor: pressed || hovered ? C.green2 : C.green,
            borderRadius: 999,
            paddingHorizontal: 22,
            paddingVertical: 14,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: loading ? 0.7 : 1,
            minHeight: 48,
          })}
        >
          <Text
            style={{
              color: C.white,
              fontWeight: '700',
              fontSize: 15,
              letterSpacing: 0.2,
            }}
          >
            {loading ? 'Sending…' : ctaLabel}
          </Text>
        </Pressable>
      </View>
      {error ? (
        <Text style={{ color: C.error, fontSize: 13, marginTop: 6 }}>{error}</Text>
      ) : null}
    </View>
  );
}

function SuccessState({
  variant,
  title,
  body,
}: {
  variant: 'inline' | 'card';
  title: string;
  body: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 12,
        alignItems: 'flex-start',
        backgroundColor: variant === 'card' ? C.card : C.greenSoft,
        borderWidth: variant === 'card' ? 1 : 0,
        borderColor: C.line,
        borderRadius: 18,
        paddingHorizontal: 18,
        paddingVertical: 16,
        width: '100%',
        maxWidth: 480,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 999,
          backgroundColor: C.green,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: C.white, fontWeight: '700' }}>✓</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>{title}</Text>
        <Text style={{ color: C.muted, fontSize: 14, marginTop: 4, lineHeight: 20 }}>{body}</Text>
      </View>
    </View>
  );
}
