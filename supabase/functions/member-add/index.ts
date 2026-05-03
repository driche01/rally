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
import { getPublishableKey } from '../_sms-shared/api-keys.ts';
import { sendDm } from '../_sms-shared/dm-sender.ts';
import { initialOutreachSms } from '../_sms-shared/templates.ts';
import { personalizeBody } from '../_sms-shared/personalize.ts';
import { normalizePhone } from '../_sms-shared/phone.ts';
import { captureError, track } from '../_sms-shared/telemetry.ts';
import { computeCadence, filterCadenceForJoiner } from '../_sms-shared/cadence.ts';

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
    const anonKey     = getPublishableKey();
    if (!supabaseUrl || !anonKey) {
      console.error('[member-add] missing SUPABASE_URL / publishable key');
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
    // Pulls every field that flows into the initial outreach SMS so the
    // late-add member receives the *same* first text the rest of the
    // group got — i.e. either the planner's custom_intro_sms (if set) or
    // the canonical initialOutreachSms template, both with placeholders
    // resolved against the live trip.
    const { data: trip } = await admin
      .from('trips')
      .select('id, name, created_by, share_token, destination, responses_due_date, custom_intro_sms')
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
    // created_at is the cadence anchor — used below to seed late-joiner
    // nudge_sends rows in lockstep with the rest of the group.
    const { data: session } = await admin
      .from('trip_sessions')
      .select('id, created_at')
      .eq('trip_id', tripId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const sessionRow = session as { id?: string; created_at?: string } | null;
    const tripSessionId = sessionRow?.id ?? null;
    const sessionCreatedAt = sessionRow?.created_at ?? null;

    // ─── Upsert trip_session_participants ──────────────────────────────
    // Without this, the late-add member exists as a respondent but NOT
    // as a participant. The nudge scheduler only iterates participants,
    // so they'd silently miss every cadence nudge after the welcome SMS
    // we send below. Mirror the upsert shape from app_add_trip_contacts
    // (migration 078) so re-adding a removed/opted-out member flips
    // them back to active.
    //
    // Captured from the upsert below and used to seed the late-joiner's
    // nudge_sends rows so they show up on the planner dashboard
    // immediately, rather than waiting for the next sms-nudge-scheduler
    // cron tick to pick them up.
    let upsertedParticipantId: string | null = null;
    let upsertedParticipantIsPlanner = false;
    let upsertedParticipantJoinedAt: string | null = null;

    // If the trip has no live session yet (rare — the planner would
    // have to hit member-add before create-sms-session resolved), the
    // participant upsert is impossible. Bail with a clear reason so the
    // caller can show a real error instead of a silent partial success
    // (respondent created, but no participant → no nudges).
    if (!tripSessionId) {
      return jsonResponse({
        ok: false,
        reason: 'no_active_session',
        respondent_id: respondentId,
      }, 200);
    }

    // find-or-create users row keyed on phone
    let participantUserId: string | null = null;
    {
      const { data: existingUser } = await admin
        .from('users')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();
      if (existingUser) {
        participantUserId = (existingUser as { id: string }).id;
        if (rawName) {
          // Refresh display_name only if currently null/empty — don't
          // clobber a name another planner / claim flow already set.
          await admin
            .from('users')
            .update({ display_name: rawName })
            .eq('id', participantUserId)
            .or('display_name.is.null,display_name.eq.');
        }
      } else {
        const { data: newUser, error: userInsertErr } = await admin
          .from('users')
          .insert({
            phone,
            display_name: rawName || null,
            rally_account: false,
            opted_out: false,
          })
          .select('id')
          .single();
        if (!userInsertErr && newUser) {
          participantUserId = (newUser as { id: string }).id;
        }
        // Note: participantUserId stays null on failure — the
        // participant insert below tolerates that (user_id is
        // nullable). If the participant insert then also fails,
        // we surface the error and the caller can retry.
      }
    }

    // Mirror migration 078's CASE-preserving conflict path: if the
    // conflicting row is the planner, don't demote their status; for
    // everyone else, flip them back to active. is_attending is always
    // set true (re-add intent). display_name is preserved when the
    // existing row already has one — don't clobber.
    const { data: existingPart } = await admin
      .from('trip_session_participants')
      .select('id, status, is_planner, display_name, joined_at')
      .eq('trip_session_id', tripSessionId)
      .eq('phone', phone)
      .maybeSingle();
    if (existingPart) {
      const ep = existingPart as {
        id: string; status: string; is_planner: boolean;
        display_name: string | null; joined_at: string;
      };
      const nextStatus = ep.is_planner ? ep.status : 'active';
      const nextDisplay = ep.display_name && ep.display_name.length > 0
        ? ep.display_name
        : (rawName || null);
      const { error: updateErr } = await admin
        .from('trip_session_participants')
        .update({
          status: nextStatus,
          is_attending: true,
          display_name: nextDisplay,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ep.id);
      if (updateErr) {
        // Bail before sending any SMS. Returning ok=false lets the
        // caller surface a real error; the respondent row is left
        // intact (the welcome SMS hasn't fired yet, so there's
        // nothing to undo, and a retry will reuse the respondent).
        console.error('[member-add] participant update failed:', updateErr.message);
        return jsonResponse({
          ok: false,
          reason: 'participant_upsert_failed',
          detail: updateErr.message,
          respondent_id: respondentId,
        }, 200);
      }
      upsertedParticipantId = ep.id;
      upsertedParticipantIsPlanner = ep.is_planner;
      upsertedParticipantJoinedAt = ep.joined_at;
    } else {
      const { data: insertedPart, error: partInsertErr } = await admin
        .from('trip_session_participants')
        .insert({
          trip_session_id: tripSessionId,
          user_id:         participantUserId,
          phone,
          display_name:    rawName || null,
          status:          'active',
          is_attending:    true,
          is_planner:      false,
        })
        .select('id, joined_at')
        .single();
      if (partInsertErr || !insertedPart) {
        // Hard-fail. The previous "non-fatal warn-and-continue" path
        // led to silent orphans: respondent created + welcome SMS
        // fired but no participant row, so the nudge scheduler never
        // iterated them. The earlier comment claimed "nudge cadence
        // will catch up the next time the participant is reconciled"
        // — there is no such reconciliation job, so the row stayed
        // missing until a planner noticed days later.
        //
        // Bail before the SMS so a retry doesn't double-text. The
        // respondent row stays — it's needed for the survey link to
        // resolve and re-running member-add will reuse it.
        console.error(
          '[member-add] participant insert failed:',
          partInsertErr?.message ?? 'no row returned',
        );
        return jsonResponse({
          ok: false,
          reason: 'participant_upsert_failed',
          detail: partInsertErr?.message ?? 'insert returned no row',
          respondent_id: respondentId,
        }, 200);
      }
      const ip = insertedPart as { id: string; joined_at: string };
      upsertedParticipantId = ip.id;
      upsertedParticipantIsPlanner = false;
      upsertedParticipantJoinedAt = ip.joined_at;
    }

    // ─── Send the trip's initial outreach SMS ──────────────────────────
    // Late-add members get the *same* first text as the original group:
    // the planner's custom_intro_sms when set (with placeholders
    // resolved), otherwise the canonical initialOutreachSms template.
    // Mirrors buildSmsBody('initial', ...) in sms-nudge-scheduler so
    // the wording stays in lockstep regardless of which path fires the
    // first message.
    //
    // We also seed a nudge_sends row marked as already-sent so the
    // scheduler's seedSession pass + filterCadenceForJoiner combo
    // doesn't re-fire 'initial' on the next tick. (The filter drops
    // past 'initial' for late joiners, but inserting the sent marker is
    // belt-and-suspenders against any scheduler change that loosens the
    // filter window.)
    const tripCtx = trip as {
      destination: string | null;
      share_token: string;
      responses_due_date: string | null;
      custom_intro_sms: string | null;
      name: string | null;
    };
    const surveyHref = surveyUrl(tripCtx.share_token);
    const initialBody = (() => {
      const customSms = tripCtx.custom_intro_sms?.trim();
      if (customSms) {
        return personalizeBody(customSms, {
          recipientName: rawName || null,
          plannerName,
          destination: tripCtx.destination,
          tripName: tripCtx.name,
          surveyUrl: surveyHref,
        });
      }
      return initialOutreachSms({
        recipientName: rawName || null,
        plannerName,
        destination: tripCtx.destination,
        surveyUrl: surveyHref,
        responsesDueDate: tripCtx.responses_due_date,
      });
    })();
    const sendResult = await sendDm(admin, phone, initialBody, {
      tripSessionId,
      // Same idempotency shape as before so a planner double-tap doesn't
      // double-send. Keyed on (trip, phone) — re-adding the same person
      // hours later still no-ops within the dm-sender's 60s cache window.
      idempotencyKey: `member_add:${tripId}:${phone}`,
    });

    // Mark 'initial' as already-sent for this participant so the next
    // scheduler tick's seedSession pass treats it as done.
    if (upsertedParticipantId && sendResult.sid && !sendResult.error) {
      await admin.from('nudge_sends').insert({
        trip_session_id: tripSessionId,
        participant_id: upsertedParticipantId,
        nudge_type: 'initial',
        scheduled_for: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        message_sid: sendResult.sid,
      }).then(({ error }) => {
        // The unique partial index on (session, participant, kind)
        // makes this a no-op if a row already exists — which can
        // happen if a planner removes-then-readds someone.
        if (error && !/duplicate key/i.test(error.message)) {
          console.warn('[member-add] nudge_sends initial seed failed:', error.message);
        }
      });
    }

    // ─── Seed the rest of the cadence for the late joiner ──────────────
    // Without this, the new member's d1/d3/heartbeat/rd_minus_* rows
    // would only appear after the next sms-nudge-scheduler cron tick
    // (every 15 min). The planner dashboard's "Nudge schedule" card
    // would show the rest of the group but silently omit the just-added
    // member. Mirrors seedSession() in sms-nudge-scheduler/index.ts so
    // the late joiner slots into the same cadence as everyone else:
    //   - anchor on session.created_at (group lockstep)
    //   - filter out items that fell before the joiner arrived (with
    //     the standard 12h grace via filterCadenceForJoiner)
    //   - skip 'initial' (already handled above as already-sent)
    //   - skip planners (cadence is for non-planner members)
    //   - idempotent against the unique partial index on
    //     (session, participant, kind) WHERE NOT sent/skipped
    if (
      upsertedParticipantId &&
      !upsertedParticipantIsPlanner &&
      upsertedParticipantJoinedAt &&
      sessionCreatedAt &&
      tripCtx.responses_due_date
    ) {
      const items = computeCadence({
        launchAt: sessionCreatedAt,
        responsesDueDate: tripCtx.responses_due_date,
      });
      const filtered = filterCadenceForJoiner(items, upsertedParticipantJoinedAt);
      for (const it of filtered) {
        if (it.kind === 'initial') continue;
        const { data: existing } = await admin
          .from('nudge_sends')
          .select('id')
          .eq('trip_session_id', tripSessionId)
          .eq('participant_id', upsertedParticipantId)
          .eq('nudge_type', it.kind)
          .maybeSingle();
        if (existing) continue;
        const { error: insertErr } = await admin.from('nudge_sends').insert({
          trip_session_id: tripSessionId,
          participant_id: upsertedParticipantId,
          nudge_type: it.kind,
          scheduled_for: it.scheduledFor,
        });
        if (insertErr && !/duplicate key/i.test(insertErr.message)) {
          console.warn(
            `[member-add] nudge_sends ${it.kind} seed failed:`,
            insertErr.message,
          );
        }
      }
    }

    track('member_added_via_app', {
      distinct_id: tripId,
      tripId,
      respondentId,
      smsSent: !sendResult.error,
    }).catch(() => {});

    // Audit: planner-add events carry planner_intent context (who, what
    // phone) that the trigger-based member_joined event doesn't have.
    // Best-effort — never fails the request.
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
        kind: 'member_added_by_planner',
        payload: {
          respondent_id: respondentId,
          display_name: rawName || null,
          phone,
        },
      });
    } catch (auditErr) {
      console.warn('[member-add] audit emit failed:', auditErr);
    }

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
