/**
 * Supabase Edge Function — sms-lock-broadcast
 *
 * Targeted decision-lock broadcast. Splits recipients into "responders"
 * and "holdouts" so the holdouts get a tailored body that acknowledges
 * they haven't filled out the survey, and gives them a clear path back
 * (reach out to the planner / tap the survey link to update).
 *
 *   POST /sms-lock-broadcast
 *   Authorization: Bearer <user JWT>
 *   { trip_session_id, lock_label, poll_type, share_token }
 *
 * "Responder" = matches the scheduler's `hasResponded` definition
 * (rsvp='out' OR rsvp='in'+preferences OR has voted on a poll).
 *
 * Returns:
 *   { ok: true, sent_responders, sent_holdouts, failed }
 *
 * Deploy: supabase functions deploy sms-lock-broadcast
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getAdmin } from '../_sms-shared/supabase.ts';
import { getPublishableKey } from '../_sms-shared/api-keys.ts';
import { sendDm } from '../_sms-shared/dm-sender.ts';
import { captureError, track } from '../_sms-shared/telemetry.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Participant {
  id: string;
  user_id: string | null;
  phone: string;
  display_name: string | null;
  status: string;
  is_attending: boolean;
  is_planner: boolean;
}

async function hasResponded(admin: SupabaseClient, tripId: string, phone: string): Promise<boolean> {
  const { data: r } = await admin
    .from('respondents')
    .select('id, rsvp, preferences')
    .eq('trip_id', tripId)
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();
  if (!r) return false;
  if (r.rsvp === 'out') return true;
  if (r.rsvp === 'in' && r.preferences) return true;
  const { data: vote } = await admin
    .from('poll_responses')
    .select('id')
    .eq('respondent_id', r.id)
    .limit(1)
    .maybeSingle();
  return Boolean(vote);
}

function summaryUrl(shareToken: string): string {
  const base = Deno.env.get('PUBLIC_SURVEY_BASE_URL') ?? 'https://rallysurveys.netlify.app';
  return `${base}/summary/${shareToken}`;
}

function surveyUrl(shareToken: string): string {
  const base = Deno.env.get('PUBLIC_SURVEY_BASE_URL') ?? 'https://rallysurveys.netlify.app';
  return `${base}/respond/${shareToken}`;
}

function noun(pollType: string | null): string {
  return pollType === 'destination' ? 'destination'
    : pollType === 'dates'           ? 'dates'
    : pollType === 'budget'          ? 'budget'
    : 'plan';
}

function bodyForResponders(opts: { lockLabel: string; pollType: string | null; shareToken: string | null }): string {
  const link = opts.shareToken ? ` See the full plan: ${summaryUrl(opts.shareToken)}` : '';
  return `Locked in: ${opts.lockLabel} for the ${noun(opts.pollType)}.${link} Reply to your planner with any questions.`;
}

function bodyForHoldouts(opts: {
  lockLabel: string;
  pollType: string | null;
  shareToken: string | null;
  plannerName: string | null;
}): string {
  const planner = (opts.plannerName ?? '').trim().split(/\s+/)[0] || 'your planner';
  const link = opts.shareToken ? ` ${summaryUrl(opts.shareToken)}` : '';
  const survey = opts.shareToken ? ` Tap to update your answers: ${surveyUrl(opts.shareToken)}` : '';
  return (
    `The group locked in ${opts.lockLabel} for the ${noun(opts.pollType)}.${link} ` +
    `Let ${planner} know if you're still in.${survey}`
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ ok: false, reason: 'method_not_allowed' }, 405);

  const admin = getAdmin();

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return jsonResponse({ ok: false, reason: 'missing_auth' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = getPublishableKey();
    if (!supabaseUrl || !anonKey) {
      return jsonResponse({ ok: false, reason: 'misconfigured' }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ ok: false, reason: 'invalid_auth' }, 401);
    }
    const authUserId = userData.user.id;

    const payload = (await req.json().catch(() => null)) as
      | {
          trip_session_id?: unknown;
          lock_label?: unknown;
          poll_type?: unknown;
          share_token?: unknown;
        }
      | null;
    if (!payload) return jsonResponse({ ok: false, reason: 'invalid_body' }, 400);

    const tripSessionId = typeof payload.trip_session_id === 'string' ? payload.trip_session_id.trim() : '';
    const lockLabel = typeof payload.lock_label === 'string' ? payload.lock_label.trim() : '';
    const pollType = typeof payload.poll_type === 'string' ? payload.poll_type : null;
    const shareToken = typeof payload.share_token === 'string' ? payload.share_token : null;
    if (!tripSessionId || !lockLabel) {
      return jsonResponse({ ok: false, reason: 'missing_fields' }, 400);
    }

    // Resolve session + planner_user_id + trip_id for authorization.
    const { data: session } = await admin
      .from('trip_sessions')
      .select('id, trip_id, planner_user_id')
      .eq('id', tripSessionId)
      .maybeSingle();
    if (!session) return jsonResponse({ ok: false, reason: 'session_not_found' }, 200);

    let callerUsersId: string | null = null;
    {
      const { data: linked } = await admin
        .from('users')
        .select('id, display_name')
        .eq('auth_user_id', authUserId)
        .maybeSingle();
      callerUsersId = linked?.id ?? null;
    }

    let plannerName: string | null = null;
    if (session.planner_user_id) {
      const { data: pu } = await admin
        .from('users')
        .select('display_name')
        .eq('id', session.planner_user_id)
        .maybeSingle();
      plannerName = pu?.display_name ?? null;
    }

    let authorized = false;
    if (callerUsersId && callerUsersId === session.planner_user_id) authorized = true;
    if (!authorized && session.trip_id) {
      const { data: trip } = await admin
        .from('trips')
        .select('created_by')
        .eq('id', session.trip_id)
        .maybeSingle();
      if (trip?.created_by === authUserId) authorized = true;
    }
    if (!authorized) return jsonResponse({ ok: false, reason: 'forbidden' }, 200);

    // Pull active+attending participants and split into responders + holdouts.
    const { data: participants } = await admin
      .from('trip_session_participants')
      .select('id, user_id, phone, display_name, status, is_attending, is_planner')
      .eq('trip_session_id', tripSessionId)
      .eq('status', 'active')
      .eq('is_attending', true);
    const eligible = (participants ?? []) as Participant[];

    const responders: Participant[] = [];
    const holdouts: Participant[] = [];
    for (const p of eligible) {
      // Don't text the planner about their own decision.
      if (p.is_planner) continue;
      if (callerUsersId && p.user_id === callerUsersId) continue;
      const responded = session.trip_id ? await hasResponded(admin, session.trip_id, p.phone) : false;
      (responded ? responders : holdouts).push(p);
    }

    const responderBody = bodyForResponders({ lockLabel, pollType, shareToken });
    const holdoutBody = bodyForHoldouts({ lockLabel, pollType, shareToken, plannerName });

    let sentResponders = 0;
    let sentHoldouts = 0;
    const failed: { phone: string; error: string }[] = [];

    for (const r of responders) {
      const result = await sendDm(admin, r.phone, responderBody, {
        tripSessionId,
        idempotencyKey: `lock_responder:${tripSessionId}:${r.phone}:${lockLabel}`,
        senderRole: 'rally_lock_responder',
      });
      if (result.error) failed.push({ phone: r.phone, error: result.error });
      else sentResponders++;
    }
    for (const h of holdouts) {
      const result = await sendDm(admin, h.phone, holdoutBody, {
        tripSessionId,
        idempotencyKey: `lock_holdout:${tripSessionId}:${h.phone}:${lockLabel}`,
        senderRole: 'rally_lock_holdout',
      });
      if (result.error) failed.push({ phone: h.phone, error: result.error });
      else sentHoldouts++;
    }

    track('lock_broadcast_sent', {
      distinct_id: tripSessionId,
      trip_session_id: tripSessionId,
      sent_responders: sentResponders,
      sent_holdouts: sentHoldouts,
      failed: failed.length,
      poll_type: pollType,
      trip_model: '1to1',
      tailored: true,
    }).catch(() => {});

    return jsonResponse({
      ok: true,
      sent_responders: sentResponders,
      sent_holdouts: sentHoldouts,
      failed: failed.length,
    });
  } catch (err) {
    console.error('[sms-lock-broadcast] unhandled:', err);
    captureError(err, { component: 'sms-lock-broadcast' }).catch(() => {});
    return jsonResponse({ ok: false, reason: 'server_error' }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
