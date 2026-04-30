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

// ─── Activity timeline (Phase 4.5) ──────────────────────────────────────────

export type ActivityItem =
  | {
      kind: 'broadcast';
      timestamp: string;
      body: string;
    }
  | {
      kind: 'join';
      timestamp: string;
      participant_id: string;
      display_name: string | null;
      phone: string;
    };

const ACTIVITY_LIMIT = 20;

/**
 * Fetch the merged activity feed for a session: planner broadcasts +
 * participant joins, sorted newest first. Phase transitions used to
 * populate this too, but the SMS phase machine was retired in the
 * Phase 5.6 kill-switch — no new transition events are written.
 */
export async function getSessionActivity(sessionId: string): Promise<ActivityItem[]> {
  if (!sessionId) return [];
  const [broadcastsRes, participantsRes] = await Promise.all([
    supabase
      .from('thread_messages')
      .select('body, created_at')
      .eq('trip_session_id', sessionId)
      .eq('sender_role', 'planner_broadcast')
      .order('created_at', { ascending: false })
      .limit(ACTIVITY_LIMIT),
    supabase
      .from('trip_session_participants')
      .select('id, display_name, phone, joined_at, status')
      .eq('trip_session_id', sessionId)
      .order('joined_at', { ascending: false })
      .limit(ACTIVITY_LIMIT),
  ]);

  const items: ActivityItem[] = [];

  for (const b of broadcastsRes.data ?? []) {
    items.push({
      kind: 'broadcast',
      timestamp: (b as any).created_at,
      body: (b as any).body ?? '',
    });
  }
  for (const p of participantsRes.data ?? []) {
    if ((p as any).status === 'active') {
      items.push({
        kind: 'join',
        timestamp: (p as any).joined_at,
        participant_id: (p as any).id,
        display_name: (p as any).display_name ?? null,
        phone: (p as any).phone,
      });
    }
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return items.slice(0, ACTIVITY_LIMIT);
}

// ─── Planner inbox (Phase 5.7 — inbound participant SMS surfacing) ──────────

export interface PlannerInboxItem {
  message_id: string;
  trip_session_id: string;
  participant_id: string | null;
  participant_name: string | null;
  participant_phone: string;
  body: string;
  created_at: string;
  acknowledged_at: string | null;
}

const INBOX_LIMIT = 25;

/**
 * Recent inbound participant SMS for a trip — what people texted Rally
 * after getting a survey link or nudge. Includes both unread (badge) and
 * acknowledged items (so the inbox stays useful as history).
 */
export async function getPlannerInbox(
  sessionId: string,
  opts: { unreadOnly?: boolean } = {},
): Promise<PlannerInboxItem[]> {
  if (!sessionId) return [];
  let query = supabase
    .from('thread_messages')
    .select(`
      id, body, created_at, sender_phone, planner_acknowledged_at, trip_session_id
    `)
    .eq('trip_session_id', sessionId)
    .eq('direction', 'inbound')
    .eq('sender_role', 'participant')
    .eq('needs_planner_attention', true)
    .order('created_at', { ascending: false })
    .limit(INBOX_LIMIT);
  if (opts.unreadOnly) {
    query = query.is('planner_acknowledged_at', null);
  }
  const { data, error } = await query;
  if (error) {
    console.warn('[dashboard] getPlannerInbox error:', error.message);
    return [];
  }

  // Resolve participant names for the listed phones in one pass.
  type Row = {
    id: string; body: string; created_at: string; sender_phone: string;
    planner_acknowledged_at: string | null; trip_session_id: string;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];
  const phones = Array.from(new Set(rows.map((r) => r.sender_phone)));
  const { data: pData } = await supabase
    .from('trip_session_participants')
    .select('id, phone, display_name')
    .eq('trip_session_id', sessionId)
    .in('phone', phones);
  const byPhone = new Map<string, { id: string; display_name: string | null }>();
  for (const p of (pData ?? []) as { id: string; phone: string; display_name: string | null }[]) {
    byPhone.set(p.phone, { id: p.id, display_name: p.display_name });
  }

  return rows.map((r) => {
    const match = byPhone.get(r.sender_phone) ?? null;
    return {
      message_id: r.id,
      trip_session_id: r.trip_session_id,
      participant_id: match?.id ?? null,
      participant_name: match?.display_name ?? null,
      participant_phone: r.sender_phone,
      body: r.body,
      created_at: r.created_at,
      acknowledged_at: r.planner_acknowledged_at,
    };
  });
}

export async function ackPlannerInboxMessage(messageId: string): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc('ack_planner_inbox_message', {
    p_message_id: messageId,
  });
  if (error) return { ok: false };
  return data as { ok: boolean };
}

export async function ackPlannerInboxForTrip(tripId: string): Promise<{ ok: boolean; count?: number }> {
  const { data, error } = await supabase.rpc('ack_planner_inbox_for_trip', {
    p_trip_id: tripId,
  });
  if (error) return { ok: false };
  return data as { ok: boolean; count?: number };
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

  return rows.map((r) => {
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

/**
 * Phones whose most-recent outbound SMS failed delivery (Twilio status =
 * 'failed' or 'undelivered'). Drives the "Couldn't deliver" badge on the
 * participant row. Returns a Set for O(1) lookup at render time.
 */
export async function getFailedDeliveryPhones(sessionId: string): Promise<Set<string>> {
  if (!sessionId) return new Set();
  // Pull recent outbound rows; filter to participant phones (To phone is in
  // sender_phone for inbound; for outbound the recipient phone isn't stored
  // explicitly — we infer via the thread_id format `1to1_<phone>`).
  const { data } = await supabase
    .from('thread_messages')
    .select('thread_id, delivery_status, created_at')
    .eq('trip_session_id', sessionId)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(200);
  const seen = new Set<string>();
  const failed = new Set<string>();
  for (const row of (data ?? []) as { thread_id: string; delivery_status: string | null }[]) {
    const m = row.thread_id?.match(/^1to1_(\+\d+)$/);
    if (!m) continue;
    const phone = m[1];
    if (seen.has(phone)) continue;
    seen.add(phone);
    if (row.delivery_status === 'failed' || row.delivery_status === 'undelivered') {
      failed.add(phone);
    }
  }
  return failed;
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
