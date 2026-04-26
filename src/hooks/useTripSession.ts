/**
 * Hooks for the Group Dashboard (Phase 4 of 1:1 SMS pivot).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getActiveTripSession,
  getSessionParticipants,
  broadcastToSession,
  removeSessionParticipant,
  getSessionActivity,
} from '@/lib/api/dashboard';

export const tripSessionKeys = {
  forTrip: (tripId: string) => ['trip_session', tripId] as const,
  participants: (sessionId: string) => ['trip_session_participants', sessionId] as const,
  activity: (sessionId: string) => ['trip_session_activity', sessionId] as const,
};

/** Returns the most-recently-active trip_session for the given trip. */
export function useTripSession(tripId: string | undefined) {
  return useQuery({
    queryKey: tripSessionKeys.forTrip(tripId ?? ''),
    queryFn: () => getActiveTripSession(tripId!),
    enabled: Boolean(tripId),
    refetchOnWindowFocus: true,
  });
}

/** Roster for a trip_session. Sorted by joined_at (planner first via UI sort). */
export function useSessionParticipants(sessionId: string | undefined) {
  return useQuery({
    queryKey: tripSessionKeys.participants(sessionId ?? ''),
    queryFn: () => getSessionParticipants(sessionId!),
    enabled: Boolean(sessionId),
    refetchOnWindowFocus: true,
  });
}

/** Planner-authored broadcast. Invalidates the participant list on success. */
export function useBroadcastToSession(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => {
      if (!sessionId) return Promise.resolve({ ok: false, reason: 'no_session' as const });
      return broadcastToSession(sessionId, body);
    },
    onSuccess: () => {
      if (sessionId) {
        qc.invalidateQueries({ queryKey: tripSessionKeys.participants(sessionId) });
        qc.invalidateQueries({ queryKey: tripSessionKeys.activity(sessionId) });
      }
    },
  });
}

/** Activity feed: phase transitions + broadcasts + joins, merged + sorted. */
export function useSessionActivity(sessionId: string | undefined) {
  return useQuery({
    queryKey: tripSessionKeys.activity(sessionId ?? ''),
    queryFn: () => getSessionActivity(sessionId!),
    enabled: Boolean(sessionId),
    refetchOnWindowFocus: true,
  });
}

/** Soft-remove a participant. Mirror of useDeleteRespondent's contract. */
export function useRemoveSessionParticipant(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (participantId: string) => removeSessionParticipant(participantId),
    onSuccess: () => {
      if (sessionId) qc.invalidateQueries({ queryKey: tripSessionKeys.participants(sessionId) });
    },
  });
}
