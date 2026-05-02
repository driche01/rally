/**
 * Trip-detail prefetcher — call this from the TripCard tap handler so the
 * dashboard's three loading-prone cards (Cadence/Nudge, Live results, Group
 * preferences) render with data already in the React Query cache instead
 * of flashing their own loading states.
 *
 * Strategy: kick off the trip-session fetch; once that resolves, fan out
 * in parallel to the session-scoped queries (nudges, group profiles) and
 * the trip-scoped poll-counts queries. All errors are swallowed — this
 * runs as a background warm-up and the cards still own real fetching as a
 * fallback if the prefetch hasn't completed by the time they mount.
 */
import type { QueryClient } from '@tanstack/react-query';
import {
  getActiveTripSession,
  getNudgeSchedule,
  getSessionParticipants,
} from '@/lib/api/dashboard';
import { getProfilesForTripSession } from '@/lib/api/travelerProfiles';
import { getPollsForTrip } from '@/lib/api/polls';
import {
  getResponseCountsForTrip,
  getNumericResponseCountsForTrip,
  getRespondentCountsForTrip,
  getAlignedVoteCountsForTrip,
} from '@/lib/api/responses';
import { tripSessionKeys } from '@/hooks/useTripSession';
import { groupProfilesKey } from '@/components/trips/GroupPreferencesCard';

export async function prefetchTripDetail(qc: QueryClient, tripId: string): Promise<void> {
  if (!tripId) return;

  // Trip-scoped queries can fire immediately; session-scoped ones wait
  // on the session id. Run both halves in parallel so the user's network
  // round-trips overlap with the screen transition.
  const tripScoped = Promise.allSettled([
    qc.prefetchQuery({
      queryKey: ['polls', tripId, 'aggregate'],
      queryFn: () => getPollsForTrip(tripId),
    }),
    qc.prefetchQuery({
      queryKey: ['poll_counts', tripId],
      queryFn: () => getResponseCountsForTrip(tripId),
    }),
    qc.prefetchQuery({
      queryKey: ['poll_numeric_counts', tripId],
      queryFn: () => getNumericResponseCountsForTrip(tripId),
    }),
    qc.prefetchQuery({
      queryKey: ['poll_respondent_counts', tripId],
      queryFn: () => getRespondentCountsForTrip(tripId),
    }),
    qc.prefetchQuery({
      queryKey: ['poll_aligned_counts', tripId],
      queryFn: () => getAlignedVoteCountsForTrip(tripId),
    }),
  ]);

  const sessionScoped = (async () => {
    try {
      // fetchQuery (vs prefetchQuery) returns the result so we can chain
      // session-id-dependent prefetches off it.
      const session = await qc.fetchQuery({
        queryKey: tripSessionKeys.forTrip(tripId),
        queryFn: () => getActiveTripSession(tripId),
      });
      if (!session?.id) return;
      const sid = session.id;
      await Promise.allSettled([
        qc.prefetchQuery({
          queryKey: tripSessionKeys.nudges(sid),
          queryFn: () => getNudgeSchedule(sid),
        }),
        qc.prefetchQuery({
          queryKey: tripSessionKeys.participants(sid),
          queryFn: () => getSessionParticipants(sid),
        }),
        qc.prefetchQuery({
          queryKey: groupProfilesKey(sid),
          queryFn: () => getProfilesForTripSession(sid),
        }),
      ]);
    } catch {
      // best-effort warm-up
    }
  })();

  await Promise.allSettled([tripScoped, sessionScoped]);
}
