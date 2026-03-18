import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TripWithRespondentCount } from '../lib/api/trips';
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
import { syncTripFieldsToPolls } from '../lib/api/polls';

// Inlined to avoid circular import (usePolls imports tripKeys from here)
const pollsForTrip = (tripId: string) => ['polls', tripId] as const;

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
  const qc = useQueryClient();
  return useQuery({
    queryKey: tripKeys.detail(id),
    queryFn: () => getTripById(id),
    enabled: Boolean(id),
    initialData: () => {
      const trips = qc.getQueryData<TripWithRespondentCount[]>(tripKeys.allWithCounts);
      return trips?.find((t) => t.id === id);
    },
  });
}

export function useCreateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTripInput) => createTrip(input),
    onSuccess: async (data) => {
      // Auto-create decided polls for any fields set at creation time
      await syncTripFieldsToPolls(data.id, {
        destination: data.destination,
        start_date: data.start_date,
        end_date: data.end_date,
        budget_per_person: data.budget_per_person,
      }).catch(() => {}); // non-blocking — don't fail trip creation if this errors
      qc.invalidateQueries({ queryKey: tripKeys.all });
      qc.invalidateQueries({ queryKey: pollsForTrip(data.id) });
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
    onSuccess: async (data) => {
      // Auto-create decided polls for any fields added/set during edit
      await syncTripFieldsToPolls(data.id, {
        destination: data.destination,
        start_date: data.start_date,
        end_date: data.end_date,
        budget_per_person: data.budget_per_person,
      }).catch(() => {}); // non-blocking — don't fail the save if this errors
      qc.invalidateQueries({ queryKey: tripKeys.all });
      qc.invalidateQueries({ queryKey: tripKeys.allWithCounts });
      qc.invalidateQueries({ queryKey: tripKeys.detail(data.id) });
      qc.invalidateQueries({ queryKey: pollsForTrip(data.id) });
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
