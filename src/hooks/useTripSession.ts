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
  getPlannerInbox,
  ackPlannerInboxMessage,
  ackPlannerInboxForTrip,
  getNudgeSchedule,
  sendNudgeNow,
  skipNextNudge,
  pauseParticipantNudges,
  getFailedDeliveryPhones,
} from '@/lib/api/dashboard';

export const tripSessionKeys = {
  forTrip: (tripId: string) => ['trip_session', tripId] as const,
  participants: (sessionId: string) => ['trip_session_participants', sessionId] as const,
  activity: (sessionId: string) => ['trip_session_activity', sessionId] as const,
  inbox: (sessionId: string) => ['planner_inbox', sessionId] as const,
  nudges: (sessionId: string) => ['nudge_schedule', sessionId] as const,
  failedDeliveries: (sessionId: string) => ['failed_deliveries', sessionId] as const,
};

export function useFailedDeliveryPhones(sessionId: string | undefined) {
  return useQuery({
    queryKey: tripSessionKeys.failedDeliveries(sessionId ?? ''),
    queryFn: () => getFailedDeliveryPhones(sessionId!),
    enabled: Boolean(sessionId),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}

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

/**
 * Inbound participant SMS that needs planner attention. Powers the
 * dashboard inbox card. Refetches on window focus so the planner sees
 * new replies as soon as they switch back to the app.
 */
export function usePlannerInbox(sessionId: string | undefined) {
  return useQuery({
    queryKey: tripSessionKeys.inbox(sessionId ?? ''),
    queryFn: () => getPlannerInbox(sessionId!),
    enabled: Boolean(sessionId),
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
}

/** Mark one inbox item as read. */
export function useAckPlannerInboxMessage(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => ackPlannerInboxMessage(messageId),
    onSuccess: () => {
      if (sessionId) qc.invalidateQueries({ queryKey: tripSessionKeys.inbox(sessionId) });
    },
  });
}

/** Mark every unread inbox item for this trip as acknowledged. */
export function useAckPlannerInboxForTrip(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => ackPlannerInboxForTrip(tripId),
    onSuccess: () => {
      if (sessionId) qc.invalidateQueries({ queryKey: tripSessionKeys.inbox(sessionId) });
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
