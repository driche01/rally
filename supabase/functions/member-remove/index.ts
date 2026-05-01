/**
 * Supabase Edge Function — member-remove
 *
 * Authenticated planners call this from the trip-edit screen / Group
 * Dashboard to remove someone from the trip's roster. Soft-removes the
 * matching trip_session_participants row (if any), deletes the respondent
 * row (if any), and fires a one-shot SMS letting the recipient know they
 * were removed.
 *
 *   POST /member-remove
 *   Authorization: Bearer <user JWT>
 *   { trip_id, phone }
 *
 * Returns:
 *   200 { ok: true,  removed: { participant: bool, respondent: bool }, sms_sent }
 *   200 { ok: false, reason }
 *   400 missing/invalid fields
 *   401 unauthenticated
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getAdmin } from '../_sms-shared/supabase.ts';
import { getPublishableKey } from '../_sms-shared/api-keys.ts';
import { sendDm } from '../_sms-shared/dm-sender.ts';
import { removedFromTripSms } from '../_sms-shared/templates.ts';
import { normalizePhone } from '../_sms-shared/phone.ts';
import { captureError, track } from '../_sms-shared/telemetry.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, reason: 'method_not_allowed' }, 405);
  }

  const admin = getAdmin();

  try {
    // ─── Resolve caller from JWT ───────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return jsonResponse({ ok: false, reason: 'missing_auth' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey     = getPublishableKey();
    if (!supabaseUrl || !anonKey) {
      console.error('[member-remove] missing SUPABASE_URL / publishable key');
      return jsonResponse({ ok: false, reason: 'server_misconfigured' }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ ok: false, reason: 'invalid_auth' }, 401);
    }
    const authUserId = userData.user.id;

    // ─── Parse body ────────────────────────────────────────────────────
    const payload = await req.json().catch(() => null) as
      | { trip_id?: unknown; phone?: unknown }
      | null;
    if (!payload) {
      return jsonResponse({ ok: false, reason: 'invalid_body' }, 400);
    }
    const tripId = typeof payload.trip_id === 'string' ? payload.trip_id.trim() : '';
    const rawPhone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
    if (!tripId || !rawPhone) {
      return jsonResponse({ ok: false, reason: 'missing_fields' }, 400);
    }
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      return jsonResponse({ ok: false, reason: 'invalid_phone' }, 200);
    }

    // ─── Authorize: caller must own the trip ───────────────────────────
    const { data: trip } = await admin
      .from('trips')
      .select('id, created_by, destination')
      .eq('id', tripId)
      .maybeSingle();
    if (!trip) {
      return jsonResponse({ ok: false, reason: 'trip_not_found' }, 200);
    }
    if (trip.created_by !== authUserId) {
      return jsonResponse({ ok: false, reason: 'forbidden' }, 200);
    }

    // ─── Block self-removal: planner can't remove themselves ───────────
    {
      const { data: callerRespondent } = await admin
        .from('respondents')
        .select('id')
        .eq('trip_id', tripId)
        .eq('phone', phone)
        .eq('is_planner', true)
        .maybeSingle();
      if (callerRespondent) {
        return jsonResponse({ ok: false, reason: 'cannot_remove_planner' }, 200);
      }
    }

    // ─── Resolve planner display name (for SMS personalization) ────────
    let plannerName: string | null = null;
    {
      const { data: profile } = await admin
        .from('profiles')
        .select('name')
        .eq('id', authUserId)
        .maybeSingle();
      plannerName = (profile as { name?: string | null } | null)?.name ?? null;
    }

    // ─── Find active trip session for this trip (if any) ───────────────
    const { data: session } = await admin
      .from('trip_sessions')
      .select('id, planner_user_id')
      .eq('trip_id', tripId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const tripSessionId = (session as { id?: string } | null)?.id ?? null;
    const sessionPlannerId = (session as { planner_user_id?: string } | null)?.planner_user_id ?? null;

    // ─── Soft-remove participant row (if exists, and not the planner) ──
    let participantRemoved = false;
    if (tripSessionId) {
      const { data: participant } = await admin
        .from('trip_session_participants')
        .select('id, user_id, status')
        .eq('trip_session_id', tripSessionId)
        .eq('phone', phone)
        .maybeSingle();
      if (participant) {
        const p = participant as { id: string; user_id: string | null; status: string };
        if (sessionPlannerId && p.user_id === sessionPlannerId) {
          return jsonResponse({ ok: false, reason: 'cannot_remove_planner' }, 200);
        }
        if (p.status !== 'removed_by_planner') {
          const { error: updErr } = await admin
            .from('trip_session_participants')
            .update({ status: 'removed_by_planner', updated_at: new Date().toISOString() })
            .eq('id', p.id);
          if (!updErr) participantRemoved = true;
        } else {
          // Already removed — treat as idempotent success.
          participantRemoved = true;
        }
      }
    }

    // ─── Delete respondent row (if exists) ─────────────────────────────
    let respondentRemoved = false;
    {
      const { error: delErr, count } = await admin
        .from('respondents')
        .delete({ count: 'exact' })
        .eq('trip_id', tripId)
        .eq('phone', phone);
      if (!delErr && (count ?? 0) > 0) respondentRemoved = true;
    }

    if (!participantRemoved && !respondentRemoved) {
      return jsonResponse({ ok: false, reason: 'not_found' }, 200);
    }

    // ─── Send removal SMS (best-effort) ────────────────────────────────
    const body = removedFromTripSms({
      plannerName,
      destination: (trip as { destination?: string | null }).destination ?? null,
    });
    const sendResult = await sendDm(admin, phone, body, {
      tripSessionId,
      idempotencyKey: `member_remove:${tripId}:${phone}`,
    });

    track('member_removed_via_app', {
      distinct_id: tripId,
      tripId,
      participantRemoved,
      respondentRemoved,
      smsSent: !sendResult.error,
    }).catch(() => {});

    // Audit: planner-driven removal carries the planner's actor_id;
    // pure opt-outs (status flips to 'opted_out') are auto-emitted by
    // the trigger in migration 090. Best-effort.
    try {
      const { data: actorRow } = await admin
        .from('users')
        .select('id')
        .eq('auth_user_id', authUserId)
        .maybeSingle();
      const actorId = (actorRow as { id?: string } | null)?.id ?? null;
      await admin.from('trip_audit_events').insert({
        trip_id: tripId,
        actor_id: actorId,
        kind: 'member_removed_by_planner',
        payload: {
          phone,
          participant_removed: participantRemoved,
          respondent_removed: respondentRemoved,
        },
      });
    } catch (auditErr) {
      console.warn('[member-remove] audit emit failed:', auditErr);
    }

    return jsonResponse({
      ok: true,
      removed: {
        participant: participantRemoved,
        respondent: respondentRemoved,
      },
      sms_sent: !sendResult.error,
      sms_error: sendResult.error ?? null,
    }, 200);
  } catch (err) {
    console.error('[member-remove] unhandled:', err);
    captureError(err, { component: 'member-remove' }).catch(() => {});
    return jsonResponse({ ok: false, reason: 'server_error' }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
