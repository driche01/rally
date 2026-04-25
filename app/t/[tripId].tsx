/**
 * Universal-link landing page — `/t/<tripId>`
 *
 * Destination for trip-specific deep links embedded in SMS intros,
 * recap footers, and the APP keyword reply. Flow:
 *
 *  1. App installed (native): Expo Router handles the link directly via
 *     `associatedDomains` — this web page never renders on iOS/Android
 *     with Rally installed.
 *  2. Browser without the app: we attempt `rally://trip/<tripId>` (harmless
 *     if Rally isn't installed, opens the trip if it is), then show a
 *     "Don't have the app?" CTA routing to `/download?trip=<tripId>`.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { capture, Events } from '@/lib/analytics';

// 2026-04-24 brand palette — green primary, cream surfaces, ink text.
const GREEN = '#0F3F2E';
const CREAM = '#FBF7EF';
const CARD = '#FFFAF2';
const LINE = '#E7DDCF';
const INK = '#163026';
const MUTED = '#5F685F';
const HEADLINE_FONT = Platform.OS === 'android' ? 'serif' : 'Georgia';

export default function UniversalLinkLandingPage() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [didAttemptDeepLink, setDidAttemptDeepLink] = useState(false);

  // Log the landing. Do NOT auto-redirect to rally:// on page load:
  //  - on browsers without the app, most block cross-scheme navigation and
  //    leave the page in a blank/aborted state;
  //  - on browsers WITH the app, universal links handle the deep link
  //    directly (via associatedDomains / assetlinks) so we never even
  //    render this page.
  // The explicit "Open in Rally" button below is the user-initiated path.
  useEffect(() => {
    if (!tripId) return;
    capture(Events.TRIP_VIEWED, {
      source: 'universal_link',
      trip_id: tripId,
      platform: Platform.OS,
    });
  }, [tripId]);

  function handleGetApp() {
    capture(Events.DOWNLOAD_PROMPT_TAPPED, {
      page: 'trip_link',
      action: 'cta_tap',
      trip_id: tripId,
    });
    // Expo Router regenerates its path union on next build; cast via unknown.
    router.push(
      { pathname: '/download', params: { source: 'trip_link', trip: tripId ?? '' } } as unknown as Parameters<typeof router.push>[0],
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: CREAM }}
      contentContainerStyle={{
        flexGrow: 1,
        maxWidth: 520,
        alignSelf: 'center',
        width: '100%',
        paddingHorizontal: 24,
        paddingTop: Math.max(insets.top, 48),
        paddingBottom: 48,
        justifyContent: 'center',
      }}
    >
      {/* Brand mark */}
      <Text
        style={{
          fontFamily: HEADLINE_FONT,
          fontSize: 44,
          fontWeight: '700',
          color: GREEN,
          letterSpacing: -1,
          marginBottom: 32,
        }}
      >
        rally
      </Text>

      <Text
        style={{
          fontFamily: HEADLINE_FONT,
          fontSize: 40,
          fontWeight: '700',
          color: INK,
          letterSpacing: -0.6,
          lineHeight: 44,
          marginBottom: 14,
        }}
      >
        Your trip is waiting.
      </Text>
      <Text style={{ fontSize: 18, color: MUTED, lineHeight: 26, marginBottom: 32 }}>
        Tap below to open it in the Rally app. Don't have Rally yet? Skip the line and we'll get you in.
      </Text>

      {/* Open in app */}
      <Pressable
        onPress={() => {
          if (!tripId) return;
          Linking.openURL(`rally://trip/${tripId}`).catch(() => {});
          setDidAttemptDeepLink(true);
        }}
        style={{
          backgroundColor: GREEN,
          borderRadius: 12,
          paddingVertical: 16,
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <Ionicons name="open-outline" size={18} color="#FFFFFF" />
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>
          Open in Rally
        </Text>
      </Pressable>

      {/* Get the app */}
      <Pressable
        onPress={handleGetApp}
        style={{
          borderWidth: 1,
          borderColor: LINE,
          backgroundColor: CARD,
          borderRadius: 12,
          paddingVertical: 16,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: INK, fontSize: 16, fontWeight: '600' }}>
          I don't have Rally yet
        </Text>
      </Pressable>

      {didAttemptDeepLink ? (
        <Text
          style={{
            fontSize: 13,
            color: MUTED,
            marginTop: 24,
            textAlign: 'center',
          }}
        >
          Tried to open Rally. Nothing happened? Grab the app above.
        </Text>
      ) : null}
    </ScrollView>
  );
}
