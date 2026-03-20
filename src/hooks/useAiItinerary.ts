import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAiItineraryDraft,
  generateAiItinerary,
  applyAiItineraryOption,
} from '../lib/api/aiItinerary';
import { itineraryKeys } from './useItinerary';
import type { AiItineraryOption } from '../types/database';

export const aiItineraryKeys = {
  draft: (tripId: string) => ['ai-itinerary-draft', tripId] as const,
};

/**
 * Fetches the stored AI itinerary draft for a trip.
 * Polls every 3 seconds while status === 'generating'.
 */
export function useAiItineraryDraft(tripId: string) {
  return useQuery({
    queryKey: aiItineraryKeys.draft(tripId),
    queryFn: () => getAiItineraryDraft(tripId),
    refetchInterval: (query) =>
      query.state.data?.status === 'generating' ? 3000 : false,
  });
}

/**
 * Triggers AI itinerary generation via the edge function.
 * Optimistically invalidates the draft query so the UI picks up 'generating'.
 */
export function useGenerateAiItinerary(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ override }: { override?: string }) =>
      generateAiItinerary(tripId, override),
    onMutate: async () => {
      // Optimistically set status to 'generating' so the spinner appears immediately
      await queryClient.cancelQueries({ queryKey: aiItineraryKeys.draft(tripId) });
      queryClient.setQueryData(aiItineraryKeys.draft(tripId), (old: any) => ({
        ...(old ?? {}),
        status: 'generating',
        options: [],
      }));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: aiItineraryKeys.draft(tripId) });
    },
  });
}

/**
 * Applies a selected AI itinerary option to itinerary_blocks.
 * Invalidates both the draft and the itinerary blocks so the tab refreshes.
 */
export function useApplyAiItineraryOption(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, option }: { draftId: string; option: AiItineraryOption }) =>
      applyAiItineraryOption(tripId, draftId, option),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiItineraryKeys.draft(tripId) });
      queryClient.invalidateQueries({ queryKey: itineraryKeys.blocks(tripId) });
    },
  });
}
