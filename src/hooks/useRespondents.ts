import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRespondentsForTrip,
  getRespondentsWithTravelInfo,
  getOrCreateRespondent,
  createRespondentManually,
  deleteRespondent,
  submitPollResponses,
  setPlannerForPhone,
} from '../lib/api/respondents';
import { tripSessionKeys } from './useTripSession';

export const respondentKeys = {
  forTrip: (tripId: string) => ['respondents', tripId] as const,
};

export function useRespondents(tripId: string) {
  return useQuery({
    queryKey: respondentKeys.forTrip(tripId),
    queryFn: () => getRespondentsForTrip(tripId),
    enabled: Boolean(tripId),
  });
}

export function useRespondentsWithTravelInfo(tripId: string) {
  return useQuery({
    queryKey: ['respondents', 'with-travel-info', tripId],
    queryFn: () => getRespondentsWithTravelInfo(tripId),
    enabled: Boolean(tripId),
    staleTime: 30_000,
  });
}

/**
 * Toggle planner status for a trip member by phone.
 *
 * Wraps the `set_planner_for_phone` RPC which keeps respondents and
 * trip_session_participants in sync. Invalidates both query caches so
 * the UI reflects the new state immediately. Pass `sessionId` so the
 * participant cache (keyed by session) gets refreshed too.
 */
export function useSetPlannerForPhone(tripId: string, sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ phone, isPlanner }: { phone: string; isPlanner: boolean }) =>
      setPlannerForPhone(tripId, phone, isPlanner),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: respondentKeys.forTrip(tripId) });
      if (sessionId) qc.invalidateQueries({ queryKey: tripSessionKeys.participants(sessionId) });
    },
  });
}

export function useDeleteRespondent(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (respondentId: string) => deleteRespondent(respondentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: respondentKeys.forTrip(tripId) }),
  });
}

export function useCreateRespondentManually(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, email, phone }: { name: string; email: string; phone: string }) =>
      createRespondentManually(tripId, name, email, phone),
    onSuccess: () => qc.invalidateQueries({ queryKey: respondentKeys.forTrip(tripId) }),
  });
}

export function useSubmitResponses(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      responses,
    }: {
      name: string;
      responses: { pollId: string; optionIds: string[] }[];
    }) => {
      const respondent = await getOrCreateRespondent(tripId, name);
      for (const r of responses) {
        await submitPollResponses(r.pollId, respondent.id, r.optionIds);
      }
      return respondent;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: respondentKeys.forTrip(tripId) });
    },
  });
}
