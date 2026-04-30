/**
 * Supabase Edge Function — sms-survey-confirmation
 *
 * Fires a short confirmation SMS to a respondent after they submit (or
 * update) the survey. No-ops for respondents without a phone, opted-out
 * users, or trips without an active session.
 *
 *   POST /sms-survey-confirmation
 *   { trip_id, phone, rsvp }   // rsvp = 'in' | 'out'
 *
 * Public endpoint — the survey is unauth'd, so this is too. Idempotency
 * via per-(trip, phone, day) key on dm-sender prevents duplicate sends
 * if the survey is re-submitted.
 *
 * Deploy: supabase functions deploy sms-survey-confirmation --no-verify-jwt
 */

import { getAdmin } from '../_sms-shared/supabase.ts';
import { sendDm } from '../_sms-shared/dm-sender.ts';
import { normalizePhone } from '../_sms-shared/phone.ts';

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

  try {
    const payload = (await req.json().catch(() => null)) as
      | { trip_id?: unknown; phone?: unknown; rsvp?: unknown }
      | null;
    if (!payload) return jsonResponse({ ok: false, reason: 'invalid_body' }, 400);

    const tripId = typeof payload.trip_id === 'string' ? payload.trip_id : '';
    const rawPhone = typeof payload.phone === 'string' ? payload.phone : '';
    const rsvp = payload.rsvp === 'out' ? 'out' : 'in';
    if (!tripId || !rawPhone) {
      return jsonResponse({ ok: false, reason: 'missing_fields' }, 400);
    }

    const phone = normalizePhone(rawPhone);
    if (!phone) {
      return jsonResponse({ ok: false, reason: 'invalid_phone' }, 200);
    }

    const admin = getAdmin();

    // Skip opted-out users — sending after STOP is a compliance violation.
    const { data: user } = await admin
      .from('users')
      .select('id, opted_out')
      .eq('phone', phone)
      .maybeSingle();
    if (user?.opted_out) {
      return jsonResponse({ ok: true, reason: 'opted_out' });
    }

    // Pull trip + planner context for personalization. share_token is
    // needed to construct the survey URL appended to the confirmation.
    const { data: trip } = await admin
      .from('trips')
      .select('id, name, destination, created_by, share_token')
      .eq('id', tripId)
      .maybeSingle();
    if (!trip) return jsonResponse({ ok: false, reason: 'trip_not_found' }, 200);

    let plannerFirstName: string | null = null;
    if (trip.created_by) {
      const { data: planner } = await admin
        .from('profiles')
        .select('name')
        .eq('id', trip.created_by)
        .maybeSingle();
      plannerFirstName = (planner?.name ?? '').trim().split(/\s+/)[0] || null;
    }

    // Look up the active session for this trip so the confirmation row
    // is filed under the right thread (powers the dashboard timeline).
    const { data: session } = await admin
      .from('trip_sessions')
      .select('id')
      .eq('trip_id', tripId)
      .in('status', ['ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const planner = plannerFirstName ?? 'your planner';
    const dest = trip.destination ? ` to ${trip.destination}` : '';
    // TODO: re-append `: ${surveyBase}/respond/${trip.share_token}` once a
    // custom domain replaces netlify.app (carriers filter free-tier hosts).
    const body = rsvp === 'out'
      ? `Thanks for letting us know. ${planner} has been notified you can't make the trip${dest}. No more nudges from me.`
      : `Got it — your survey for ${planner}'s trip${dest} is in. I'll text once the plan is locked. To update: tap your survey link anytime.`;

    // Per-day idempotency key prevents double-send when the survey is
    // re-submitted in quick succession.
    const dayBucket = new Date().toISOString().slice(0, 10);
    const idem = `survey_confirm:${tripId}:${phone}:${dayBucket}`;

    const result = await sendDm(admin, phone, body, {
      tripSessionId: session?.id ?? null,
      idempotencyKey: idem,
      senderRole: 'rally_survey_confirm',
    });

    return jsonResponse({ ok: !result.error, sid: result.sid, error: result.error });
  } catch (err) {
    console.error('[sms-survey-confirmation] fatal:', err);
    return jsonResponse({ ok: false, reason: 'fatal', error: String(err) }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
