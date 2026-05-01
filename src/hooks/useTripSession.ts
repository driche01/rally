/**
 * Hooks for the trip-session SMS state (Phase 4 of 1:1 SMS pivot, with
 * Phase 15 cleanup): the activity timeline, planner inbox, and
 * failed-delivery hooks were retired when the Members screen was
 * replaced by the Activity log.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getActiveTripSession,
  getSessionParticipants,
  broadcastToSession,
  removeSessionParticipant,
  getNudgeSchedule,
  sendNudgeNow,
  skipNextNudge,
  pauseParticipantNudges,
} from '@/lib/api/dashboard';

export const tripSessionKeys = {
  forTrip: (tripId: string) => ['trip_session', tripId] as const,
  participants: (sessionId: string) => ['trip_session_participants', sessionId] as const,
  nudges: (sessionId: string) => ['nudge_schedule', sessionId] as const,
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
      }
    },
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

// ─── Nudge schedule (cadence card) ─────────────────────────────────────────

export function useNudgeSchedule(sessionId: string | undefined) {
  return useQuery({
    queryKey: tripSessionKeys.nudges(sessionId ?? ''),
    queryFn: () => getNudgeSchedule(sessionId!),
    enabled: Boolean(sessionId),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}

export function useSendNudgeNow(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (participantId?: string | null) =>
      sessionId ? sendNudgeNow(sessionId, participantId ?? null)
                : Promise.resolve({ ok: false, reason: 'no_session' as const }),
    onSuccess: () => {
      if (sessionId) qc.invalidateQueries({ queryKey: tripSessionKeys.nudges(sessionId) });
    },
  });
}

export function useSkipNextNudge(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (participantId?: string | null) =>
      sessionId ? skipNextNudge(sessionId, participantId ?? null)
                : Promise.resolve({ ok: false, reason: 'no_session' as const }),
    onSuccess: () => {
      if (sessionId) qc.invalidateQueries({ queryKey: tripSessionKeys.nudges(sessionId) });
    },
  });
}

export function usePauseParticipantNudges(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (participantId: string) =>
      sessionId ? pauseParticipantNudges(sessionId, participantId)
                : Promise.resolve({ ok: false, reason: 'no_session' as const }),
    onSuccess: () => {
      if (sessionId) qc.invalidateQueries({ queryKey: tripSessionKeys.nudges(sessionId) });
    },
  });
}
