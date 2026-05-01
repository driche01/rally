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
import { formatShortDate } from '../_sms-shared/templates.ts';
import { pushToPlanner } from '../_sms-shared/planner-notify.ts';

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
    // responses_due_date drives the "finalize by" framing in the body.
    const { data: trip } = await admin
      .from('trips')
      .select('id, name, destination, created_by, share_token, responses_due_date')
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
    // planner_user_id is needed for the opt-out push notification below.
    const { data: session } = await admin
      .from('trip_sessions')
      .select('id, planner_user_id')
      .eq('trip_id', tripId)
      .in('status', ['ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const planner = plannerFirstName ?? 'your planner';
    const dest = trip.destination ? ` to ${trip.destination}` : '';
    const finalizeBy = trip.responses_due_date
      ? ` ${planner} will finalize details by ${formatShortDate(trip.responses_due_date)}.`
      : '';
    const surveyBase = Deno.env.get('PUBLIC_SURVEY_BASE_URL') ?? 'https://rallysurveys.netlify.app';
    const surveyUrl = `${surveyBase}/respond/${trip.share_token}`;
    const body = rsvp === 'out'
      ? `Thanks for letting us know. ${planner} has been notified you can't make the trip${dest}. No more nudges from me.`
      : `Thanks — your survey for ${planner}'s trip${dest} is in.${finalizeBy} You'll receive updates on group progress. To update, tap the poll link anytime: ${surveyUrl}`;

    // Per-day idempotency key prevents double-send when the survey is
    // re-submitted in quick succession.
    const dayBucket = new Date().toISOString().slice(0, 10);
    const idem = `survey_confirm:${tripId}:${phone}:${dayBucket}`;

    const result = await sendDm(admin, phone, body, {
      tripSessionId: session?.id ?? null,
      idempotencyKey: idem,
      senderRole: 'rally_survey_confirm',
    });

    // Eagerly skip any pending nudges for this participant. The scheduler
    // also filters at fire time via hasResponded(), but skipping now keeps
    // the planner's CadenceCard accurate — no ghost "next nudge" entries
    // for a member who's already done.
    //
    // For 'out' submissions also flip is_attending=false. That's the single
    // toggle the rest of the broadcast stack (synthesis, lock-broadcast,
    // planner-authored sms-broadcast) reads to exclude someone — so flipping
    // it here is what actually stops their downstream SMS, beyond just the
    // nudge cadence.
    if (session?.id) {
      const { data: participant } = await admin
        .from('trip_session_participants')
        .select('id, display_name')
        .eq('trip_session_id', session.id)
        .eq('phone', phone)
        .maybeSingle();
      if (participant?.id) {
        await admin
          .from('nudge_sends')
          .update({ skipped_at: new Date().toISOString(), skip_reason: 'already_responded' })
          .eq('participant_id', participant.id)
          .is('sent_at', null)
          .is('skipped_at', null);

        // Symmetric flip — sets is_attending to match the rsvp. The 'in'
        // case re-enables anyone who previously opted out via the survey
        // and is changing their mind. Idempotent for already-attending
        // participants (rsvp='in' is the common path).
        await admin
          .from('trip_session_participants')
          .update({ is_attending: rsvp === 'in' })
          .eq('id', participant.id);

        // Phase 4.5a — push the planner when someone opts out via the
        // survey. Best-effort, never throws. Only fires on the 'out' edge:
        // 'in' submissions are the common case and don't warrant a push.
        if (rsvp === 'out' && session.planner_user_id) {
          const senderName = (participant.display_name ?? '').trim().split(/\s+/)[0] || 'Someone';
          const tripPhrase = trip.destination ? `the ${trip.destination} trip` : 'your trip';
          await pushToPlanner(admin, session.planner_user_id, {
            title: `${senderName} can't make it`,
            body: `${senderName} just opted out of ${tripPhrase} via the survey.`,
            data: {
              type: 'opt_out',
              trip_id: tripId,
              trip_session_id: session.id,
              participant_id: participant.id,
            },
          }).catch(() => {});
        }
      }
    }

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
