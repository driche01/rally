import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getLodgingOptionsForTrip,
  createLodgingOption,
  updateLodgingOption,
  deleteLodgingOption,
  confirmLodgingBooking,
  addLodgingVote,
  removeLodgingVote,
  type CreateLodgingInput,
} from '@/lib/api/lodging';

export const lodgingKeys = {
  all: (tripId: string) => ['lodging', tripId] as const,
};

export function useLodgingOptions(tripId: string) {
  return useQuery({
    queryKey: lodgingKeys.all(tripId),
    queryFn: () => getLodgingOptionsForTrip(tripId),
    enabled: !!tripId,
  });
}

export function useCreateLodgingOption(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLodgingInput) => createLodgingOption(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: lodgingKeys.all(tripId) }),
  });
}

export function useUpdateLodgingOption(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      optionId,
      updates,
    }: {
      optionId: string;
      updates: Parameters<typeof updateLodgingOption>[1];
    }) => updateLodgingOption(optionId, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: lodgingKeys.all(tripId) }),
  });
}

export function useDeleteLodgingOption(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (optionId: string) => deleteLodgingOption(optionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: lodgingKeys.all(tripId) }),
  });
}

export function useConfirmLodgingBooking(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      optionId,
      details,
    }: {
      optionId: string;
      details: Parameters<typeof confirmLodgingBooking>[1];
    }) => confirmLodgingBooking(optionId, details),
    onSuccess: () => qc.invalidateQueries({ queryKey: lodgingKeys.all(tripId) }),
  });
}

export function useAddLodgingVote(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      optionId,
      respondentId,
    }: {
      optionId: string;
      respondentId: string;
    }) => addLodgingVote(optionId, tripId, respondentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: lodgingKeys.all(tripId) }),
  });
}

export function useRemoveLodgingVote(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      optionId,
      respondentId,
    }: {
      optionId: string;
      respondentId: string;
    }) => removeLodgingVote(optionId, respondentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: lodgingKeys.all(tripId) }),
  });
}
