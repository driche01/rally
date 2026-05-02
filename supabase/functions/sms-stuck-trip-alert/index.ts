/**
 * Supabase Edge Function — sms-stuck-trip-alert
 *
 * Phase 6.2 — one-shot SMS to the planner when a trip is "stuck": ≥5 days
 * since launch, fewer than 50% of attending participants have responded.
 *
 * The scheduler evaluates eligibility every 15 min and calls this function
 * when the threshold trips for the first time. Idempotency is enforced by
 * trips.stuck_alert_sent_at (migration 087), stamped server-side after the
 * SMS goes out — so callers can retry safely.
 *
 *   POST /sms-stuck-trip-alert
 *   { trip_id, responded_count, total_count }
 *
 * Body:
 *   "Heads up — only 2 of 6 have responded to your Cancun survey so far.
 *    Want to nudge them yourself? rally://t/<tripId>"
 *
 * The trip link uses the app's custom URL scheme so iMessage launches the
 * Rally app directly (the universal-link form was unreliable — iOS would
 * sometimes route to Safari instead of the app).
 *
 * Deploy: supabase functions deploy sms-stuck-trip-alert --no-verify-jwt
 */

import { getAdmin } from '../_sms-shared/supabase.ts';
import { sendDm } from '../_sms-shared/dm-sender.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function tripUrl(tripId: string): string {
  return `rally://t/${tripId}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ ok: false, reason: 'method_not_allowed' }, 405);

  try {
    const payload = (await req.json().catch(() => null)) as
      | { trip_id?: unknown; responded_count?: unknown; total_count?: unknown }
      | null;
    const tripId = typeof payload?.trip_id === 'string' ? payload.trip_id : '';
    const respondedCount = typeof payload?.responded_count === 'number' ? payload.responded_count : -1;
    const totalCount = typeof payload?.total_count === 'number' ? payload.total_count : -1;
    if (!tripId || respondedCount < 0 || totalCount <= 0) {
      return jsonResponse({ ok: false, reason: 'missing_fields' }, 400);
    }

    const admin = getAdmin();

    const { data: trip } = await admin
      .from('trips')
      .select('id, name, destination, created_by, stuck_alert_sent_at')
      .eq('id', tripId)
      .maybeSingle();
    if (!trip) return jsonResponse({ ok: false, reason: 'trip_not_found' }, 200);
    if (trip.stuck_alert_sent_at) {
      return jsonResponse({ ok: true, reason: 'already_sent' });
    }

    if (!trip.created_by) {
      return jsonResponse({ ok: false, reason: 'no_planner' }, 200);
    }

    const { data: planner } = await admin
      .from('profiles')
      .select('phone, name')
      .eq('id', trip.created_by)
      .maybeSingle();
    if (!planner?.phone) {
      return jsonResponse({ ok: false, reason: 'planner_phone_missing' }, 200);
    }

    // Don't text opted-out planners — sending after STOP is a compliance
    // violation. The alert can still be surfaced via push/banner.
    const { data: user } = await admin
      .from('users')
      .select('opted_out')
      .eq('phone', planner.phone)
      .maybeSingle();
    if (user?.opted_out) {
      return jsonResponse({ ok: true, reason: 'opted_out' });
    }

    const { data: session } = await admin
      .from('trip_sessions')
      .select('id')
      .eq('trip_id', tripId)
      .in('status', ['ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const tripWord = trip.destination ? `${trip.destination} survey` : 'trip survey';
    const body =
      `Heads up — only ${respondedCount} of ${totalCount} have responded to your ${tripWord} so far. ` +
      `Want to nudge them yourself? ${tripUrl(tripId)}`;

    const idem = `stuck_alert:${tripId}`;
    const result = await sendDm(admin, planner.phone, body, {
      tripSessionId: session?.id ?? null,
      idempotencyKey: idem,
      senderRole: 'rally_stuck_alert',
    });

    if (result.error) {
      return jsonResponse({ ok: false, reason: 'send_failed', error: result.error }, 200);
    }

    await admin
      .from('trips')
      .update({ stuck_alert_sent_at: new Date().toISOString() })
      .eq('id', tripId);

    return jsonResponse({ ok: true, sid: result.sid });
  } catch (err) {
    console.error('[sms-stuck-trip-alert] fatal:', err);
    return jsonResponse({ ok: false, reason: 'fatal', error: String(err) }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
