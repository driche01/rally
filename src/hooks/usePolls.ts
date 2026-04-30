import { useQuery } from '@tanstack/react-query';
import { getPollsForTrip } from '../lib/api/polls';

export const pollKeys = {
  forTrip: (tripId: string) => ['polls', tripId] as const,
};

export function usePolls(tripId: string) {
  return useQuery({
    queryKey: pollKeys.forTrip(tripId),
    queryFn: () => getPollsForTrip(tripId),
    enabled: Boolean(tripId),
    refetchInterval: 30_000,
  });
}
