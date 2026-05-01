/**
 * Universal-link trip route — `/t/<tripId>`
 *
 * Job:
 *   - Native + signed-in planner/member: redirect to the in-app trip
 *     dashboard at `/(app)/trips/<tripId>` so deep-linked SMS prompts
 *     (e.g. "review and lock the trip") land the planner exactly where
 *     they need to be.
 *   - Native + not signed in (or web): render the public landing page in
 *     trip-context mode — same layout as `/`, but the hero foregrounds the
 *     user's trip and email signups attribute to `beta_signups.trip_id`.
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Platform } from 'react-native';
import LandingPage from '@/components/landing/LandingPage';
import { capture, Events } from '@/lib/analytics';
import { useAuthStore } from '@/stores/authStore';

export default function TripUniversalLink() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    if (!tripId) return;
    capture(Events.TRIP_VIEWED, {
      source: 'universal_link',
      trip_id: tripId,
      platform: Platform.OS,
    });
  }, [tripId]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!tripId || !session) return;
    router.replace(`/(app)/trips/${tripId}` as Parameters<typeof router.replace>[0]);
  }, [tripId, session, router]);

  return <LandingPage tripId={tripId} source="trip_link" />;
}
