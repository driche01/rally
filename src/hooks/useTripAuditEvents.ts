/**
 * useTripAuditEvents — planner-only activity feed for a trip.
 *
 * Backed by `trip_audit_events` (migration 089). Refetches on focus +
 * every 30s so freshly-emitted events surface without a manual reload.
 */
import { useQuery } from '@tanstack/react-query';
import { getTripAuditEvents } from '@/lib/api/auditEvents';

export const auditEventKeys = {
  forTrip: (tripId: string) => ['trip_audit_events', tripId] as const,
};

export function useTripAuditEvents(tripId: string | undefined) {
  return useQuery({
    queryKey: auditEventKeys.forTrip(tripId ?? ''),
    queryFn: () => getTripAuditEvents(tripId!),
    enabled: Boolean(tripId),
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
}
