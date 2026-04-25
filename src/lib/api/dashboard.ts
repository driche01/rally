/**
 * Group Dashboard API (Phase 4 of 1:1 SMS pivot).
 *
 * - getActiveTripSession: looks up the most-recently-active trip_session
 *   for a trip. RLS-gated by migration 040 (trip members only).
 * - getSessionParticipants: roster for a session, RLS-gated.
 * - broadcastToSession: planner-authored fan-out, calls sms-broadcast
 *   edge function which gates on planner identity server-side.
 * - removeSessionParticipant: soft-removes a participant via RPC.
 */
import { supabase } from '@/lib/supabase';
import type { TripSession, TripSessionParticipant } from '@/types/database';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const BROADCAST_URL = `${SUPABASE_URL}/functions/v1/sms-broadcast`;

const ACTIVE_STATUSES = ['ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING', 'FIRST_BOOKING_REACHED'];

export async function getActiveTripSession(tripId: string): Promise<TripSession | null> {
  if (!tripId) return null;
  const { data, error } = await supabase
    .from('trip_sessions')
    .select('*')
    .eq('trip_id', tripId)
    .in('status', ACTIVE_STATUSES)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[dashboard] getActiveTripSession error:', error.message);
    return null;
  }
  return (data as TripSession | null) ?? null;
}

export async function getSessionParticipants(
  sessionId: string,
): Promise<TripSessionParticipant[]> {
  if (!sessionId) return [];
  const { data, error } = await supabase
    .from('trip_session_participants')
    .select('*')
    .eq('trip_session_id', sessionId)
    .order('joined_at', { ascending: true });
  if (error) {
    console.warn('[dashboard] getSessionParticipants error:', error.message);
    return [];
  }
  return (data as TripSessionParticipant[]) ?? [];
}

export interface BroadcastResult {
  ok: boolean;
  reason?: string;
  sent?: number;
  failed?: number;
}

export async function broadcastToSession(
  sessionId: string,
  body: string,
): Promise<BroadcastResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { ok: false, reason: 'not_authenticated' };
  if (!SUPABASE_URL) return { ok: false, reason: 'misconfigured' };

  try {
    const res = await fetch(BROADCAST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ trip_session_id: sessionId, body }),
    });
    const json = (await res.json().catch(() => null)) as BroadcastResult | null;
    if (!json) return { ok: false, reason: 'server_error' };
    return json;
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

export async function removeSessionParticipant(
  participantId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc('remove_session_participant', {
    p_participant_id: participantId,
  });
  if (error) return { ok: false, reason: error.message };
  return data as { ok: boolean; reason?: string };
}
