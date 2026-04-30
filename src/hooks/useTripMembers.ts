/**
 * Hooks for planner-initiated member add/remove. Each one calls a
 * server-side edge function that mutates the row AND fires the
 * corresponding SMS (welcome or removal). On success, invalidates both
 * respondents and trip-session-participants caches so the list re-renders.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addTripMember,
  removeTripMember,
  type AddMemberResult,
  type RemoveMemberResult,
} from '@/lib/api/tripMembers';
import { respondentKeys } from './useRespondents';
import { tripSessionKeys } from './useTripSession';

export function useAddTripMember(tripId: string, sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<AddMemberResult, Error, { phone: string; name?: string | null }>({
    mutationFn: ({ phone, name }) => addTripMember(tripId, phone, name ?? null),
    onSuccess: (result) => {
      if (result.ok) {
        qc.invalidateQueries({ queryKey: respondentKeys.forTrip(tripId) });
        if (sessionId) {
          qc.invalidateQueries({ queryKey: tripSessionKeys.participants(sessionId) });
        }
      }
    },
  });
}

export function useRemoveTripMember(tripId: string, sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<RemoveMemberResult, Error, { phone: string }>({
    mutationFn: ({ phone }) => removeTripMember(tripId, phone),
    onSuccess: (result) => {
      if (result.ok) {
        qc.invalidateQueries({ queryKey: respondentKeys.forTrip(tripId) });
        if (sessionId) {
          qc.invalidateQueries({ queryKey: tripSessionKeys.participants(sessionId) });
        }
      }
    },
  });
}
