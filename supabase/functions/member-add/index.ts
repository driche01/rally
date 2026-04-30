/**
 * Supabase Edge Function — member-add
 *
 * Authenticated planners call this from the trip-edit screen / Group
 * Dashboard to add someone to the trip's roster. Creates (or reuses) a
 * respondent row and fires a one-shot welcome SMS containing the survey
 * link, so the new member can fill out the poll without waiting for the
 * YES handshake.
 *
 *   POST /member-add
 *   Authorization: Bearer <user JWT>
 *   { trip_id, phone, name? }
 *
 * Returns:
 *   200 { ok: true,  respondent_id, sms_sent }
 *   200 { ok: false, reason }      // user-facing reason
 *   400 missing/invalid fields
 *   401 unauthenticated
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getAdmin } from '../_sms-shared/supabase.ts';
import { sendDm } from '../_sms-shared/dm-sender.ts';
import { addedToTripSms } from '../_sms-shared/templates.ts';
import { normalizePhone } from '../_sms-shared/phone.ts';
import { captureError, track } from '../_sms-shared/telemetry.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function surveyUrl(shareToken: string): string {
  const base = Deno.env.get('PUBLIC_SURVEY_BASE_URL') ?? 'https://rallysurveys.netlify.app';
  return `${base}/respond/${shareToken}`;
}

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
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !anonKey) {
      console.error('[member-add] missing SUPABASE_URL / SUPABASE_ANON_KEY');
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
      | { trip_id?: unknown; phone?: unknown; name?: unknown }
      | null;
    if (!payload) {
      return jsonResponse({ ok: false, reason: 'invalid_body' }, 400);
    }
    const tripId = typeof payload.trip_id === 'string' ? payload.trip_id.trim() : '';
    const rawPhone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
    const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
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
      .select('id, created_by, share_token, destination')
      .eq('id', tripId)
      .maybeSingle();
    if (!trip) {
      return jsonResponse({ ok: false, reason: 'trip_not_found' }, 200);
    }
    if (trip.created_by !== authUserId) {
      return jsonResponse({ ok: false, reason: 'forbidden' }, 200);
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

    // ─── Reuse-or-create respondent ────────────────────────────────────
    // Match on (trip_id, phone) so re-adding the same phone updates the
    // name instead of creating a duplicate row.
    const { data: existing } = await admin
      .from('respondents')
      .select('id, name, session_token')
      .eq('trip_id', tripId)
      .eq('phone', phone)
      .maybeSingle();

    let respondentId: string;
    if (existing) {
      respondentId = (existing as { id: string }).id;
      if (rawName && (existing as { name: string }).name !== rawName) {
        await admin.from('respondents').update({ name: rawName }).eq('id', respondentId);
      }
    } else {
      const sessionToken = `manual_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      const { data: inserted, error: insertErr } = await admin
        .from('respondents')
        .insert({
          trip_id: tripId,
          name: rawName || phone,
          phone,
          session_token: sessionToken,
        })
        .select('id')
        .single();
      if (insertErr || !inserted) {
        console.error('[member-add] insert failed:', insertErr);
        return jsonResponse({ ok: false, reason: 'insert_failed' }, 500);
      }
      respondentId = (inserted as { id: string }).id;
    }

    // ─── Look up trip session for thread-message logging (if any) ──────
    const { data: session } = await admin
      .from('trip_sessions')
      .select('id')
      .eq('trip_id', tripId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const tripSessionId = (session as { id?: string } | null)?.id ?? null;

    // ─── Send welcome SMS ──────────────────────────────────────────────
    const body = addedToTripSms({
      recipientName: rawName || null,
      plannerName,
      destination: (trip as { destination?: string | null }).destination ?? null,
      surveyUrl: surveyUrl((trip as { share_token: string }).share_token),
    });
    const sendResult = await sendDm(admin, phone, body, {
      tripSessionId,
      idempotencyKey: `member_add:${tripId}:${phone}`,
    });

    track('member_added_via_app', {
      distinct_id: tripId,
      tripId,
      respondentId,
      smsSent: !sendResult.error,
    }).catch(() => {});

    return jsonResponse({
      ok: true,
      respondent_id: respondentId,
      sms_sent: !sendResult.error,
      sms_error: sendResult.error ?? null,
    }, 200);
  } catch (err) {
    console.error('[member-add] unhandled:', err);
    captureError(err, { component: 'member-add' }).catch(() => {});
    return jsonResponse({ ok: false, reason: 'server_error' }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
