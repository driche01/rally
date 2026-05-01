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
import { normalizePhone } from '@/lib/phone';
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

// ─── Nudge schedule (cadence card) ──────────────────────────────────────────

export type NudgeKind =
  | 'initial' | 'd1' | 'd3' | 'heartbeat'
  | 'rd_minus_2' | 'rd_minus_1' | 'manual'
  | 'lock_broadcast' | 'holdout_lock';

export interface NudgeScheduleItem {
  id: string;
  trip_session_id: string;
  participant_id: string | null;
  participant_name: string | null;
  participant_phone: string | null;
  nudge_type: NudgeKind;
  scheduled_for: string;
  sent_at: string | null;
  skipped_at: string | null;
  skip_reason: string | null;
}

const NUDGE_LIMIT = 50;

/**
 * Upcoming + recently-sent nudges for a session. Pending rows first
 * (oldest scheduled_for first), then sent/skipped rows for context.
 *
 * Defense-in-depth: we filter out *pending* rows for participants who
 * have already responded (rsvp/preferences set OR any poll_responses
 * row). The scheduler also filters at fire time and the survey-confirm
 * edge function eagerly stamps skipped_at, but if either races the
 * dashboard render this client-side filter ensures the planner never
 * sees a "ghost" upcoming nudge for someone who's already done.
 */
export async function getNudgeSchedule(sessionId: string): Promise<NudgeScheduleItem[]> {
  if (!sessionId) return [];
  const { data, error } = await supabase
    .from('nudge_sends')
    .select(`
      id, trip_session_id, participant_id, nudge_type,
      scheduled_for, sent_at, skipped_at, skip_reason
    `)
    .eq('trip_session_id', sessionId)
    .order('scheduled_for', { ascending: true })
    .limit(NUDGE_LIMIT);
  if (error) {
    console.warn('[dashboard] getNudgeSchedule error:', error.message);
    return [];
  }
  type Row = {
    id: string; trip_session_id: string; participant_id: string | null;
    nudge_type: string; scheduled_for: string; sent_at: string | null;
    skipped_at: string | null; skip_reason: string | null;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const partIds = Array.from(new Set(rows.map((r) => r.participant_id).filter((x): x is string => !!x)));
  let nameByPart = new Map<string, { display_name: string | null; phone: string }>();
  if (partIds.length > 0) {
    const { data: pData } = await supabase
      .from('trip_session_participants')
      .select('id, display_name, phone')
      .in('id', partIds);
    for (const p of (pData ?? []) as { id: string; display_name: string | null; phone: string }[]) {
      nameByPart.set(p.id, { display_name: p.display_name, phone: p.phone });
    }
  }

  // Build a set of normalized phones whose owner has already responded.
  // Mirrors the scheduler's hasResponded() definition: explicit rsvp,
  // full preferences, or at least one poll_response row.
  const respondedPhones = new Set<string>();
  const { data: ses } = await supabase
    .from('trip_sessions')
    .select('trip_id')
    .eq('id', sessionId)
    .maybeSingle();
  const tripId = (ses as { trip_id?: string } | null)?.trip_id ?? null;
  if (tripId) {
    const phones = Array.from(
      new Set(Array.from(nameByPart.values()).map((v) => v.phone).filter((p): p is string => !!p)),
    );
    if (phones.length > 0) {
      const { data: respondents } = await supabase
        .from('respondents')
        .select('id, phone, rsvp, preferences')
        .eq('trip_id', tripId)
        .in('phone', phones);
      type R = { id: string; phone: string | null; rsvp: 'in' | 'out' | null; preferences: unknown | null };
      const respList = (respondents ?? []) as R[];

      let votedRespondentIds = new Set<string>();
      if (respList.length > 0) {
        const { data: polls } = await supabase
          .from('polls')
          .select('id')
          .eq('trip_id', tripId);
        const pollIds = ((polls ?? []) as { id: string }[]).map((p) => p.id);
        if (pollIds.length > 0) {
          const { data: votes } = await supabase
            .from('poll_responses')
            .select('respondent_id')
            .in('poll_id', pollIds)
            .in('respondent_id', respList.map((r) => r.id));
          votedRespondentIds = new Set(
            ((votes ?? []) as { respondent_id: string }[]).map((v) => v.respondent_id),
          );
        }
      }

      for (const r of respList) {
        const done =
          r.rsvp === 'out'
          || (r.rsvp === 'in' && r.preferences != null)
          || votedRespondentIds.has(r.id);
        if (!done || !r.phone) continue;
        const norm = normalizePhone(r.phone) ?? r.phone;
        respondedPhones.add(norm);
      }
    }
  }

  return rows
    .map((r) => {
      const meta = r.participant_id ? nameByPart.get(r.participant_id) ?? null : null;
      return {
        id: r.id,
        trip_session_id: r.trip_session_id,
        participant_id: r.participant_id,
        participant_name: meta?.display_name ?? null,
        participant_phone: meta?.phone ?? null,
        nudge_type: r.nudge_type as NudgeKind,
        scheduled_for: r.scheduled_for,
        sent_at: r.sent_at,
        skipped_at: r.skipped_at,
        skip_reason: r.skip_reason,
      };
    })
    .filter((it) => {
      // Keep historical context (sent or skipped rows) regardless.
      if (it.sent_at || it.skipped_at) return true;
      if (!it.participant_phone) return true;
      const norm = normalizePhone(it.participant_phone) ?? it.participant_phone;
      return !respondedPhones.has(norm);
    });
}

export async function sendNudgeNow(
  sessionId: string,
  participantId?: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc('send_nudge_now', {
    p_trip_session_id: sessionId,
    p_participant_id: participantId ?? null,
  });
  if (error) return { ok: false, reason: error.message };
  return data as { ok: boolean; reason?: string };
}

export async function skipNextNudge(
  sessionId: string,
  participantId?: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc('skip_next_nudge', {
    p_trip_session_id: sessionId,
    p_participant_id: participantId ?? null,
  });
  if (error) return { ok: false, reason: error.message };
  return data as { ok: boolean; reason?: string };
}

export async function pauseParticipantNudges(
  sessionId: string,
  participantId: string,
): Promise<{ ok: boolean; count?: number; reason?: string }> {
  const { data, error } = await supabase.rpc('pause_participant_nudges', {
    p_trip_session_id: sessionId,
    p_participant_id: participantId,
  });
  if (error) return { ok: false, reason: error.message };
  return data as { ok: boolean; count?: number; reason?: string };
}
