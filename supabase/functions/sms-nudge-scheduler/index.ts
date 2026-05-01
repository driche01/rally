/**
 * Supabase Edge Function — sms-nudge-scheduler
 *
 * The cadence engine for the survey-based 1:1 SMS pivot. Runs on a pg_cron
 * schedule (every 15 minutes). For each active trip session with a
 * book_by_date set, it:
 *
 *   1. SEED — ensures every active+attending participant has nudge_sends
 *      rows for the full cadence (initial + d1 + d3 + heartbeats + rd-2
 *      + rd-1). Idempotent via the unique partial index in migration 044.
 *
 *   2. FIRE — walks nudge_sends WHERE scheduled_for <= now()
 *      AND sent_at IS NULL AND skipped_at IS NULL. For each due row:
 *        - skip if the participant has responded (set skipped_at + reason)
 *        - skip if the participant is no longer active
 *        - otherwise send the SMS via sendDm and stamp sent_at + message_sid
 *
 * "Has responded" = a respondents row exists for this phone in this trip
 * with rsvp != null OR preferences IS NOT NULL.
 *
 * Manual + planner-driven nudges (kind = 'manual') are also fired here
 * — the dashboard "Send nudge now" action just inserts a row with
 * scheduled_for = now() and lets the next cron tick pick it up. (Or, for
 * lower latency, the dashboard can call this function directly via POST.)
 *
 * Deploy: supabase functions deploy sms-nudge-scheduler --no-verify-jwt
 *         (cron calls it with the service-role key — no user JWT.)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { computeCadence, type NudgeKind } from '../_sms-shared/cadence.ts';
import {
  initialOutreachSms,
  nudgeBody,
  synthHalfSms,
  synthFullSms,
  synthPreDueSms,
  type NudgeBodyOpts,
  type SynthBodyOpts,
} from '../_sms-shared/templates.ts';
import { sendDm, broadcast } from '../_sms-shared/dm-sender.ts';
import { personalizeBody } from '../_sms-shared/personalize.ts';
import { pushToPlanner } from '../_sms-shared/planner-notify.ts';
import { track, captureError } from '../_sms-shared/telemetry.ts';
import { getServiceRoleKey } from '../_sms-shared/api-keys.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ActiveSession {
  id: string;
  trip_id: string;
  planner_user_id: string | null;
  created_at: string;
}

interface Trip {
  id: string;
  share_token: string;
  destination: string | null;
  book_by_date: string | null;
  responses_due_date: string | null;
  custom_intro_sms: string | null;
  finalize_prompt_sent_at?: string | null;
}

interface Participant {
  id: string;
  trip_session_id: string;
  user_id: string | null;
  phone: string;
  display_name: string | null;
  status: string;
  is_attending: boolean;
  is_planner: boolean;
  joined_at: string;
}

interface DueRow {
  id: string;
  trip_session_id: string;
  participant_id: string | null;
  nudge_type: string;
  scheduled_for: string;
}

function surveyUrl(shareToken: string): string {
  const base = Deno.env.get('PUBLIC_SURVEY_BASE_URL') ?? 'https://rallysurveys.netlify.app';
  return `${base}/respond/${shareToken}`;
}

function resultsUrl(shareToken: string): string {
  const base = Deno.env.get('PUBLIC_SURVEY_BASE_URL') ?? 'https://rallysurveys.netlify.app';
  return `${base}/results/${shareToken}`;
}

/**
 * Has this phone meaningfully responded to the trip? "Meaningful" =
 *   - explicitly declined (rsvp='out')         → done, stop nudging
 *   - voted on at least one of the trip's polls → done
 *   - rsvp='in' AND preferences set            → done (full survey)
 *
 * Filling only the rsvp without engaging with polls is NOT enough — the
 * old definition (any rsvp OR any preferences) was too aggressive and
 * silently removed half-finished respondents from the cadence.
 *
 * Planner can use "Send nudge now" / "Pause nudges" to override either
 * way for an individual.
 */
async function hasResponded(
  admin: SupabaseClient,
  tripId: string,
  phone: string,
): Promise<boolean> {
  const { data: r } = await admin
    .from('respondents')
    .select('id, rsvp, preferences')
    .eq('trip_id', tripId)
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();
  if (!r) return false;

  // Explicit decline → done.
  if (r.rsvp === 'out') return true;

  // Full survey: rsvp='in' + preferences set.
  if (r.rsvp === 'in' && r.preferences) return true;

  // Or actually voted on at least one poll (catches users who skipped
  // the rsvp/prefs flow but engaged with the polls directly).
  const { data: anyVote } = await admin
    .from('poll_responses')
    .select('id')
    .eq('respondent_id', r.id)
    .limit(1)
    .maybeSingle();
  return Boolean(anyVote);
}

/**
 * SEED step: ensure cadence rows exist for every (active participant,
 * non-planner) of this session. Skips the planner — they're driving the
 * trip, not being nudged.
 */
async function seedSession(
  admin: SupabaseClient,
  session: ActiveSession,
  trip: Trip,
  participants: Participant[],
): Promise<{ inserted: number; skipped: number }> {
  if (!trip.responses_due_date) {
    return { inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;

  // Planners are normally excluded from cadence (they don't text
  // themselves about their own trip), but the trip-creation UI tells the
  // planner "Includes you automatically" — so for *fresh* trips we honor
  // that. The recency gate prevents backfilling SMS to planners on every
  // existing trip when this code ships.
  const PLANNER_INCLUSION_WINDOW_MS = 60 * 60 * 1000; // 1 hour
  const nowMs = Date.now();

  for (const p of participants) {
    if (p.status !== 'active' || !p.is_attending) {
      skipped++;
      continue;
    }
    if (p.is_planner) {
      const joinedMs = new Date(p.joined_at).getTime();
      if (Number.isNaN(joinedMs) || nowMs - joinedMs > PLANNER_INCLUSION_WINDOW_MS) {
        skipped++;
        continue;
      }
    }
    // Use the participant's joined_at as launch (so late joiners get a
    // fresh d0/d1/d3 from when they joined, not when the trip started).
    const launchAt = p.joined_at;
    const items = computeCadence({
      launchAt,
      responsesDueDate: trip.responses_due_date,
    });

    if (items.length === 0) continue;

    // Postgres `INSERT ... ON CONFLICT DO NOTHING` against a *partial*
    // unique index requires specifying the index_predicate, which the
    // Supabase JS SDK can't express cleanly. Do an explicit existence
    // check per (session, participant, kind) tuple, then insert. N+1 but
    // bounded by participants × kinds (~5–10 per session).
    //
    // Match ANY row regardless of sent/skipped status. Earlier this
    // filtered to pending rows only, which meant every poke-after-edit
    // would spawn a fresh "initial" nudge (the original was already
    // sent_at-set) and re-fire the welcome SMS. One-row-per-tuple is
    // the correct invariant — if a planner needs to re-fire something,
    // they should explicitly reset, not have it happen by side effect.
    for (const it of items) {
      const { data: existing } = await admin
        .from('nudge_sends')
        .select('id')
        .eq('trip_session_id', session.id)
        .eq('participant_id', p.id)
        .eq('nudge_type', it.kind)
        .maybeSingle();
      if (existing) continue;

      const { error: insertErr } = await admin.from('nudge_sends').insert({
        trip_session_id: session.id,
        participant_id: p.id,
        nudge_type: it.kind,
        scheduled_for: it.scheduledFor,
      });
      if (insertErr) {
        console.error('[scheduler] seed insert failed:', insertErr.message);
        continue;
      }
      inserted += 1;
      track('nudge_scheduled', {
        distinct_id: p.phone,
        nudge_kind: it.kind,
        scheduled_for: it.scheduledFor,
        trip_session_id: session.id,
        trip_model: '1to1',
      }).catch(() => {});
    }
  }

  return { inserted, skipped };
}

/** Build the SMS body for a due nudge row. */
function buildSmsBody(
  kind: string,
  trip: Trip,
  participant: Participant,
  plannerName: string | null,
): string {
  const opts: NudgeBodyOpts = {
    recipientName: participant.display_name,
    plannerName,
    destination: trip.destination,
    surveyUrl: surveyUrl(trip.share_token),
    responsesDueDate: trip.responses_due_date,
  };
  if (kind === 'initial') {
    const customSms = trip.custom_intro_sms?.trim();
    // The default `initialOutreachSms` already weaves recipient name in
    // server-side. The custom override is whatever the planner typed —
    // resolve any `[Their name]` placeholder so the literal string
    // doesn't go out.
    if (customSms) return personalizeBody(customSms, participant.display_name);
    return initialOutreachSms(opts);
  }
  if (kind === 'd1' || kind === 'd3' || kind === 'heartbeat'
      || kind === 'rd_minus_2' || kind === 'rd_minus_1') {
    return nudgeBody(kind as Exclude<NudgeKind, 'initial'>, opts);
  }
  // Unknown kinds (e.g. 'manual', 'lock_broadcast', 'holdout_lock') — caller
  // should set scheduled_for + body separately. Default to a generic prompt.
  return `${plannerName ?? 'Your planner'}'s trip survey: ${surveyUrl(trip.share_token)}`;
}

/**
 * FIRE step: walk due rows globally, send each. We pre-load context per
 * session to avoid N+1 lookups.
 */
async function fireDueNudges(admin: SupabaseClient): Promise<{ sent: number; skipped: number; errors: number }> {
  const { data: due, error } = await admin
    .from('nudge_sends')
    .select('id, trip_session_id, participant_id, nudge_type, scheduled_for')
    .lte('scheduled_for', new Date().toISOString())
    .is('sent_at', null)
    .is('skipped_at', null)
    .order('scheduled_for', { ascending: true })
    .limit(200); // safety cap per tick

  if (error) {
    console.error('[scheduler] due query failed:', error.message);
    return { sent: 0, skipped: 0, errors: 1 };
  }
  const dueRows = (due ?? []) as DueRow[];
  if (dueRows.length === 0) return { sent: 0, skipped: 0, errors: 0 };

  // Cache trip + participant lookups across rows in this tick.
  const tripBySession = new Map<string, { trip: Trip; plannerName: string | null }>();
  const participantById = new Map<string, Participant>();

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of dueRows) {
    try {
      // Resolve session → trip + planner name.
      let ctx = tripBySession.get(row.trip_session_id);
      if (!ctx) {
        const { data: ses } = await admin
          .from('trip_sessions')
          .select('id, trip_id, planner_user_id')
          .eq('id', row.trip_session_id)
          .maybeSingle();
        if (!ses) { skipped++; await skip(admin, row.id, 'session_missing'); continue; }
        const { data: trip } = await admin
          .from('trips')
          .select('id, share_token, destination, book_by_date, responses_due_date, custom_intro_sms')
          .eq('id', ses.trip_id)
          .maybeSingle();
        if (!trip) { skipped++; await skip(admin, row.id, 'trip_missing'); continue; }
        let plannerName: string | null = null;
        if (ses.planner_user_id) {
          const { data: pu } = await admin
            .from('users')
            .select('display_name')
            .eq('id', ses.planner_user_id)
            .maybeSingle();
          plannerName = pu?.display_name ?? null;
        }
        ctx = { trip: trip as Trip, plannerName };
        tripBySession.set(row.trip_session_id, ctx);
      }

      if (!row.participant_id) {
        skipped++; await skip(admin, row.id, 'no_participant'); continue;
      }

      let participant = participantById.get(row.participant_id);
      if (!participant) {
        const { data: p } = await admin
          .from('trip_session_participants')
          .select('id, trip_session_id, user_id, phone, display_name, status, is_attending, is_planner, joined_at')
          .eq('id', row.participant_id)
          .maybeSingle();
        if (!p) { skipped++; await skip(admin, row.id, 'participant_missing'); continue; }
        participant = p as Participant;
        participantById.set(row.participant_id, participant);
      }

      if (participant.status !== 'active' || !participant.is_attending) {
        skipped++; await skip(admin, row.id, 'participant_inactive'); continue;
      }

      // Already responded → skip (the whole point of the cadence).
      if (await hasResponded(admin, ctx.trip.id, participant.phone)) {
        skipped++; await skip(admin, row.id, 'already_responded'); continue;
      }

      const body = buildSmsBody(row.nudge_type, ctx.trip, participant, ctx.plannerName);
      const idem = `nudge:${row.id}`;
      const result = await sendDm(admin, participant.phone, body, {
        tripSessionId: row.trip_session_id,
        idempotencyKey: idem,
        senderRole: 'rally_nudge',
      });

      if (result.error) {
        errors++;
        console.error(`[scheduler] send failed for nudge ${row.id}:`, result.error);
        // Don't stamp sent_at; let the next tick retry. After ~3 ticks we'd
        // want to abandon — track an attempt counter (TODO) rather than retry
        // forever. For v1, allow retry indefinitely and rely on rate limits.
        continue;
      }

      await admin
        .from('nudge_sends')
        .update({ sent_at: new Date().toISOString(), message_sid: result.sid })
        .eq('id', row.id);

      sent++;
      track('nudge_sent', {
        distinct_id: participant.phone,
        nudge_kind: row.nudge_type,
        trip_session_id: row.trip_session_id,
        trip_model: '1to1',
      }).catch(() => {});
    } catch (err) {
      errors++;
      console.error('[scheduler] per-row exception:', err);
    }
  }

  return { sent, skipped, errors };
}

// ─── Synthesis milestones ───────────────────────────────────────────────────

/**
 * Milestone ranking — used to compare last sent vs. current eligibility.
 * Higher number = later in the lifecycle. Once 'full' has been sent, we
 * never reopen the queue with 'half' or 'pre_due'.
 */
const MILESTONE_RANK: Record<string, number> = {
  half:    1,
  pre_due: 2,
  full:    3,
};

interface SynthContext {
  trip: Trip;
  session: ActiveSession;
  plannerName: string | null;
  participants: Participant[];
}

async function topLeaderLabels(admin: SupabaseClient, tripId: string): Promise<string[]> {
  const { data: polls } = await admin
    .from('polls')
    .select('id, type, title')
    .eq('trip_id', tripId)
    .in('status', ['live', 'decided'])
    .in('type', ['destination', 'dates']);
  if (!polls || polls.length === 0) return [];

  const labels: string[] = [];
  for (const p of polls as { id: string; type: string }[]) {
    const { data: top } = await admin
      .from('poll_responses')
      .select('option_id')
      .eq('poll_id', p.id);
    const counts = new Map<string, number>();
    for (const r of (top ?? []) as { option_id: string }[]) {
      counts.set(r.option_id, (counts.get(r.option_id) ?? 0) + 1);
    }
    const winner = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    if (!winner) continue;
    const { data: opt } = await admin
      .from('poll_options')
      .select('label')
      .eq('id', winner[0])
      .maybeSingle();
    if (opt?.label) labels.push(opt.label);
  }
  return labels;
}

async function maybeSendSynthesis(
  admin: SupabaseClient,
  ctx: SynthContext,
): Promise<{ sent: boolean; milestone?: string }> {
  const { trip, session, participants, plannerName } = ctx;

  const eligible = participants.filter(
    (p) => p.status === 'active' && p.is_attending && !p.is_planner,
  );
  if (eligible.length === 0) return { sent: false };

  // Count responded against the same definition the FIRE pass uses.
  let respondedCount = 0;
  for (const p of eligible) {
    if (await hasResponded(admin, trip.id, p.phone)) respondedCount++;
  }

  const pct = respondedCount / eligible.length;
  const dueMs = new Date(trip.responses_due_date + 'T23:59:59').getTime();
  const hoursToDue = (dueMs - Date.now()) / (60 * 60 * 1000);

  let candidate: 'half' | 'full' | 'pre_due' | null = null;
  if (pct >= 1) candidate = 'full';
  else if (hoursToDue > 0 && hoursToDue <= 24 && respondedCount < eligible.length) candidate = 'pre_due';
  else if (pct >= 0.5) candidate = 'half';

  if (!candidate) return { sent: false };

  // Has this milestone (or a later one) already been sent?
  const { data: sessRow } = await admin
    .from('trip_sessions')
    .select('last_synth_milestone')
    .eq('id', session.id)
    .maybeSingle();
  const last = sessRow?.last_synth_milestone as string | null;
  if (last && (MILESTONE_RANK[last] ?? 0) >= MILESTONE_RANK[candidate]) {
    return { sent: false };
  }

  const leaders = await topLeaderLabels(admin, trip.id);
  const synthOpts: SynthBodyOpts = {
    plannerName,
    destination: trip.destination,
    resultsUrl: resultsUrl(trip.share_token),
    respondedCount,
    totalCount: eligible.length,
    leaders,
  };
  const body =
    candidate === 'full'    ? synthFullSms(synthOpts)
    : candidate === 'pre_due' ? synthPreDueSms(synthOpts)
    :                         synthHalfSms(synthOpts);

  // Fan out to ALL active+attending participants (including responders —
  // they want the progress update too). Idempotency key keeps a re-tick
  // from re-sending if the DB write below failed mid-flight.
  await broadcast(admin, session.id, body, {
    idempotencyKey: `synth:${session.id}:${candidate}`,
    senderRole: 'rally_synth',
    attendingOnly: true,
  });

  await admin
    .from('trip_sessions')
    .update({ last_synth_milestone: candidate, last_synth_sent_at: new Date().toISOString() })
    .eq('id', session.id);

  track('synthesis_sent', {
    distinct_id: session.id,
    trip_session_id: session.id,
    milestone: candidate,
    responded_count: respondedCount,
    total_count: eligible.length,
    trip_model: '1to1',
  }).catch(() => {});

  return { sent: true, milestone: candidate };
}

// ─── Skip helper ────────────────────────────────────────────────────────────

async function skip(admin: SupabaseClient, rowId: string, reason: string): Promise<void> {
  await admin
    .from('nudge_sends')
    .update({ skipped_at: new Date().toISOString(), skip_reason: reason })
    .eq('id', rowId);
  track('nudge_skipped', {
    distinct_id: rowId,
    nudge_id: rowId,
    skip_reason: reason,
    trip_model: '1to1',
  }).catch(() => {});
}

/**
 * SEED step entry: walk all active trip sessions with book_by set and
 * top off their cadence rows.
 */
async function seedAllActive(admin: SupabaseClient): Promise<{
  sessions: number; inserted: number; recommendations_created: number; synths_sent: number;
  finalize_prompts_fired: number;
  finalize_checks: Array<{ trip_id: string; ready: boolean; trigger: string | null; reason?: string; detail?: Record<string, unknown> }>;
}> {
  const { data: sessions, error } = await admin
    .from('trip_sessions')
    .select('id, trip_id, planner_user_id, created_at')
    .in('status', ['ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING'])
    .not('trip_id', 'is', null);
  if (error) {
    console.error('[scheduler] sessions query failed:', error.message);
    return { sessions: 0, inserted: 0, recommendations_created: 0, synths_sent: 0, finalize_prompts_fired: 0, finalize_checks: [] };
  }

  let totalInserted = 0;
  let sessionCount = 0;
  let recsCreated = 0;
  let synthsSent = 0;
  let finalizePromptsFired = 0;
  const finalizeChecks: Array<{ trip_id: string; ready: boolean; trigger: string | null; reason?: string; detail?: Record<string, unknown> }> = [];

  for (const ses of (sessions ?? []) as ActiveSession[]) {
    const { data: trip } = await admin
      .from('trips')
      .select('id, share_token, destination, book_by_date, responses_due_date, custom_intro_sms, finalize_prompt_sent_at')
      .eq('id', ses.trip_id)
      .maybeSingle();
    if (!trip || !trip.book_by_date || !trip.responses_due_date) continue;

    // Pull participants once — used by both seed + synthesis.
    const { data: participants } = await admin
      .from('trip_session_participants')
      .select('id, trip_session_id, user_id, phone, display_name, status, is_attending, is_planner, joined_at')
      .eq('trip_session_id', ses.id);

    // Resolve planner name once per session for synthesis copy.
    let plannerName: string | null = null;
    if (ses.planner_user_id) {
      const { data: pu } = await admin
        .from('users')
        .select('display_name')
        .eq('id', ses.planner_user_id)
        .maybeSingle();
      plannerName = pu?.display_name ?? null;
    }

    // Synthesis check runs every tick — independent of seed/recommendation.
    const synthResult = await maybeSendSynthesis(admin, {
      trip: trip as Trip,
      session: ses,
      plannerName,
      participants: (participants ?? []) as Participant[],
    }).catch((err) => {
      console.error('[scheduler] synth failed:', err);
      return { sent: false };
    });
    if (synthResult.sent) synthsSent++;

    // Phase 1 of the trip-finalize flow. Once everyone's weighed in (or
    // book_by_date hits), text the planner a deep link asking them to
    // review and lock the trip. trips.finalize_prompt_sent_at is the
    // idempotency guard — checked here AND inside the prompt function.
    if (!trip.finalize_prompt_sent_at) {
      const finalizeCheck = await isFinalizeReady(
        admin,
        trip as Trip,
        (participants ?? []) as Participant[],
      );
      console.log(
        `[scheduler] finalize-check trip=${trip.id} ready=${finalizeCheck.ready} ` +
          `trigger=${finalizeCheck.trigger ?? '-'} reason=${finalizeCheck.reason ?? '-'} ` +
          `detail=${JSON.stringify(finalizeCheck.detail ?? {})}`,
      );
      finalizeChecks.push({ trip_id: trip.id, ...finalizeCheck });
      if (finalizeCheck.ready) {
        // Make sure recommendations exist before pinging the planner —
        // the dashboard banner (Phase 2) will surface these.
        await generateRecommendationsForTrip(admin, trip.id).catch(() => 0);
        const fired = await fireFinalizePrompt(trip.id);
        if (fired) finalizePromptsFired++;
        track('finalize_prompt_fired', {
          distinct_id: trip.id,
          trip_id: trip.id,
          trigger: finalizeCheck.trigger,
          ok: fired,
          trip_model: '1to1',
        }).catch(() => {});
      }
    }

    // Auto-generate recommendations once responses_due is reached. The
    // responses-due-passes screen surfaces them to the planner; the
    // recommendation engine is idempotent (one pending row per poll).
    const due = new Date(trip.responses_due_date + 'T23:59:59').getTime();
    if (Date.now() >= due) {
      const created = await generateRecommendationsForTrip(admin, trip.id);
      recsCreated += created;
      // Past the deadline — no more nudges. Skip seeding.
      continue;
    }

    const result = await seedSession(admin, ses, trip as Trip, (participants ?? []) as Participant[]);
    totalInserted += result.inserted;
    sessionCount++;
  }

  return {
    sessions: sessionCount,
    inserted: totalInserted,
    recommendations_created: recsCreated,
    synths_sent: synthsSent,
    finalize_prompts_fired: finalizePromptsFired,
    finalize_checks: finalizeChecks,
  };
}

/**
 * Phase 1 of the trip-finalize flow: detect whether a trip is "ready to
 * lock". Two paths fire the prompt:
 *   1. book_by_date has been reached (today >= book_by_date)
 *   2. every active+attending non-planner participant has answered every
 *      poll on the trip whose status is not 'decided'
 *
 * Returns false when there are no undecided polls AND book_by hasn't
 * passed — in that case the planner has manually decided everything and
 * doesn't need a prompt to "review group input".
 */
async function isFinalizeReady(
  admin: SupabaseClient,
  trip: Trip,
  participants: Participant[],
): Promise<{
  ready: boolean;
  trigger: 'book_by_passed' | 'all_responded' | null;
  reason?: string;
  detail?: Record<string, unknown>;
}> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const bookByPassed = !!(trip.book_by_date && trip.book_by_date <= todayIso);

  const { data: undecidedPolls } = await admin
    .from('polls')
    .select('id')
    .eq('trip_id', trip.id)
    .neq('status', 'decided');
  const polls = ((undecidedPolls ?? []) as { id: string }[]);

  if (bookByPassed) return { ready: true, trigger: 'book_by_passed' };

  // No undecided polls + book_by not passed → planner already decided
  // everything; no review prompt needed.
  if (polls.length === 0) {
    return { ready: false, trigger: null, reason: 'no_undecided_polls' };
  }

  const members = participants.filter(
    (p) => p.status === 'active' && p.is_attending && !p.is_planner,
  );
  if (members.length === 0) {
    return { ready: false, trigger: null, reason: 'no_active_members' };
  }

  // Normalize phones on both sides — participant.phone is canonical e164,
  // but respondent.phone falls back to raw if un-normalizable, so do not
  // assume formats match without normalization.
  const memberPhones = new Set(members.map((m) => normalizeForJoin(m.phone)));

  const { data: respondents } = await admin
    .from('respondents')
    .select('id, phone')
    .eq('trip_id', trip.id);
  const resp = ((respondents ?? []) as { id: string; phone: string | null }[]);

  // Map normalized phone → respondent id (newest wins if duplicates).
  const respByPhone = new Map<string, string>();
  for (const r of resp) {
    if (!r.phone) continue;
    respByPhone.set(normalizeForJoin(r.phone), r.id);
  }

  const missingMembers: string[] = [];
  const respondentIds: string[] = [];
  for (const phone of memberPhones) {
    const rid = respByPhone.get(phone);
    if (!rid) missingMembers.push(phone);
    else respondentIds.push(rid);
  }
  if (missingMembers.length > 0) {
    return {
      ready: false,
      trigger: null,
      reason: 'members_without_respondent',
      detail: { missing_phones: missingMembers, member_count: members.length },
    };
  }

  const pollIds = polls.map((p) => p.id);
  const { data: votes } = await admin
    .from('poll_responses')
    .select('respondent_id, poll_id')
    .in('poll_id', pollIds)
    .in('respondent_id', respondentIds);
  const voteRows = ((votes ?? []) as { respondent_id: string; poll_id: string }[]);
  const have = new Set(voteRows.map((v) => `${v.respondent_id}:${v.poll_id}`));
  const missingVotes: Array<{ respondent_id: string; poll_id: string }> = [];
  for (const rid of respondentIds) {
    for (const pid of pollIds) {
      if (!have.has(`${rid}:${pid}`)) missingVotes.push({ respondent_id: rid, poll_id: pid });
    }
  }
  if (missingVotes.length > 0) {
    return {
      ready: false,
      trigger: null,
      reason: 'members_with_unanswered_polls',
      detail: { missing_count: missingVotes.length, sample: missingVotes.slice(0, 3) },
    };
  }
  return { ready: true, trigger: 'all_responded' };
}

function normalizeForJoin(phone: string | null): string {
  if (!phone) return '';
  return phone.replace(/[^\d+]/g, '').toLowerCase();
}

/**
 * Calls sms-trip-finalize-prompt to text the planner. The downstream
 * function double-checks finalize_prompt_sent_at server-side and stamps
 * it on success, so this call is safe to retry.
 */
async function fireFinalizePrompt(tripId: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) return false;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/sms-trip-finalize-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ trip_id: tripId }),
    });
    return res.ok;
  } catch (err) {
    console.error('[scheduler] finalize prompt invoke failed:', err);
    return false;
  }
}

/**
 * For every LIVE poll on the trip, ensure a recommendation row exists.
 * Calls the request_poll_recommendation RPC, which is idempotent: a
 * pending row blocks a duplicate insert via the unique partial index
 * on (poll_id) WHERE status = 'pending'.
 *
 * The RPC is SECURITY DEFINER + auth.uid()-gated, so it can't be called
 * with the service-role JWT (auth.uid() returns null). We replicate the
 * logic here as a service-role insert bypassing the auth check.
 */
async function generateRecommendationsForTrip(
  admin: SupabaseClient,
  tripId: string,
): Promise<number> {
  const { data: livePolls } = await admin
    .from('polls')
    .select('id')
    .eq('trip_id', tripId)
    .eq('status', 'live');
  if (!livePolls || livePolls.length === 0) return 0;

  let created = 0;
  for (const p of livePolls as { id: string }[]) {
    // Check if a pending row already exists.
    const { data: existing } = await admin
      .from('poll_recommendations')
      .select('id')
      .eq('poll_id', p.id)
      .eq('status', 'pending')
      .maybeSingle();
    if (existing) continue;

    // Use the RPC by impersonating the trip's planner via the service
    // role (we can't call SECURITY DEFINER from service-role and have
    // auth.uid() resolve). Instead, replicate the compute inline.
    const recRow = await computeRecommendationRow(admin, p.id, tripId);
    if (!recRow) continue;
    const { error } = await admin.from('poll_recommendations').insert(recRow);
    if (error) {
      console.warn('[scheduler] rec insert failed:', error.message);
      continue;
    }
    created++;
    track('recommendation_created', {
      distinct_id: tripId,
      poll_id: p.id,
      trip_id: tripId,
      confidence: recRow.confidence,
      holdout_count: Array.isArray(recRow.holdout_participant_ids) ? recRow.holdout_participant_ids.length : 0,
      trigger: 'responses_due_passed',
      trip_model: '1to1',
    }).catch(() => {});

    // Push the planner so they don't have to keep refreshing the dashboard.
    // Lookup is per-trip not per-poll because recommendations within a single
    // tick batch — one push per planner per trip is plenty.
    if (created === 1) {
      const { data: tripCtx } = await admin
        .from('trip_sessions')
        .select('planner_user_id, trip_id')
        .eq('trip_id', tripId)
        .in('status', ['ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (tripCtx?.planner_user_id) {
        const { data: tripMeta } = await admin
          .from('trips')
          .select('name')
          .eq('id', tripId)
          .maybeSingle();
        await pushToPlanner(admin, tripCtx.planner_user_id, {
          title: tripMeta?.name ? `${tripMeta.name}: ready to lock` : 'Trip: ready to lock',
          body: 'Rally has a recommendation ready in your decision queue.',
          data: {
            screen: `/(app)/trips/${tripCtx.trip_id}/members`,
            type: 'recommendation_ready',
            trip_id: tripCtx.trip_id,
          },
        }).catch(() => {});
      }
    }
  }
  return created;
}

async function computeRecommendationRow(
  admin: SupabaseClient,
  pollId: string,
  tripId: string,
): Promise<Record<string, unknown> | null> {
  const { data: poll } = await admin
    .from('polls')
    .select('id, status, type, trip_id')
    .eq('id', pollId)
    .maybeSingle();
  if (!poll || poll.status === 'decided') return null;

  // All option rows for this poll (label + position needed for the
  // works-for compute and the position-ASC tiebreak).
  const { data: optionsData } = await admin
    .from('poll_options')
    .select('id, label, position')
    .eq('poll_id', pollId);
  const allOptions = ((optionsData ?? []) as { id: string; label: string; position: number }[]);
  const positionByOption = new Map<string, number>();
  const labelByOption = new Map<string, string>();
  for (const o of allOptions) {
    positionByOption.set(o.id, o.position);
    labelByOption.set(o.id, o.label);
  }

  // Per-respondent vote sets. Lets us compute "respondents this option
  // works for" — which for budget polls factors in the implicit-acceptance
  // rule (a pick at position P implies acceptance of every cheaper option).
  const { data: votes } = await admin
    .from('poll_responses')
    .select('respondent_id, option_id')
    .eq('poll_id', pollId);
  const respondentPicks = new Map<string, Set<string>>();
  for (const v of (votes ?? []) as { respondent_id: string; option_id: string | null }[]) {
    if (!v.option_id) continue;
    if (!respondentPicks.has(v.respondent_id)) respondentPicks.set(v.respondent_id, new Set());
    respondentPicks.get(v.respondent_id)!.add(v.option_id);
  }
  const total = respondentPicks.size;

  // For each option, count distinct respondents the option works for.
  // Budget: a respondent's pick at position P means options 0..P all work.
  // Other polls: an option works for someone iff they explicitly picked it.
  const counts = new Map<string, number>();
  for (const o of allOptions) {
    let n = 0;
    for (const [, picks] of respondentPicks) {
      if (poll.type === 'budget') {
        // Did this respondent pick anything at-or-above O.position?
        let works = false;
        for (const pickId of picks) {
          const pickPos = positionByOption.get(pickId);
          if (pickPos !== undefined && pickPos >= o.position) { works = true; break; }
        }
        if (works) n++;
      } else if (picks.has(o.id)) {
        n++;
      }
    }
    counts.set(o.id, n);
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const pa = positionByOption.get(a[0]) ?? Number.MAX_SAFE_INTEGER;
    const pb = positionByOption.get(b[0]) ?? Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });
  const winnerId = sorted[0]?.[0] ?? null;
  const winnerCount = sorted[0]?.[1] ?? 0;
  const runnerUp = sorted[1]?.[1] ?? 0;
  const confidence = total > 0 ? Number(((winnerCount - runnerUp) / total).toFixed(2)) : null;
  const winnerLabel = winnerId ? labelByOption.get(winnerId) ?? null : null;

  // Holdouts: active+attending non-planner participants in the trip's
  // active session who haven't voted on this poll.
  const { data: ses } = await admin
    .from('trip_sessions')
    .select('id')
    .eq('trip_id', tripId)
    .in('status', ['ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let holdoutIds: string[] = [];
  if (ses) {
    const { data: parts } = await admin
      .from('trip_session_participants')
      .select('id, phone')
      .eq('trip_session_id', ses.id)
      .eq('status', 'active')
      .eq('is_attending', true)
      .eq('is_planner', false);
    const phones = (parts ?? []).map((p: { phone: string }) => p.phone);
    if (phones.length > 0) {
      const { data: voted } = await admin
        .from('respondents')
        .select('phone, poll_responses!inner(poll_id)')
        .eq('trip_id', tripId)
        .eq('poll_responses.poll_id', pollId)
        .in('phone', phones);
      const votedPhones = new Set((voted ?? []).map((v: { phone: string }) => v.phone));
      holdoutIds = (parts ?? [])
        .filter((p: { phone: string }) => !votedPhones.has(p.phone))
        .map((p: { id: string }) => p.id);
    }
  }

  const text = winnerLabel
    ? `${winnerLabel} works for ${winnerCount} of ${total} ${total === 1 ? 'respondent' : 'respondents'}${holdoutIds.length > 0 ? ` (${holdoutIds.length} still haven't voted)` : ''}.`
    : 'No clear leader yet — wait for more responses or pick manually.';

  const breakdown: Record<string, number> = {};
  for (const [k, v] of counts) breakdown[k] = v;

  return {
    poll_id: pollId,
    trip_id: tripId,
    recommended_option_id: winnerId,
    recommendation_text: text,
    vote_breakdown: breakdown,
    holdout_participant_ids: holdoutIds,
    confidence,
    status: 'pending',
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, reason: 'misconfigured' }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const seedResult = await seedAllActive(admin);
    const fireResult = await fireDueNudges(admin);
    return jsonResponse({
      ok: true,
      seed: seedResult,
      fire: fireResult,
    });
  } catch (err) {
    console.error('[scheduler] fatal:', err);
    captureError(err, { component: 'sms-nudge-scheduler' }).catch(() => {});
    return jsonResponse({ ok: false, reason: 'fatal', error: String(err) }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
