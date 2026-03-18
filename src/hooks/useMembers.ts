import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  joinTrip,
  leaveTrip,
  getTripMembers,
  getMembershipStatus,
  getTripMemberCount,
} from '../lib/api/members';
import { tripKeys } from './useTrips';

export const memberKeys = {
  forTrip: (tripId: string) => ['members', tripId] as const,
  membership: (tripId: string) => ['members', tripId, 'me'] as const,
  count: (tripId: string) => ['members', tripId, 'count'] as const,
};

export function useTripMembers(tripId: string) {
  return useQuery({
    queryKey: memberKeys.forTrip(tripId),
    queryFn: () => getTripMembers(tripId),
    enabled: Boolean(tripId),
  });
}

export function useMembershipStatus(tripId: string) {
  return useQuery({
    queryKey: memberKeys.membership(tripId),
    queryFn: () => getMembershipStatus(tripId),
    enabled: Boolean(tripId),
  });
}

export function useTripMemberCount(tripId: string) {
  return useQuery({
    queryKey: memberKeys.count(tripId),
    queryFn: () => getTripMemberCount(tripId),
    enabled: Boolean(tripId),
  });
}

export function useJoinTrip(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => joinTrip(tripId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memberKeys.forTrip(tripId) });
      qc.invalidateQueries({ queryKey: memberKeys.membership(tripId) });
      qc.invalidateQueries({ queryKey: memberKeys.count(tripId) });
      qc.invalidateQueries({ queryKey: tripKeys.allWithCounts });
    },
  });
}

export function useLeaveTrip(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => leaveTrip(tripId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memberKeys.forTrip(tripId) });
      qc.invalidateQueries({ queryKey: memberKeys.membership(tripId) });
      qc.invalidateQueries({ queryKey: memberKeys.count(tripId) });
      qc.invalidateQueries({ queryKey: tripKeys.allWithCounts });
    },
  });
}
