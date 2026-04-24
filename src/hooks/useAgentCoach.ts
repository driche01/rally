/**
 * React Query hooks for the Planner AI Coach (F2).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  generateAgentMessage,
  getAgentSettings,
  getNudges,
  getRecentNudgeLogs,
  logNudgeMessage,
  markNudgeSent,
  upsertAgentSettings,
  type NudgeScenario,
} from '@/lib/api/agentCoach';

export type { NudgeScenario };

// ─── Query keys ────────────────────────────────────────────────────────────────

export const agentCoachKeys = {
  nudges:   (tripId: string) => ['agent-coach', 'nudges', tripId] as const,
  settings: (tripId: string) => ['agent-coach', 'settings', tripId] as const,
  log:      (tripId: string) => ['agent-coach', 'log', tripId] as const,
};

// ─── Nudges ────────────────────────────────────────────────────────────────────

export function useNudges(tripId: string, enabled = true) {
  return useQuery({
    queryKey: agentCoachKeys.nudges(tripId),
    queryFn: () => getNudges(tripId),
    enabled: enabled && !!tripId,
    staleTime: 60 * 1000,        // re-fetch every 1 min
    retry: 1,
  });
}

// ─── Agent message generation ─────────────────────────────────────────────────

export function useGenerateAgentMessage(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ scenario }: { scenario: NudgeScenario }) =>
      generateAgentMessage(tripId, scenario),
    onSuccess: async (message, { scenario }) => {
      // Persist to nudge log so we can show "last sent" state
      await logNudgeMessage(tripId, scenario, message);
      qc.invalidateQueries({ queryKey: agentCoachKeys.log(tripId) });
    },
  });
}

// ─── Agent settings ────────────────────────────────────────────────────────────

export function useAgentSettings(tripId: string) {
  return useQuery({
    queryKey: agentCoachKeys.settings(tripId),
    queryFn: () => getAgentSettings(tripId),
    enabled: !!tripId,
  });
}

export function useUpsertAgentSettings(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (autoRemind: boolean) => upsertAgentSettings(tripId, autoRemind),
    onMutate: async (autoRemind) => {
      // Optimistic update
      await qc.cancelQueries({ queryKey: agentCoachKeys.settings(tripId) });
      const prev = qc.getQueryData(agentCoachKeys.settings(tripId));
      qc.setQueryData(agentCoachKeys.settings(tripId), (old: { auto_remind: boolean } | null) =>
        old ? { ...old, auto_remind: autoRemind } : { trip_id: tripId, auto_remind: autoRemind }
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      qc.setQueryData(agentCoachKeys.settings(tripId), ctx?.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: agentCoachKeys.settings(tripId) });
    },
  });
}

// ─── Nudge log ─────────────────────────────────────────────────────────────────

export function useNudgeLogs(tripId: string) {
  return useQuery({
    queryKey: agentCoachKeys.log(tripId),
    queryFn: () => getRecentNudgeLogs(tripId),
    enabled: !!tripId,
  });
}

export function useMarkNudgeSent(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nudgeLogId: string) => markNudgeSent(nudgeLogId),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentCoachKeys.log(tripId) }),
  });
}
