import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTrip,
  deleteTrip,
  getTrips,
  getTripsWithRespondentCounts,
  getTripById,
  updateTrip,
  updateTripStatus,
  type CreateTripInput,
} from '../lib/api/trips';

export const tripKeys = {
  all: ['trips'] as const,
  allWithCounts: ['trips', 'withCounts'] as const,
  detail: (id: string) => ['trips', id] as const,
};

export function useTrips() {
  return useQuery({
    queryKey: tripKeys.all,
    queryFn: getTrips,
  });
}

export function useTripsWithRespondentCounts() {
  return useQuery({
    queryKey: tripKeys.allWithCounts,
    queryFn: getTripsWithRespondentCounts,
  });
}

export function useTrip(id: string) {
  return useQuery({
    queryKey: tripKeys.detail(id),
    queryFn: () => getTripById(id),
    enabled: Boolean(id),
  });
}

export function useCreateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTripInput) => createTrip(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tripKeys.all });
    },
  });
}

export function useDeleteTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTrip(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tripKeys.all });
      qc.invalidateQueries({ queryKey: tripKeys.allWithCounts });
    },
  });
}

export function useUpdateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Partial<CreateTripInput>) =>
      updateTrip(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: tripKeys.all });
      qc.invalidateQueries({ queryKey: tripKeys.allWithCounts });
      qc.invalidateQueries({ queryKey: tripKeys.detail(data.id) });
    },
  });
}

export function useCloseTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => updateTripStatus(id, 'closed'),
    onSuccess: (_void, id) => {
      qc.invalidateQueries({ queryKey: tripKeys.all });
      qc.invalidateQueries({ queryKey: tripKeys.allWithCounts });
      qc.invalidateQueries({ queryKey: tripKeys.detail(id) });
    },
  });
}
