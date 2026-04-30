/**
 * Hooks for the dashboard decision queue.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPendingRecommendations,
  requestRecommendation,
  approveRecommendation,
  approveRecommendationWithDates,
  holdRecommendation,
  undoPollLock,
} from '@/lib/api/recommendations';
import { tripKeys } from './useTrips';

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
 * Approve a dates-poll recommendation with a planner-picked array of
 * ISO dates. Locks the poll + writes trips.start_date/end_date.
 */
export function useApproveRecommendationWithDates(tripId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recommendationId, dates }: {
      recommendationId: string; dates: string[];
    }) => approveRecommendationWithDates(recommendationId, dates),
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
