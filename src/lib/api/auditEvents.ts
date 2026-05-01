/**
 * Trip audit-event read API (Phase 15 — activity log).
 *
 * Backed by the `trip_audit_events` table. Reads are planner-only via
 * RLS (migration 089). Writes are service-role triggers (migration 090)
 * + future SECURITY DEFINER RPCs for the planner-intent events.
 */
import { supabase } from '@/lib/supabase';

/**
 * Discriminator for each event kind. Kept open so adding new kinds in
 * future migrations doesn't force a TS update before the row can be
 * read — the UI falls through to a generic "{actor} did something"
 * row for unknown kinds.
 */
export type TripAuditEventKind =
  | 'trip_created'
  | 'member_joined'
  | 'member_opted_out'
  | 'member_removed_by_planner'
  | 'member_added_by_planner'
  | 'traveler_profile_updated'
  | 'trip_field_changed'
  | 'poll_added'
  | 'poll_removed'
  | 'poll_decided'
  | 'survey_completed'
  | (string & {});

export interface TripAuditEvent {
  id: number;
  trip_id: string;
  actor_id: string | null;
  kind: TripAuditEventKind;
  payload: Record<string, unknown>;
  created_at: string;
}

const ACTIVITY_LIMIT = 50;

/**
 * Most-recent audit events for a trip, newest-first. Capped so the
 * activity screen stays cheap; we'll add a "load older" cursor only
 * once a trip's history actually exceeds the cap.
 */
export async function getTripAuditEvents(tripId: string): Promise<TripAuditEvent[]> {
  if (!tripId) return [];
  const { data, error } = await supabase
    .from('trip_audit_events')
    .select('id, trip_id, actor_id, kind, payload, created_at')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(ACTIVITY_LIMIT);
  if (error) {
    console.warn('[auditEvents] getTripAuditEvents error:', error.message);
    return [];
  }
  return (data ?? []) as TripAuditEvent[];
}
