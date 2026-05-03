/**
 * Hooks for planner-initiated member add/remove. Each one calls a
 * server-side edge function that mutates the row AND fires the
 * corresponding SMS (welcome or removal). On success, invalidates the
 * respondent + participant caches AND the trip-list query keys so the
 * "X people / X declined" pills on the home card and trip-detail hero
 * refresh the moment the roster changes.
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  addTripMember,
  removeTripMember,
  type AddMemberResult,
  type RemoveMemberResult,
} from '@/lib/api/tripMembers';
import { pokeNudgeScheduler } from '@/lib/api/trips';
import { respondentKeys } from './useRespondents';
import { tripSessionKeys } from './useTripSession';
import { tripKeys } from './useTrips';

function invalidateRosterDownstream(
  qc: QueryClient,
  tripId: string,
  sessionId: string | undefined,
) {
  qc.invalidateQueries({ queryKey: respondentKeys.forTrip(tripId) });
  if (sessionId) {
    qc.invalidateQueries({ queryKey: tripSessionKeys.participants(sessionId) });
    // member-add server-side now seeds the new member's full nudge
    // cadence inline (instead of waiting for the next 15-min scheduler
    // tick), so the rows already exist by the time this callback fires.
    // Refresh the schedule card so they appear without waiting for the
    // 60s background refetch. Mirrored on remove so freshly-skipped
    // pendings drop from the schedule promptly too.
    qc.invalidateQueries({ queryKey: tripSessionKeys.nudges(sessionId) });
  }
  // Trip card pills derive from embedded participants/respondents on
  // getTripsWithRespondentCounts; refetch so they update without a manual
  // pull-to-refresh.
  qc.invalidateQueries({ queryKey: tripKeys.allWithCounts });
  qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
}

export function useAddTripMember(tripId: string, sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<AddMemberResult, Error, { phone: string; name?: string | null }>({
    mutationFn: ({ phone, name }) => addTripMember(tripId, phone, name ?? null),
    onSuccess: (result) => {
      if (result.ok) {
        invalidateRosterDownstream(qc, tripId, sessionId);
        // Kick the scheduler so the new participant's cadence rows are
        // seeded immediately. Without this poke they'd wait up to 15
        // minutes for the next cron tick before any nudges get scheduled.
        pokeNudgeScheduler();
      }
    },
  });
}

export function useRemoveTripMember(tripId: string, sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<RemoveMemberResult, Error, { phone: string }>({
    mutationFn: ({ phone }) => removeTripMember(tripId, phone),
    onSuccess: (result) => {
      if (result.ok) invalidateRosterDownstream(qc, tripId, sessionId);
    },
  });
}
