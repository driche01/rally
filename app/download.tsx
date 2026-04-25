/**
 * Closed-beta waitlist landing page — `/download`
 *
 * Destination for the "Download Rally" CTA that appears in SMS planner
 * welcomes, the APP keyword reply, and trip-recap footers. Lives on the
 * existing Netlify deploy at `rallysurveys.netlify.app/download`.
 *
 * When a user taps the CTA but TestFlight/App Store isn't live yet, this
 * page captures their email so we can onboard them the moment we ship.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { joinBetaList } from '@/lib/api/beta';
import { capture, Events } from '@/lib/analytics';

// 2026-04-24 brand palette — green primary, cream surfaces, ink text.
// Coral is intentionally absent on this page; it's a sparingly-used accent.
const GREEN = '#0F3F2E';
const GREEN_DARK = '#174F3C';
const GREEN_SOFT = '#DFE8D2';
const CREAM = '#FBF7EF';
const CARD = '#FFFAF2';
const LINE = '#E7DDCF';
const INK = '#163026';
const MUTED = '#5F685F';
// System Georgia (iOS/macOS/web) → serif fallback on Android.
const HEADLINE_FONT = Platform.OS === 'android' ? 'serif' : 'Georgia';

export default function DownloadPage() {
  const { source, trip } = useLocalSearchParams<{ source?: string; trip?: string }>();
  const insets = useSafeAreaInsets();
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
      setError('That doesn\'t look like a valid email');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await joinBetaList({
        email: trimmed,
        source: source ?? 'download_page',
        tripId: trip ?? null,
      });
      capture(Events.DOWNLOAD_PROMPT_TAPPED, {
        page: 'download',
        action: 'beta_signup',
        source: source ?? 'download_page',
        trip_id: trip ?? null,
      });
      setSuccess(true);
    } catch {
      setError('Something went wrong — try again?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: CREAM }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          maxWidth: 520,
          alignSelf: 'center',
          width: '100%',
          paddingHorizontal: 24,
          paddingTop: Math.max(insets.top, 48),
          paddingBottom: 48,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand mark */}
        <Text
          style={{
            fontFamily: HEADLINE_FONT,
            fontSize: 44,
            fontWeight: '700',
            color: GREEN,
            letterSpacing: -1,
            marginBottom: 28,
          }}
        >
          rally
        </Text>

        {success ? <SuccessCard email={email} /> : (
          <>
            <Text
              style={{
                fontFamily: HEADLINE_FONT,
                fontSize: 44,
                fontWeight: '700',
                color: INK,
                letterSpacing: -0.8,
                lineHeight: 48,
                marginBottom: 14,
              }}
            >
              Group trips, made easy.
            </Text>
            <Text style={{ fontSize: 18, color: MUTED, lineHeight: 26, marginBottom: 32 }}>
              Rally's in closed beta. Drop your email and we'll get you in as soon as we open up.
            </Text>

            {/* Email form */}
            <View style={{ gap: 12 }}>
              <View>
                <TextInput
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    if (error) setError('');
                  }}
                  placeholder="you@example.com"
                  placeholderTextColor="#9DA8A0"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  style={{
                    backgroundColor: CARD,
                    borderWidth: 1,
                    borderColor: error ? '#C13515' : LINE,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    fontSize: 16,
                    color: INK,
                  }}
                  onSubmitEditing={handleSubmit}
                />
                {error ? (
                  <Text style={{ color: '#C13515', fontSize: 13, marginTop: 6 }}>{error}</Text>
                ) : null}
              </View>

              <Pressable
                onPress={handleSubmit}
                disabled={loading}
                style={{
                  backgroundColor: loading ? GREEN_DARK : GREEN,
                  borderRadius: 12,
                  paddingVertical: 16,
                  alignItems: 'center',
                  opacity: loading ? 0.7 : 1,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>
                  {loading ? 'Sending...' : 'Get me on the list'}
                </Text>
              </Pressable>
            </View>

            {/* What is Rally */}
            <View style={{ marginTop: 48, gap: 20 }}>
              <Bullet
                icon="chatbubbles-outline"
                title="Your group chat, handled."
                body="Drop Rally in your group chat and it'll wrangle destination, dates, and budget — without a single spreadsheet."
              />
              <Bullet
                icon="flash-outline"
                title="Real decisions, in minutes."
                body="Rally polls your group, tallies replies, and pins down the plan. No more 47-message scroll to figure out who's actually coming."
              />
              <Bullet
                icon="airplane-outline"
                title="Flights, stays, expenses — one place."
                body="Once the trip's confirmed, Rally helps you book it and splits the costs at the end."
              />
            </View>

            <Text
              style={{
                fontSize: 12,
                color: MUTED,
                marginTop: 40,
                textAlign: 'center',
              }}
            >
              We'll only email you about getting access. No spam, promise.
            </Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SuccessCard({ email }: { email: string }) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 48 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: GREEN_SOFT,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
        }}
      >
        <Ionicons name="checkmark" size={40} color={GREEN} />
      </View>
      <Text
        style={{
          fontFamily: HEADLINE_FONT,
          fontSize: 36,
          fontWeight: '700',
          color: INK,
          letterSpacing: -0.5,
          marginBottom: 10,
          textAlign: 'center',
        }}
      >
        You're on the list.
      </Text>
      <Text
        style={{
          fontSize: 17,
          color: MUTED,
          textAlign: 'center',
          lineHeight: 24,
          maxWidth: 380,
        }}
      >
        We'll send an email to{' '}
        <Text style={{ fontWeight: '600', color: INK }}>{email}</Text> as soon as Rally opens up.
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: MUTED,
          textAlign: 'center',
          marginTop: 32,
          maxWidth: 360,
          lineHeight: 20,
        }}
      >
        In the meantime, keep planning over text — Rally's already working for you there.
      </Text>
    </View>
  );
}

function Bullet({
  icon,
  title,
  body,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: GREEN_SOFT,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={20} color={GREEN} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: INK, marginBottom: 4 }}>
          {title}
        </Text>
        <Text style={{ fontSize: 15, color: MUTED, lineHeight: 22 }}>{body}</Text>
      </View>
    </View>
  );
}
