/**
 * Supabase Edge Function — sms-trip-finalize-prompt
 *
 * Phase 1 of the trip-finalize flow. Texts the planner once when the
 * trip is "ready to lock":
 *   - every active group member has answered every undecided poll, OR
 *   - book_by_date has been reached.
 *
 * The trigger evaluation lives in sms-nudge-scheduler (which runs every
 * 15 min on pg_cron). This function is called by the scheduler when the
 * trigger fires for the first time per trip; idempotency is enforced by
 * trips.finalize_prompt_sent_at, stamped server-side after the SMS goes
 * out (migration 083).
 *
 * Body links the planner to a universal URL `/t/<tripId>` which routes
 * into the in-app trip dashboard (app/t/[tripId].tsx redirects when the
 * planner is signed in).
 *
 *   POST /sms-trip-finalize-prompt
 *   { trip_id }
 *
 * Deploy: supabase functions deploy sms-trip-finalize-prompt --no-verify-jwt
 */

import { getAdmin } from '../_sms-shared/supabase.ts';
import { sendDm } from '../_sms-shared/dm-sender.ts';
import { formatShortDate } from '../_sms-shared/templates.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function tripUrl(tripId: string): string {
  const base = Deno.env.get('PUBLIC_SURVEY_BASE_URL') ?? 'https://rallysurveys.netlify.app';
  return `${base}/t/${tripId}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ ok: false, reason: 'method_not_allowed' }, 405);

  try {
    const payload = (await req.json().catch(() => null)) as { trip_id?: unknown } | null;
    const tripId = typeof payload?.trip_id === 'string' ? payload.trip_id : '';
    if (!tripId) return jsonResponse({ ok: false, reason: 'missing_trip_id' }, 400);

    const admin = getAdmin();

    const { data: trip } = await admin
      .from('trips')
      .select('id, name, destination, created_by, book_by_date, finalize_prompt_sent_at')
      .eq('id', tripId)
      .maybeSingle();
    if (!trip) return jsonResponse({ ok: false, reason: 'trip_not_found' }, 200);
    if (trip.finalize_prompt_sent_at) {
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
    // violation. The prompt can be surfaced via push/banner instead.
    const { data: user } = await admin
      .from('users')
      .select('opted_out')
      .eq('phone', planner.phone)
      .maybeSingle();
    if (user?.opted_out) {
      return jsonResponse({ ok: true, reason: 'opted_out' });
    }

    // Active session for thread attribution (powers the dashboard timeline).
    const { data: session } = await admin
      .from('trip_sessions')
      .select('id')
      .eq('trip_id', tripId)
      .in('status', ['ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const tripName = trip.name?.trim() || trip.destination || 'your trip';
    const byDate = trip.book_by_date
      ? ` by ${formatShortDate(trip.book_by_date)}`
      : '';
    const body =
      `Everyone's responded to open polls for ${tripName}. ` +
      `Lock in final decisions${byDate}: ${tripUrl(tripId)}`;

    // Idempotency at the SMS layer — even if this function is called twice
    // before finalize_prompt_sent_at lands, the dm-sender de-dupes within
    // 60s on this key.
    const idem = `finalize_prompt:${tripId}`;

    const result = await sendDm(admin, planner.phone, body, {
      tripSessionId: session?.id ?? null,
      idempotencyKey: idem,
      senderRole: 'rally_finalize_prompt',
    });

    if (result.error) {
      return jsonResponse({ ok: false, reason: 'send_failed', error: result.error }, 200);
    }

    await admin
      .from('trips')
      .update({ finalize_prompt_sent_at: new Date().toISOString() })
      .eq('id', tripId);

    return jsonResponse({ ok: true, sid: result.sid });
  } catch (err) {
    console.error('[sms-trip-finalize-prompt] fatal:', err);
    return jsonResponse({ ok: false, reason: 'fatal', error: String(err) }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
