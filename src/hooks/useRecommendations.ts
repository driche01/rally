/**
 * Hooks for the dashboard decision queue.
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPendingRecommendations,
  requestRecommendation,
  approveRecommendation,
  approveRecommendationWithDates,
  holdRecommendation,
  undoPollLock,
} from '@/lib/api/recommendations';
import { getPollsForTrip } from '@/lib/api/polls';
import { tripKeys } from './useTrips';
import type { PollRecommendation } from '@/lib/api/recommendations';

export const recommendationKeys = {
  forTrip: (tripId: string) => ['poll_recommendations', tripId] as const,
};

export function usePendingRecommendations(tripId: string | undefined) {
  return useQuery({
    queryKey: recommendationKeys.forTrip(tripId ?? ''),
    queryFn: () => getPendingRecommendations(tripId!),
    enabled: Boolean(tripId),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}

export function useRequestRecommendation(tripId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pollId: string) => requestRecommendation(pollId),
    onSuccess: () => {
      if (tripId) qc.invalidateQueries({ queryKey: recommendationKeys.forTrip(tripId) });
    },
  });
}

export function useApproveRecommendation(tripId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recommendationId, overrideOptionId }: {
      recommendationId: string; overrideOptionId?: string | null;
    }) => approveRecommendation(recommendationId, overrideOptionId ?? null),
    // Optimistic flip: stamp the rec as approved + set planner_action_at
    // before the network roundtrip resolves, so the dashboard's "Just
    // locked · Undo within 5 min" treatment shows up the same frame the
    // user taps Lock in. Server response then confirms or rolls back.
    onMutate: async ({ recommendationId, overrideOptionId }) => {
      if (!tripId) return { previous: undefined };
      await qc.cancelQueries({ queryKey: recommendationKeys.forTrip(tripId) });
      const previous = qc.getQueryData<PollRecommendation[]>(
        recommendationKeys.forTrip(tripId),
      );
      if (previous) {
        const now = new Date().toISOString();
        qc.setQueryData<PollRecommendation[]>(
          recommendationKeys.forTrip(tripId),
          previous.map((r) =>
            r.id === recommendationId
              ? {
                  ...r,
                  status: overrideOptionId ? 'edited' : 'approved',
                  planner_action_at: now,
                  recommended_option_id: overrideOptionId ?? r.recommended_option_id,
                }
              : r,
          ),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (tripId && ctx?.previous) {
        qc.setQueryData(recommendationKeys.forTrip(tripId), ctx.previous);
      }
    },
    onSettled: () => {
      if (tripId) {
        qc.invalidateQueries({ queryKey: recommendationKeys.forTrip(tripId) });
        qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
        qc.invalidateQueries({ queryKey: ['polls', tripId] });
      }
    },
  });
}

/**
 * Approve a dates-poll recommendation with a planner-picked array of
 * ISO dates. Locks the poll + writes trips.start_date/end_date.
 */
export function useApproveRecommendationWithDates(tripId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recommendationId, dates }: {
      recommendationId: string; dates: string[];
    }) => approveRecommendationWithDates(recommendationId, dates),
    onMutate: async ({ recommendationId }) => {
      if (!tripId) return { previous: undefined };
      await qc.cancelQueries({ queryKey: recommendationKeys.forTrip(tripId) });
      const previous = qc.getQueryData<PollRecommendation[]>(
        recommendationKeys.forTrip(tripId),
      );
      if (previous) {
        const now = new Date().toISOString();
        qc.setQueryData<PollRecommendation[]>(
          recommendationKeys.forTrip(tripId),
          previous.map((r) =>
            r.id === recommendationId
              ? { ...r, status: 'edited', planner_action_at: now }
              : r,
          ),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (tripId && ctx?.previous) {
        qc.setQueryData(recommendationKeys.forTrip(tripId), ctx.previous);
      }
    },
    onSettled: () => {
      if (tripId) {
        qc.invalidateQueries({ queryKey: recommendationKeys.forTrip(tripId) });
        qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
        qc.invalidateQueries({ queryKey: ['polls', tripId] });
      }
    },
  });
}

/**
 * Undo a recently-approved lock (5-min grace window). Refetches the
 * decision queue so the recommendation flips back to pending in the UI.
 */
export function useUndoPollLock(tripId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recommendationId: string) => undoPollLock(recommendationId),
    onSuccess: () => {
      if (tripId) {
        qc.invalidateQueries({ queryKey: recommendationKeys.forTrip(tripId) });
        qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
        qc.invalidateQueries({ queryKey: ['polls', tripId] });
      }
    },
  });
}

/**
 * On dashboard mount, ensure every still-live poll has a pending
 * recommendation. The RPC is idempotent (returns "existed" when a row
 * already exists), so calling it for every undecided poll is a cheap
 * no-op when recs are already there. Closes the gap between the cron
 * scheduler's 15-min tick and the planner opening the trip — recs show
 * up immediately on dashboard load instead of waiting on the next tick.
 */
export function useAutoGenerateRecommendations(tripId: string | undefined) {
  const qc = useQueryClient();
  const ranForTrip = useRef<string | null>(null);

  // Load polls + current pending recs so we know what's missing.
  const { data: polls } = useQuery({
    queryKey: ['polls', tripId, 'auto_rec'],
    queryFn: () => getPollsForTrip(tripId!),
    enabled: Boolean(tripId),
    staleTime: 30_000,
  });
  const { data: recs } = useQuery({
    queryKey: recommendationKeys.forTrip(tripId ?? ''),
    queryFn: () => getPendingRecommendations(tripId!),
    enabled: Boolean(tripId),
  });

  useEffect(() => {
    if (!tripId || !polls || !recs) return;
    if (ranForTrip.current === tripId) return; // once per trip per session

    const livePolls = polls.filter((p) => p.status === 'live');
    if (livePolls.length === 0) return;

    const pollsWithPendingRec = new Set(
      recs.filter((r) => r.status === 'pending').map((r) => r.poll_id),
    );
    const pollsToRequest = livePolls.filter((p) => !pollsWithPendingRec.has(p.id));
    if (pollsToRequest.length === 0) return;

    ranForTrip.current = tripId;
    (async () => {
      let any = false;
      for (const p of pollsToRequest) {
        const r = await requestRecommendation(p.id).catch(() => ({ ok: false }));
        if (r.ok) any = true;
      }
      if (any) {
        qc.invalidateQueries({ queryKey: recommendationKeys.forTrip(tripId) });
      }
    })();
  }, [tripId, polls, recs, qc]);
}

export function useHoldRecommendation(tripId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recommendationId, holdUntil }: {
      recommendationId: string; holdUntil?: string | null;
    }) => holdRecommendation(recommendationId, holdUntil ?? null),
    onSuccess: () => {
      if (tripId) qc.invalidateQueries({ queryKey: recommendationKeys.forTrip(tripId) });
    },
  });
}
