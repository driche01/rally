/**
 * Supabase Edge Function — sms-broadcast
 *
 * Phase 4 of the 1:1 SMS pivot. Authenticated planners call this to send a
 * single message to every active+attending participant of one of their trip
 * sessions. The function gates on planner identity, then delegates to the
 * Phase 3 broadcast() helper.
 *
 *   POST /sms-broadcast
 *   Authorization: Bearer <user JWT>
 *   { trip_session_id, body }
 *
 * Returns:
 *   200 { ok: true,  sent, failed }
 *   200 { ok: false, reason }       // user-facing reason (forbidden, etc.)
 *   400 missing/invalid fields
 *   401 unauthenticated
 *
 * Deploy: supabase functions deploy sms-broadcast (JWT-verified by default
 *         — no --no-verify-jwt flag).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getAdmin } from '../_sms-shared/supabase.ts';
import { getPublishableKey } from '../_sms-shared/api-keys.ts';
import { broadcast } from '../_sms-shared/dm-sender.ts';
import { captureError, track } from '../_sms-shared/telemetry.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_BODY_LENGTH = 1000;

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
      console.error('[sms-broadcast] missing SUPABASE_URL / publishable key');
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
      | { trip_session_id?: unknown; body?: unknown }
      | null;
    if (!payload) {
      return jsonResponse({ ok: false, reason: 'invalid_body' }, 400);
    }
    const tripSessionId = typeof payload.trip_session_id === 'string'
      ? payload.trip_session_id.trim()
      : '';
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (!tripSessionId || !body) {
      return jsonResponse({ ok: false, reason: 'missing_fields' }, 400);
    }
    if (body.length > MAX_BODY_LENGTH) {
      return jsonResponse({ ok: false, reason: 'body_too_long' }, 400);
    }

    // ─── Authorize: caller must own the trip session ───────────────────
    const { data: session } = await admin
      .from('trip_sessions')
      .select('id, trip_id, planner_user_id')
      .eq('id', tripSessionId)
      .maybeSingle();
    if (!session) {
      return jsonResponse({ ok: false, reason: 'session_not_found' }, 200);
    }

    let callerUsersId: string | null = null;
    {
      const { data: linked } = await admin
        .from('users')
        .select('id')
        .eq('auth_user_id', authUserId)
        .maybeSingle();
      callerUsersId = linked?.id ?? null;
    }

    let authorized = false;
    if (callerUsersId && callerUsersId === session.planner_user_id) {
      authorized = true;
    } else if (session.trip_id) {
      const { data: trip } = await admin
        .from('trips')
        .select('created_by')
        .eq('id', session.trip_id)
        .maybeSingle();
      if (trip?.created_by === authUserId) authorized = true;
    }

    if (!authorized) {
      return jsonResponse({ ok: false, reason: 'forbidden' }, 200);
    }

    // ─── Fan out via Phase 3 broadcast() ───────────────────────────────
    const idempotencyKey = `planner_broadcast:${tripSessionId}:${cryptoNonce()}`;
    const result = await broadcast(admin, tripSessionId, body, {
      excludeUserId: callerUsersId,
      idempotencyKey,
    });

    // Log the planner's authored body to thread_messages for audit, tagged
    // as a planner broadcast so future activity-timeline can surface it.
    await admin.from('thread_messages').insert({
      thread_id: `broadcast_${tripSessionId}`,
      trip_session_id: tripSessionId,
      direction: 'outbound',
      sender_phone: null,
      sender_role: 'planner_broadcast',
      body,
      message_sid: null,
    });

    track('dashboard_broadcast_sent', {
      distinct_id: tripSessionId,
      tripSessionId,
      sent: result.sent,
      failed: result.failed.length,
      bodyLength: body.length,
      trip_model: '1to1',
    }).catch(() => {});

    return jsonResponse({
      ok: true,
      sent: result.sent,
      failed: result.failed.length,
    }, 200);
  } catch (err) {
    console.error('[sms-broadcast] unhandled:', err);
    captureError(err, { component: 'sms-broadcast' }).catch(() => {});
    return jsonResponse({ ok: false, reason: 'server_error' }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function cryptoNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
