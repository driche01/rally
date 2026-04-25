/**
 * Universal-link trip route — `/t/<tripId>`
 *
 * Job:
 *   - Native (iOS/Android with the app installed): never renders. Universal
 *     links route directly into the in-app trip detail via `associatedDomains`
 *     in app.json.
 *   - Web (without the app): renders the public landing page in trip-context
 *     mode — same layout as `/`, but the hero foregrounds the user's trip
 *     and email signups attribute to `beta_signups.trip_id`.
 *
 * Previous standalone "Your trip is waiting / I don't have Rally yet"
 * interstitial was removed in favor of this contextual landing — fewer
 * clicks, trip context preserved through to signup.
 */
import { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Platform } from 'react-native';
import LandingPage from '@/components/landing/LandingPage';
import { capture, Events } from '@/lib/analytics';

export default function TripUniversalLink() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  useEffect(() => {
    if (!tripId) return;
    capture(Events.TRIP_VIEWED, {
      source: 'universal_link',
      trip_id: tripId,
      platform: Platform.OS,
    });
  }, [tripId]);

  return <LandingPage tripId={tripId} source="trip_link" />;
}
