import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTravelLeg,
  deleteTravelLeg,
  getSharedMemberLegs,
  getTravelLegsForTrip,
  TravelLeg,
  updateTravelLeg,
  type CreateTravelLegInput,
} from '@/lib/api/travelLegs';

const LEGS_KEY = (tripId: string) => ['travel-legs', tripId] as const;
const MEMBER_LEGS_KEY = (tripId: string) => ['travel-legs-members', tripId] as const;

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useTravelLegs(tripId: string) {
  return useQuery({
    queryKey: LEGS_KEY(tripId),
    queryFn: () => getTravelLegsForTrip(tripId),
    enabled: Boolean(tripId),
  });
}

export function useSharedMemberLegs(tripId: string) {
  return useQuery({
    queryKey: MEMBER_LEGS_KEY(tripId),
    queryFn: () => getSharedMemberLegs(tripId),
    enabled: Boolean(tripId),
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateTravelLeg(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTravelLegInput) => createTravelLeg(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEGS_KEY(tripId) });
      qc.invalidateQueries({ queryKey: MEMBER_LEGS_KEY(tripId) });
    },
  });
}

export function useUpdateTravelLeg(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Omit<TravelLeg, 'id' | 'trip_id' | 'respondent_id' | 'created_at'>>;
    }) => updateTravelLeg(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEGS_KEY(tripId) });
      qc.invalidateQueries({ queryKey: MEMBER_LEGS_KEY(tripId) });
    },
  });
}

export function useDeleteTravelLeg(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTravelLeg(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEGS_KEY(tripId) });
      qc.invalidateQueries({ queryKey: MEMBER_LEGS_KEY(tripId) });
    },
  });
}
