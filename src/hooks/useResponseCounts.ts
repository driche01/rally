import { useQuery } from '@tanstack/react-query';
import { getResponseCountsForTrip } from '../lib/api/responses';

export const responseCountKeys = {
  forTrip: (tripId: string) => ['responseCounts', tripId] as const,
};

export function useResponseCounts(tripId: string) {
  return useQuery({
    queryKey: responseCountKeys.forTrip(tripId),
    queryFn: () => getResponseCountsForTrip(tripId),
    enabled: Boolean(tripId),
    refetchInterval: 30_000,
  });
}
