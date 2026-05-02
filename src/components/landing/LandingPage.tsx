/**
 * Public marketing landing page.
 *
 * Rendered at `/` on web only. Native traffic still redirects to the
 * auth/app flow from `app/index.tsx` — landing is a public surface
 * for cold visitors arriving via SMS install CTAs, share links, or
 * future ad spend.
 *
 * Converted from `rally_landingpage_v1.html` by mirroring the layout
 * in React Native primitives so the same design renders consistently
 * with the rest of the app's brand system. Images are placeholder
 * cards (green-soft) — swap with real assets when available.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { T } from '@/theme';
import { EmailCapture } from './EmailCapture';

const HEADLINE_FONT = Platform.OS === 'android' ? 'serif' : 'Georgia';

// Brand tokens (T) sourced from src/theme/colors.ts. Layout-only colors
// (bubble, panelTop, highlight, etc.) are landing-page-specific tints
// of cream/cream-warm and stay local.
const C = {
  cream:        T.cream,
  cream2:       T.creamWarm,
  green:        T.green,
  green2:       T.greenDark,
  greenSoft:    T.greenSoft,
  ink:          T.ink,
  muted:        T.muted,
  line:         T.line,
  card:         T.card,
  gold:         T.gold,
  white:        T.white,
  // Landing-only decorative tints — derived from cream/cream-warm but
  // tuned per-section. If you need them elsewhere, promote them to T.
  bubble:       '#EFEADC',
  panelTop:     '#F4EDDC',
  highlight:    '#FFF2DF',
  itineraryDate:'#F5EEE0',
  pill:         '#F7E9C7',
};

const SHADOW = {
  sm: { shadowColor: '#111111', shadowOffset: { width: 0, height: 2 },  shadowOpacity: 0.05, shadowRadius: 8,  elevation: 1 },
  md: { shadowColor: '#111111', shadowOffset: { width: 0, height: 8 },  shadowOpacity: 0.08, shadowRadius: 24, elevation: 3 },
  lg: { shadowColor: '#111111', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.12, shadowRadius: 48, elevation: 6 },
};

interface LandingPageProps {
  /** True when the visitor is already authenticated — swap CTA to "Open Rally". */
  isSignedIn?: boolean;
  /**
   * When the visitor arrived via /t/<tripId> (a trip-specific install link),
   * pass the tripId here. The hero copy adapts ("See your trip in Rally")
   * and email signups attribute to the trip via beta_signups.trip_id.
   */
  tripId?: string;
  /**
   * Override the attribution tag stored in beta_signups.source.
   * Defaults: 'landing_page' for /, 'trip_link' when tripId is set.
   */
  source?: string;
}

export default function LandingPage({ isSignedIn = false, tripId, source }: LandingPageProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  // Allow attribution + trip context to be passed as URL query params too —
  // covers the /download → / redirect (preserves ?source=...&trip=...).
  const params = useLocalSearchParams<{ source?: string; trip?: string }>();
  const effectiveTripId = tripId ?? (typeof params.trip === 'string' ? params.trip : undefined);
  const isMobile = width < 900;
  const isTiny = width < 620;
  const isTripContext = !!effectiveTripId;
  const attribution =
    source ??
    (typeof params.source === 'string' ? params.source : undefined) ??
    (isTripContext ? 'trip_link' : 'landing_page');

  const goApp = () => router.push('/(app)/(tabs)' as Parameters<typeof router.push>[0]);
  const tryOpenInApp = () => {
    if (Platform.OS === 'web' && effectiveTripId) {
      // Try the deep link into the auth'd trip detail. If the app is
      // installed it opens; otherwise the user stays on this page with
      // the inline email form. Routes through the normal Expo Router
      // path so unauth'd users land at /login (the app handles that).
      window.location.href = `rally:///(app)/trips/${effectiveTripId}`;
    } else if (isSignedIn) {
      goApp();
    }
  };

  // Nav CTA: signed-in → "Open Rally" routes into the app; signed-out → smooth
  // scroll to the inline email form. (The email form is the conversion event;
  // no separate page to navigate to.)
  const navCta = isSignedIn
    ? { label: 'Open Rally', onPress: goApp }
    : isTripContext
    ? { label: 'Open in Rally', onPress: tryOpenInApp }
    : { label: 'Get early access', onPress: scrollToHeroEmailForm };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.cream }}>
      <Nav onPrimaryPress={navCta.onPress} primaryLabel={navCta.label} isMobile={isMobile} />
      <Hero
        isMobile={isMobile}
        isTiny={isTiny}
        tripId={effectiveTripId}
        source={attribution}
      />
      <Divider />
      <HowItWorks isMobile={isMobile} />
      <SplitSection isMobile={isMobile} />
      <MoneySection isMobile={isMobile} />
      <Testimonials isMobile={isMobile} />
      <FinalCTA tripId={effectiveTripId} source={attribution} />
    </ScrollView>
  );
}

function scrollToHeroEmailForm() {
  if (Platform.OS !== 'web') return;
  // The hero email field is the first input on the page.
  const el = document.querySelector('input[type=email]');
  if (el && 'scrollIntoView' in el) {
    (el as HTMLInputElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => (el as HTMLInputElement).focus(), 350);
  }
}

// ─── Container helper ────────────────────────────────────────────────────────

function Container({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View
      style={[
        {
          width: '100%',
          maxWidth: 1180,
          marginHorizontal: 'auto',
          paddingHorizontal: 24,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function Divider() {
  return <View style={{ borderTopWidth: 1, borderTopColor: C.line }} />;
}

// ─── Nav ─────────────────────────────────────────────────────────────────────

function Nav({
  onPrimaryPress,
  primaryLabel,
  isMobile,
}: {
  onPrimaryPress: () => void;
  primaryLabel: string;
  isMobile: boolean;
}) {
  return (
    <Container>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 24,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: isMobile ? 8 : 10 }}>
          <View
            style={{
              width: isMobile ? 14 : 16,
              height: isMobile ? 14 : 16,
              borderRadius: isMobile ? 7 : 8,
              backgroundColor: C.green,
            }}
          />
          <Text
            style={{
              fontFamily: HEADLINE_FONT,
              fontSize: isMobile ? 30 : 36,
              fontWeight: '700',
              lineHeight: isMobile ? 30 : 36,
              color: C.green,
              letterSpacing: 1,
            }}
          >
            RALLY
          </Text>
        </View>

        {!isMobile ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 32 }}>
            <NavLink label="How it works" />
            <NavLink label="Sample trip" />
            <NavLink label="Testimonials" />
            <PillButton onPress={onPrimaryPress} label={primaryLabel} />
          </View>
        ) : (
          <PillButton onPress={onPrimaryPress} label={primaryLabel} />
        )}
      </View>
    </Container>
  );
}

function NavLink({ label }: { label: string }) {
  return (
    <Text style={{ color: C.ink, fontSize: 15, fontWeight: '600' }}>{label}</Text>
  );
}

// ─── Pill button ─────────────────────────────────────────────────────────────

function PillButton({
  onPress,
  label,
  size = 'md',
}: {
  onPress: () => void;
  label: string;
  size?: 'md' | 'lg';
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        backgroundColor: pressed || hovered ? C.green2 : C.green,
        borderRadius: 999,
        paddingHorizontal: size === 'lg' ? 32 : 26,
        paddingVertical: size === 'lg' ? 18 : 15,
        ...SHADOW.sm,
        transform: [{ translateY: hovered ? -1 : 0 }],
      })}
    >
      <Text style={{ color: C.white, fontWeight: '700', fontSize: 15, letterSpacing: 0.2 }}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function Hero({
  isMobile,
  isTiny,
  tripId,
  source,
}: {
  isMobile: boolean;
  isTiny: boolean;
  tripId?: string;
  source: string;
}) {
  const heroH1Size = isTiny ? 48 : Math.min(76, Math.max(48, 60));
  const isTripContext = !!tripId;

  // Trip-context hero: foregrounds "your trip is in Rally" with a smaller pitch
  // recap below. Cold hero: standard pitch.
  const headline = isTripContext
    ? 'Your trip is in Rally.'
    : 'Plan the trip. Skip the chaos.';
  const subhead = isTripContext
    ? 'Drop your email and we\'ll get you in as soon as Rally opens up — your group\'s trip will be waiting.'
    : 'Rally handles the details so you don\'t have to.';

  return (
    <Container style={{ paddingTop: 18, paddingBottom: 64 }}>
      <View
        style={{
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? 34 : 56,
          alignItems: 'center',
        }}
      >
        {/* Left column: copy + email capture */}
        <View style={{ flex: isMobile ? undefined : 0.82, width: isMobile ? '100%' : undefined }}>
          <Text
            style={{
              fontFamily: HEADLINE_FONT,
              fontSize: heroH1Size,
              lineHeight: heroH1Size * 0.97,
              color: C.green,
              letterSpacing: -heroH1Size * 0.045,
              fontWeight: '700',
              maxWidth: 520,
            }}
          >
            {headline}
          </Text>
          <Text
            style={{
              marginTop: 22,
              color: C.muted,
              fontSize: isTiny ? 18 : 21,
              lineHeight: isTiny ? 26 : 30,
              maxWidth: 440,
            }}
          >
            {subhead}
          </Text>

          {/* Check list */}
          <View style={{ marginTop: 30, gap: 13 }}>
            {[
              'Capture key details upfront',
              'Split lodging and travel costs so no one fronts the bill',
              'Get itinerary recommendations tailored to your group',
            ].map((item) => (
              <View key={item} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    backgroundColor: C.green,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: 2,
                  }}
                >
                  <Ionicons name="checkmark" size={12} color={C.white} />
                </View>
                <Text style={{ flex: 1, color: C.ink, fontSize: 15, fontWeight: '600', lineHeight: 21 }}>
                  {item}
                </Text>
              </View>
            ))}
          </View>

          {/* Inline email capture — replaces the prior "Get early access" CTA */}
          <View style={{ marginTop: 30 }}>
            <EmailCapture
              source={source}
              tripId={tripId}
              variant="inline"
              caption={isTripContext
                ? 'We\'ll keep your trip linked to your account when you sign up.'
                : 'Be the first to plan with Rally'}
            />
          </View>
        </View>

        {/* Right column: hero image with location card */}
        <View
          style={{
            flex: isMobile ? undefined : 1.18,
            width: isMobile ? '100%' : undefined,
            position: 'relative',
            height: isTiny ? 360 : isMobile ? 420 : 490,
            borderRadius: 18,
            overflow: 'hidden',
            backgroundColor: C.greenSoft,
            ...SHADOW.md,
          }}
        >
          {/* Image placeholder — replace with real asset when available */}
          <PlaceholderImage label="Tulum group trip" />
          <View
            style={{
              position: 'absolute',
              right: 26,
              bottom: 26,
              backgroundColor: C.white,
              borderRadius: 18,
              paddingHorizontal: 20,
              paddingVertical: 17,
              minWidth: 190,
              ...SHADOW.md,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Ionicons name="location-outline" size={16} color={C.ink} />
              <Text style={{ color: C.ink, fontWeight: '700' }}>Tulum, Mexico</Text>
            </View>
            <Text style={{ color: C.muted }}>College Reunion Trip</Text>
          </View>
        </View>
      </View>
    </Container>
  );
}

function PlaceholderImage({ label }: { label: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.greenSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="image-outline" size={48} color={C.green} style={{ opacity: 0.35 }} />
      <Text style={{ color: C.green, opacity: 0.55, fontSize: 12, marginTop: 8, fontStyle: 'italic' }}>
        {label}
      </Text>
    </View>
  );
}

// ─── How it works ────────────────────────────────────────────────────────────

const STEPS: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; body: string }[] = [
  { icon: 'chatbubbles-outline', title: '1. You start the chat',         body: 'Add your group to Rally in any group chat.' },
  { icon: 'people-outline',      title: "2. We get everyone's input",     body: "Rally asks a few quick questions to understand everyone's preferences." },
  { icon: 'calendar-outline',    title: '3. You get the perfect plan',   body: 'Rally builds a trip plan and keeps everyone aligned.' },
  { icon: 'flash-outline',       title: '4. Your group gets to booking', body: 'Your group gets to booking within 48 hours — lock in early pricing on lodging and travel.' },
];

function HowItWorks({ isMobile }: { isMobile: boolean }) {
  return (
    <Container style={{ paddingVertical: 38 }}>
      <Text
        style={{
          fontFamily: HEADLINE_FONT,
          fontSize: isMobile ? 32 : 44,
          color: C.green,
          letterSpacing: -1.5,
          fontWeight: '700',
          textAlign: 'center',
          marginBottom: 28,
        }}
      >
        How Rally works
      </Text>
      <View
        style={{
          flexDirection: isMobile ? 'column' : 'row',
          gap: 0,
        }}
      >
        {STEPS.map((step, i) => (
          <View
            key={step.title}
            style={{
              flex: isMobile ? undefined : 1,
              flexDirection: 'row',
              gap: 18,
              padding: 22,
              borderRightWidth: !isMobile && i < STEPS.length - 1 ? 1 : 0,
              borderBottomWidth: isMobile && i < STEPS.length - 1 ? 1 : 0,
              borderColor: C.line,
            }}
          >
            <Ionicons name={step.icon} size={42} color={C.green} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink, marginBottom: 6 }}>
                {step.title}
              </Text>
              <Text style={{ fontSize: 15, color: C.muted, lineHeight: 21 }}>{step.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </Container>
  );
}

// ─── Split section: Gather input + Sample itinerary ──────────────────────────

function SplitSection({ isMobile }: { isMobile: boolean }) {
  return (
    <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line }}>
      <View style={{ flexDirection: isMobile ? 'column' : 'row' }}>
        <View
          style={{
            flex: isMobile ? undefined : 1,
            padding: 28,
            paddingBottom: 44,
            borderRightWidth: !isMobile ? 1 : 0,
            borderBottomWidth: isMobile ? 1 : 0,
            borderColor: C.line,
          }}
        >
          <GatherInputPanel />
        </View>
        <View
          style={{
            flex: isMobile ? undefined : 1.14,
            padding: 28,
            paddingBottom: 44,
          }}
        >
          <ItineraryPanel isMobile={isMobile} />
        </View>
      </View>
    </View>
  );
}

function GatherInputPanel() {
  return (
    <>
      <Text
        style={{
          fontFamily: HEADLINE_FONT,
          fontSize: 32,
          color: C.green,
          letterSpacing: -1,
          fontWeight: '700',
          textAlign: 'center',
          marginTop: 6,
        }}
      >
        Gather input without the group chat chaos
      </Text>
      <Text
        style={{
          marginTop: 8,
          marginBottom: 26,
          color: C.muted,
          textAlign: 'center',
          maxWidth: 520,
          alignSelf: 'center',
          fontSize: 16,
          lineHeight: 23,
        }}
      >
        Rally collects everyone's preferences in seconds.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View
            key={i}
            style={{
              width: '31.5%',
              height: 190,
              borderRadius: 12,
              backgroundColor: C.greenSoft,
              ...SHADOW.sm,
              overflow: 'hidden',
            }}
          >
            <PlaceholderImage label={`Group member ${i + 1}`} />
          </View>
        ))}
      </View>

      {/* Rally bubble */}
      <View
        style={{
          flexDirection: 'row',
          gap: 12,
          alignItems: 'flex-start',
          marginTop: 28,
          alignSelf: 'center',
          maxWidth: 460,
          width: '100%',
        }}
      >
        <View
          style={{
            width: 54,
            height: 54,
            borderRadius: 14,
            backgroundColor: C.greenSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: HEADLINE_FONT,
              fontSize: 28,
              fontStyle: 'italic',
              color: C.green,
              fontWeight: '700',
            }}
          >
            R
          </Text>
        </View>
        <View
          style={{
            flex: 1,
            borderRadius: 16,
            backgroundColor: C.bubble,
            paddingHorizontal: 18,
            paddingVertical: 16,
            ...SHADOW.sm,
          }}
        >
          <Text style={{ color: C.ink, fontSize: 15, lineHeight: 22 }}>
            Rally: Thanks! We've got responses from everyone.
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 }}>
            <Text style={{ color: C.muted, fontSize: 14 }}>6 of 6 people responded</Text>
            <Ionicons name="checkmark" size={14} color={C.green} />
          </View>
        </View>
      </View>
    </>
  );
}

function ItineraryPanel({ isMobile }: { isMobile: boolean }) {
  const [tab, setTab] = useState<'itinerary' | 'restaurants' | 'activities'>('itinerary');

  return (
    <>
      <Text
        style={{
          fontFamily: HEADLINE_FONT,
          fontSize: 32,
          color: C.green,
          letterSpacing: -1,
          fontWeight: '700',
          textAlign: 'center',
          marginTop: 6,
        }}
      >
        Get an itinerary everyone will love
      </Text>
      <Text
        style={{
          marginTop: 8,
          marginBottom: 26,
          color: C.muted,
          textAlign: 'center',
          maxWidth: 520,
          alignSelf: 'center',
          fontSize: 16,
          lineHeight: 23,
        }}
      >
        Personalized recommendations based on everyone's input.
      </Text>

      <View
        style={{
          backgroundColor: '#FFFAF4',
          borderWidth: 1,
          borderColor: C.line,
          borderRadius: 20,
          ...SHADOW.md,
          overflow: 'hidden',
        }}
      >
        {/* Top bar */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 16,
            paddingHorizontal: 20,
            backgroundColor: C.panelTop,
            borderBottomWidth: 1,
            borderColor: C.line,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, flex: 1 }}>
            <Ionicons name="shield-checkmark-outline" size={18} color={C.green} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: C.ink }}>
                Powered by your group's preferences
              </Text>
              <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                6 of 6 people's input included
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <View
                key={i}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  borderWidth: 2,
                  borderColor: C.panelTop,
                  marginLeft: i === 0 ? 0 : -7,
                  backgroundColor: C.greenSoft,
                }}
              />
            ))}
          </View>
        </View>

        {/* Body */}
        <View
          style={{
            flexDirection: isMobile ? 'column' : 'row',
            gap: 18,
            padding: 22,
          }}
        >
          {/* Trip + tabs + timeline */}
          <View style={{ flex: isMobile ? undefined : 1 }}>
            <Text style={{ color: C.ink, fontSize: 22, fontWeight: '700' }}>Tulum, Mexico</Text>
            <Text style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>May 16 – May 20, 2025</Text>

            {/* Tabs */}
            <View
              style={{
                flexDirection: 'row',
                gap: 24,
                marginTop: 22,
                marginBottom: 14,
                borderBottomWidth: 1,
                borderColor: C.line,
              }}
            >
              {(['itinerary', 'restaurants', 'activities'] as const).map((id) => {
                const active = tab === id;
                return (
                  <Pressable key={id} onPress={() => setTab(id)} style={{ paddingBottom: 10 }}>
                    <Text
                      style={{
                        color: active ? C.ink : C.muted,
                        fontSize: 13,
                        fontWeight: active ? '700' : '400',
                        borderBottomWidth: active ? 2 : 0,
                        borderColor: C.green,
                        paddingBottom: 8,
                        textTransform: 'capitalize',
                      }}
                    >
                      {id}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Timeline rows={TIMELINES[tab]} />
          </View>

          {/* Recommendations sidebar */}
          {!isMobile ? (
            <View
              style={{
                width: 250,
                backgroundColor: C.itineraryDate,
                borderRadius: 16,
                padding: 18,
              }}
            >
              <RecommendationsList
                title="Top Restaurants"
                items={[
                  { primary: 'Gitano Tulum',     secondary: 'Dinner + cocktails' },
                  { primary: 'Arca',             secondary: 'Chef-driven group dinner' },
                  { primary: 'Taquería Honorio', secondary: 'Casual tacos' },
                  { primary: 'Hartwood',         secondary: 'Celebration dinner' },
                ]}
                ordered
              />
              <View style={{ height: 18 }} />
              <RecommendationsList
                title="Top Activities"
                items={[
                  { primary: 'Cenote Dos Ojos', secondary: 'Adventure + swimming' },
                  { primary: 'ATV Jungle Tour', secondary: 'For the high-energy crew' },
                  { primary: 'Tulum Ruins',     secondary: 'Culture + views' },
                  { primary: 'Papaya Playa',    secondary: 'Beach club downtime' },
                ]}
              />
            </View>
          ) : null}
        </View>

        {/* Why this itinerary */}
        <View
          style={{
            marginHorizontal: 22,
            marginBottom: 22,
            borderRadius: 16,
            backgroundColor: C.highlight,
            padding: 18,
          }}
        >
          <Text style={{ fontWeight: '700', color: C.ink, marginBottom: 14 }}>
            Why this itinerary works for your group
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {[
              { icon: 'star-outline',       label: 'Adventure',    count: '4 people' },
              { icon: 'water-outline',      label: 'Relaxation',   count: '5 people' },
              { icon: 'restaurant-outline', label: 'Food & Drink', count: '6 people' },
              { icon: 'wine-outline',       label: 'Nightlife',    count: '3 people' },
              { icon: 'business-outline',   label: 'Culture',      count: '4 people' },
            ].map((p) => (
              <View key={p.label} style={{ width: isMobile ? '47%' : '18%' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <Ionicons
                    name={p.icon as React.ComponentProps<typeof Ionicons>['name']}
                    size={14}
                    color={C.ink}
                  />
                  <Text style={{ color: C.ink, fontSize: 13, fontWeight: '700' }}>{p.label}</Text>
                </View>
                <Text style={{ color: C.muted, fontSize: 12 }}>{p.count}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </>
  );
}

const TIMELINES = {
  itinerary: [
    { date: 'FRI\nMay 16', title: 'Arrival & settle in',  body: 'Check-in, beach time, welcome dinner at Hartwood' },
    { date: 'SAT\nMay 17', title: 'Explore & adventure',  body: 'Cenote Dos Ojos, ATV jungle tour, sunset at Papaya Playa' },
    { date: 'SUN\nMay 18', title: 'Relax & recharge',     body: 'Beach morning, spa, group dinner at Arca' },
    { date: 'MON\nMay 19', title: 'Culture & night out',  body: 'Tulum ruins, Gitano cocktails, late dinner' },
    { date: 'TUE\nMay 20', title: 'Farewell',             body: 'Brunch at Botanica Garden Cafe and goodbyes' },
  ],
  restaurants: [
    { date: 'FRI', title: 'Hartwood',          body: 'Open-air, wood-fired dinner. Best for a celebratory first-night group meal.' },
    { date: 'SUN', title: 'Arca',              body: 'Chef-driven dinner with shareable plates. Great match for the food-focused people in the group.' },
    { date: 'MON', title: 'Gitano Tulum',      body: 'Cocktails, music, and dinner energy for the nightlife crew.' },
    { date: 'ANY', title: 'Taquería Honorio',  body: 'Casual local favorite for tacos and an easy low-key lunch.' },
  ],
  activities: [
    { date: 'SAT', title: 'Cenote Dos Ojos',         body: 'Swim and snorkel in clear cenote water. Good for adventure + nature preferences.' },
    { date: 'SAT', title: 'ATV Jungle Tour',         body: 'Optional higher-energy activity for the group members who wanted adventure.' },
    { date: 'MON', title: 'Tulum Ruins',             body: 'Short cultural stop with ocean views; easy to pair with beach time.' },
    { date: 'SUN', title: 'Papaya Playa Beach Club', body: 'Relaxed beach club afternoon for the people who prioritized downtime.' },
  ],
} as const;

function Timeline({ rows }: { rows: ReadonlyArray<{ date: string; title: string; body: string }> }) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: C.line,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: C.white,
      }}
    >
      {rows.map((r, i) => (
        <View
          key={`${r.date}-${r.title}`}
          style={{
            flexDirection: 'row',
            borderBottomWidth: i < rows.length - 1 ? 1 : 0,
            borderColor: C.line,
          }}
        >
          <View
            style={{
              width: 72,
              backgroundColor: C.itineraryDate,
              padding: 14,
              paddingHorizontal: 12,
            }}
          >
            <Text style={{ color: C.muted, fontSize: 13, fontWeight: '700' }}>{r.date}</Text>
          </View>
          <View style={{ flex: 1, padding: 14, paddingHorizontal: 16 }}>
            <Text style={{ color: C.ink, fontWeight: '700', marginBottom: 4 }}>{r.title}</Text>
            <Text style={{ color: C.muted, fontSize: 14, lineHeight: 20 }}>{r.body}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function RecommendationsList({
  title,
  items,
  ordered = false,
}: {
  title: string;
  items: { primary: string; secondary: string }[];
  ordered?: boolean;
}) {
  return (
    <>
      <Text style={{ color: C.ink, fontSize: 15, fontWeight: '700', marginBottom: 12 }}>{title}</Text>
      {items.map((item, i) => (
        <View key={item.primary} style={{ flexDirection: 'row', marginBottom: 8, gap: 6 }}>
          <Text style={{ color: C.ink, fontSize: 13, lineHeight: 18, width: 14 }}>
            {ordered ? `${i + 1}.` : '•'}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.ink, fontSize: 13, fontWeight: '700', lineHeight: 18 }}>
              {item.primary}
            </Text>
            <Text style={{ color: C.muted, fontSize: 12, lineHeight: 16 }}>{item.secondary}</Text>
          </View>
        </View>
      ))}
    </>
  );
}

// ─── Money section ───────────────────────────────────────────────────────────

function MoneySection({ isMobile }: { isMobile: boolean }) {
  return (
    <View style={{ backgroundColor: C.green, paddingVertical: 68 }}>
      <Container>
        <View
          style={{
            flexDirection: isMobile ? 'column' : 'row',
            gap: 42,
            alignItems: 'center',
          }}
        >
          <View style={{ flex: isMobile ? undefined : 0.9, width: isMobile ? '100%' : undefined }}>
            <Text
              style={{
                fontFamily: HEADLINE_FONT,
                color: C.white,
                fontSize: isMobile ? 36 : 50,
                fontWeight: '700',
                letterSpacing: -2,
                lineHeight: isMobile ? 38 : 52,
              }}
            >
              Split costs so no one fronts the bill
            </Text>
            <Text
              style={{
                color: 'rgba(255,255,255,0.78)',
                fontSize: 18,
                lineHeight: 26,
                marginTop: 18,
              }}
            >
              Rally helps your group share lodging, travel, and big upfront costs so the planner isn't carrying the financial risk alone.
            </Text>
          </View>

          <View
            style={{
              flex: isMobile ? undefined : 1.1,
              width: isMobile ? '100%' : undefined,
              backgroundColor: '#FFFAF4',
              borderRadius: 24,
              padding: 22,
              ...SHADOW.lg,
            }}
          >
            <Text style={{ color: C.ink, fontWeight: '700', fontSize: 17, marginBottom: 12 }}>
              Tulum Airbnb
            </Text>
            <SplitRow label="Total lodging" value="$3,600" />
            <SplitRow label="People included" value="6" />
            <SplitRow label="Per person" value="$600" />
            <SplitRow label="Status" value="4 of 6 paid" last />
          </View>
        </View>
      </Container>
    </View>
  );
}

function SplitRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 13,
        borderBottomWidth: last ? 0 : 1,
        borderColor: C.line,
      }}
    >
      <Text style={{ color: C.muted }}>{label}</Text>
      <Text style={{ color: C.ink, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

// ─── Testimonials ────────────────────────────────────────────────────────────

const TESTIMONIALS = [
  {
    name:  'Emily',
    role:  'Planned a 9-person birthday trip to Tulum',
    quote: '"Rally saved me so much time and made planning our birthday trip actually fun. Everyone was organized and loved the itinerary."',
    pill:  '3–4 hours saved',
  },
  {
    name:  'Jake',
    role:  'Planned a 12-person bachelor party in Miami',
    quote: '"I had our bachelor party booked in 48 hours. Rally made it easy to get everyone on board and lock in the details."',
    pill:  'Trip booked in 48 hours',
  },
  {
    name:  'Priya',
    role:  'Planned a 12-person MBA trip to Whistler',
    quote: '"Coordinating 12 MBAs across different schedules was a nightmare—Rally made it seamless."',
    pill:  '12 people coordinated',
  },
];

function Testimonials({ isMobile }: { isMobile: boolean }) {
  return (
    <Container style={{ paddingTop: 56, paddingBottom: 46 }}>
      <Text
        style={{
          fontFamily: HEADLINE_FONT,
          fontSize: 34,
          color: C.green,
          letterSpacing: -1,
          fontWeight: '700',
          textAlign: 'center',
        }}
      >
        Loved by trip planners
      </Text>
      <Text
        style={{
          marginTop: 8,
          marginBottom: 26,
          color: C.muted,
          textAlign: 'center',
          fontSize: 16,
        }}
      >
        Planners save 3–4 hours on average with Rally.
      </Text>
      <View style={{ flexDirection: isMobile ? 'column' : 'row', gap: 24 }}>
        {TESTIMONIALS.map((t) => (
          <View
            key={t.name}
            style={{
              flex: isMobile ? undefined : 1,
              flexDirection: isMobile ? 'column' : 'row',
              borderWidth: 1,
              borderColor: C.line,
              borderRadius: 18,
              backgroundColor: '#FFFAF4',
              ...SHADOW.sm,
              overflow: 'hidden',
              minHeight: 226,
            }}
          >
            <View
              style={{
                flex: isMobile ? undefined : 0.9,
                width: isMobile ? '100%' : undefined,
                minHeight: 226,
                backgroundColor: C.greenSoft,
              }}
            >
              <PlaceholderImage label={`${t.name}'s photo`} />
            </View>
            <View style={{ flex: isMobile ? undefined : 1, padding: 20 }}>
              <Text style={{ color: C.ink, fontSize: 14, lineHeight: 22 }}>{t.quote}</Text>
              <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16, marginTop: 18 }}>
                {t.name}
              </Text>
              <Text style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>{t.role}</Text>
              <View
                style={{
                  alignSelf: 'flex-start',
                  marginTop: 18,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: C.pill,
                }}
              >
                <Text style={{ color: C.ink, fontSize: 13, fontWeight: '800' }}>{t.pill}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </Container>
  );
}

// ─── Final CTA ───────────────────────────────────────────────────────────────

function FinalCTA({ tripId, source }: { tripId?: string; source: string }) {
  return (
    <Container style={{ paddingTop: 36, paddingBottom: 64, alignItems: 'center' }}>
      <Text
        style={{
          fontFamily: HEADLINE_FONT,
          fontSize: 44,
          color: C.green,
          letterSpacing: -1.5,
          fontWeight: '700',
          textAlign: 'center',
          marginTop: 0,
        }}
      >
        Your best trip starts with Rally
      </Text>
      <Text style={{ marginTop: 10, marginBottom: 28, color: C.muted, fontSize: 18, textAlign: 'center' }}>
        Less stress. More memories.
      </Text>
      <EmailCapture source={source} tripId={tripId} variant="inline" />
    </Container>
  );
}
