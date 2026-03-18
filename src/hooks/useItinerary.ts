import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getBlocksForTrip,
  createBlock,
  updateBlock,
  deleteBlock,
  reorderBlocks,
  getRsvpsForTrip,
  upsertDayRsvp,
  buildItineraryDays,
  type CreateBlockInput,
} from '@/lib/api/itinerary';
import type { DayRsvpStatus } from '@/types/database';

export const itineraryKeys = {
  blocks: (tripId: string) => ['itinerary', 'blocks', tripId] as const,
  rsvps: (tripId: string) => ['itinerary', 'rsvps', tripId] as const,
  days: (tripId: string) => ['itinerary', 'days', tripId] as const,
};

export function useItineraryBlocks(tripId: string) {
  return useQuery({
    queryKey: itineraryKeys.blocks(tripId),
    queryFn: () => getBlocksForTrip(tripId),
    enabled: !!tripId,
  });
}

export function useDayRsvps(tripId: string) {
  return useQuery({
    queryKey: itineraryKeys.rsvps(tripId),
    queryFn: () => getRsvpsForTrip(tripId),
    enabled: !!tripId,
  });
}

export function useItineraryDays(
  tripId: string,
  startDate: string | null,
  endDate: string | null
) {
  const { data: blocks = [] } = useItineraryBlocks(tripId);
  const { data: rsvps = [] } = useDayRsvps(tripId);
  if (!startDate || !endDate) return { days: [] };
  const days = buildItineraryDays(startDate, endDate, blocks, rsvps);
  return { days };
}

export function useCreateBlock(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBlockInput) => createBlock(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: itineraryKeys.blocks(tripId) }),
  });
}

export function useUpdateBlock(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      blockId,
      updates,
    }: {
      blockId: string;
      updates: Parameters<typeof updateBlock>[1];
    }) => updateBlock(blockId, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: itineraryKeys.blocks(tripId) }),
  });
}

export function useDeleteBlock(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blockId: string) => deleteBlock(blockId),
    onSuccess: () => qc.invalidateQueries({ queryKey: itineraryKeys.blocks(tripId) }),
  });
}

export function useReorderBlocks(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: { id: string; position: number }[]) => reorderBlocks(updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: itineraryKeys.blocks(tripId) }),
  });
}

export function useUpsertDayRsvp(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      respondentId,
      dayDate,
      status,
    }: {
      respondentId: string;
      dayDate: string;
      status: DayRsvpStatus;
    }) => upsertDayRsvp(tripId, respondentId, dayDate, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: itineraryKeys.rsvps(tripId) }),
  });
}
