/**
 * Activate-SMS screen — Phase 4 "Get Rally to run this in my group."
 *
 * Reached from the share flow on the polls page. Pre-creates an SMS
 * trip_session linked to this app trip via `app_create_sms_session`,
 * shows Rally's number with copy-to-clipboard + visual instructions,
 * and watches the session via realtime for the activation flip.
 *
 * Honest UX: iOS has no public intent to add a contact to an existing
 * group thread, so we don't promise one-tap. The user copies Rally's
 * number, opens their group chat, pastes Rally in, and sends one
 * message — the inbound-processor handoff promotes the placeholder
 * session to the real thread and this card flips to "Active."
 */
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useTripSessionActivation } from '@/hooks/useTripSessionActivation';
import { capture, Events } from '@/lib/analytics';

const HEADLINE_FONT = Platform.OS === 'android' ? 'serif' : 'Georgia';

// Rally's public Twilio number. Update here if Rally adds another sending
// number — same constant is referenced by the test harness at
// `supabase/functions/tests/harness.ts:20`.
const RALLY_NUMBER = '+18559310010';
const RALLY_NUMBER_DISPLAY = '(855) 931-0010';

const C = {
  cream:     '#FBF7EF',
  card:      '#FFFAF2',
  green:     '#0F3F2E',
  greenSoft: '#DFE8D2',
  ink:       '#163026',
  muted:     '#5F685F',
  line:      '#E7DDCF',
  white:     '#FFFFFF',
  error:     '#C13515',
};

export default function ActivateSmsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: tripId } = useLocalSearchParams<{ id: string }>();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [copied, setCopied] = useState(false);

  const activation = useTripSessionActivation(sessionId);

  // Kick off the pre-create on mount
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('app_create_sms_session', {
        p_trip_id: tripId,
      });
      if (cancelled) return;
      if (error) {
        setBootstrapError('Could not start the SMS session. Try again in a moment.');
        setBootstrapping(false);
        return;
      }
      const result = (data ?? {}) as { ok?: boolean; reason?: string; session_id?: string };
      if (!result.ok) {
        setBootstrapError(reasonToCopy(result.reason));
      } else if (result.session_id) {
        setSessionId(result.session_id);
        capture(Events.SHARE_LINK_COPIED, {
          flow: 'app_create_sms_session',
          trip_id: tripId,
          session_id: result.session_id,
        });
      }
      setBootstrapping(false);
    })();
    return () => { cancelled = true; };
  }, [tripId]);

  async function handleCopyNumber() {
    await Clipboard.setStringAsync(RALLY_NUMBER);
    setCopied(true);
    capture(Events.SHARE_LINK_COPIED, { flow: 'rally_number_copied', trip_id: tripId });
    setTimeout(() => setCopied(false), 2500);
  }

  function handleOpenMessages() {
    // Soft attempt: open Messages composing to Rally. The user still
    // needs to add their group manually — we can't programmatically
    // push Rally into an existing group thread on iOS.
    if (Platform.OS === 'web') {
      Alert.alert('Open Messages', 'Open the Messages app on your phone, then tap + to add Rally to your group chat.');
      return;
    }
    capture(Events.SHARE_LINK_COPIED, { flow: 'rally_open_messages', trip_id: tripId });
    const url = Platform.OS === 'ios' ? `sms:${RALLY_NUMBER}` : `sms:${RALLY_NUMBER}`;
    import('react-native').then(({ Linking }) => Linking.openURL(url));
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.cream }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: 24,
      }}
    >
      {/* Back */}
      <Pressable onPress={() => router.back()} style={{ marginBottom: 24, alignSelf: 'flex-start' }}>
        <Text style={{ color: C.green, fontSize: 16, fontWeight: '600' }}>← Back</Text>
      </Pressable>

      {/* Headline */}
      <Text
        style={{
          fontFamily: HEADLINE_FONT,
          fontSize: 36,
          color: C.green,
          fontWeight: '700',
          letterSpacing: -1,
          marginBottom: 10,
        }}
      >
        Get Rally to run{'\n'}your group chat
      </Text>
      <Text style={{ color: C.muted, fontSize: 16, lineHeight: 24, marginBottom: 28 }}>
        Add Rally's number to your group, send one message, and Rally will take it from there — collecting destinations, dates, budget, and the rest.
      </Text>

      {/* Status card — flips when realtime fires */}
      <StatusCard
        bootstrapping={bootstrapping}
        bootstrapError={bootstrapError}
        activated={activation.activated}
      />

      {/* Rally number — copy */}
      <View style={{ marginTop: 24 }}>
        <Text style={{ color: C.muted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Rally's number
        </Text>
        <Pressable
          onPress={handleCopyNumber}
          style={({ pressed }) => ({
            backgroundColor: copied ? C.greenSoft : C.card,
            borderWidth: 1,
            borderColor: copied ? C.green : C.line,
            borderRadius: 14,
            paddingHorizontal: 18,
            paddingVertical: 16,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ fontSize: 22, fontWeight: '700', color: C.ink, letterSpacing: 0.5 }}>
            {RALLY_NUMBER_DISPLAY}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons
              name={copied ? 'checkmark-circle' : 'copy-outline'}
              size={20}
              color={copied ? C.green : C.muted}
            />
            <Text style={{ color: copied ? C.green : C.muted, fontSize: 14, fontWeight: '600' }}>
              {copied ? 'Copied' : 'Tap to copy'}
            </Text>
          </View>
        </Pressable>
      </View>

      {/* How-to steps */}
      <View style={{ marginTop: 28, gap: 16 }}>
        <Step
          icon="chatbubbles-outline"
          n={1}
          title="Open your group chat"
          body="Switch to the Messages app and pull up the group you want to plan with."
        />
        <Step
          icon="add-circle-outline"
          n={2}
          title="Add Rally's number"
          body="Tap + or the contact list and paste the number above."
        />
        <Step
          icon="paper-plane-outline"
          n={3}
          title="Send one message"
          body='Anything works — "Hey" is fine. Rally takes it from there.'
        />
      </View>

      {/* Soft fallback CTA on native */}
      {Platform.OS !== 'web' ? (
        <Pressable
          onPress={handleOpenMessages}
          style={({ pressed }) => ({
            marginTop: 28,
            paddingVertical: 14,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: C.line,
            alignItems: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: C.ink, fontWeight: '600', fontSize: 15 }}>
            Open Messages
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function StatusCard({
  bootstrapping,
  bootstrapError,
  activated,
}: {
  bootstrapping: boolean;
  bootstrapError: string | null;
  activated: boolean;
}) {
  if (bootstrapError) {
    return (
      <View
        style={{
          flexDirection: 'row',
          gap: 12,
          alignItems: 'flex-start',
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.error,
          borderRadius: 14,
          padding: 16,
        }}
      >
        <Ionicons name="alert-circle-outline" size={22} color={C.error} />
        <Text style={{ flex: 1, color: C.ink, fontSize: 14, lineHeight: 20 }}>
          {bootstrapError}
        </Text>
      </View>
    );
  }

  if (activated) {
    return (
      <View
        style={{
          flexDirection: 'row',
          gap: 12,
          alignItems: 'center',
          backgroundColor: C.greenSoft,
          borderRadius: 14,
          padding: 16,
        }}
      >
        <Ionicons name="checkmark-circle" size={22} color={C.green} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.ink, fontSize: 16, fontWeight: '700' }}>
            Active 🎉
          </Text>
          <Text style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>
            Rally is in your group chat and planning with everyone now.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
        backgroundColor: C.card,
        borderWidth: 1,
        borderColor: C.line,
        borderRadius: 14,
        padding: 16,
      }}
    >
      {bootstrapping ? (
        <ActivityIndicator size="small" color={C.green} />
      ) : (
        <Ionicons name="time-outline" size={22} color={C.muted} />
      )}
      <Text style={{ flex: 1, color: C.ink, fontSize: 14, lineHeight: 20 }}>
        {bootstrapping
          ? 'Setting up Rally for your trip…'
          : 'Waiting for your group to message Rally. This page updates automatically.'}
      </Text>
    </View>
  );
}

function Step({
  icon,
  n,
  title,
  body,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  n: number;
  title: string;
  body: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: C.greenSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={20} color={C.green} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.ink, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>
          {n}. {title}
        </Text>
        <Text style={{ color: C.muted, fontSize: 14, lineHeight: 20 }}>{body}</Text>
      </View>
    </View>
  );
}

function reasonToCopy(reason: string | undefined): string {
  switch (reason) {
    case 'not_authenticated':       return 'Your session expired. Sign in and try again.';
    case 'forbidden':               return "You don't have access to this trip.";
    case 'profile_missing_phone':   return 'Add a phone to your profile first — Rally needs it to attribute the group thread to you.';
    default:                        return 'Could not start the SMS session. Try again in a moment.';
  }
}
