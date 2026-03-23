/**
 * React Query hooks for F1 AI suggestions — lodging and travel.
 */

import { useMutation } from '@tanstack/react-query';
import { getLodgingSuggestions, getTravelSuggestions } from '@/lib/api/aiSuggestions';

// Suggestions are on-demand (user taps "Get AI suggestions"), not auto-fetched.
// We use mutations so the planner controls when to trigger generation.

export function useGetLodgingSuggestions(tripId: string) {
  return useMutation({
    mutationFn: () => getLodgingSuggestions(tripId),
    retry: 1,
  });
}

export function useGetTravelSuggestions(tripId: string) {
  return useMutation({
    mutationFn: (origin?: string) => getTravelSuggestions(tripId, origin),
    retry: 1,
  });
}
