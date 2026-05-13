/**
 * Supabase Edge Function — sms-rsvp-nudge-scheduler
 *
 * **Polyglot reminder scheduler** (Phase C, Q22).
 *
 * Reads pending rows from `scheduled_reminders` whose `scheduled_for`
 * is past, validates each row's triggering condition is still active,
 * sends via _sms-shared/dm-sender.ts, then marks 'sent' / 'skipped'.
 *
 * Phase A migration: a "shadow pass" at the top lazy-schedules
 * rsvp_nudge rows for any 'invited'/'maybe' respondent invited
 * ≥ 3 days ago that doesn't already have a row. This preserves
 * Phase A semantics with zero migration ceremony.
 *
 * Per BUILD_QUESTIONS Q22 (RESOLVED 2026-05-12): one polyglot
 * scheduler that switches on message_type. One pg_cron entry,
 * one deploy, one log stream.
 *
 * Per Q19 (RESOLVED 2026-05-12): SMS log goes to thread_messages,
 * not a new sms_messages table.
 *
 * Per Q23 (RESOLVED 2026-05-12): every send goes through
 * _sms-shared/dm-sender.ts which enforces users.opted_out.
 *
 * Deployment + cron
 *   supabase functions deploy sms-rsvp-nudge-scheduler --no-verify-jwt
 *
 *   Then schedule with pg_cron (every 30 min — short enough to
 *   keep quiet-hours rescheduling responsive, long enough to not
 *   thrash):
 *
 *     SELECT cron.schedule(
 *       'sms-rsvp-nudge-scheduler',
 *       '*_/30 * * * *',                              -- (remove the _ in real use)
 *       $$ SELECT net.http_post(
 *            url:='https://<project>.supabase.co/functions/v1/sms-rsvp-nudge-scheduler',
 *            headers:= jsonb_build_object('apikey', current_setting('app.service_role_key'))
 *          ); $$
 *     );
 *
 * Manual trigger
 *   curl -X POST https://<project>.supabase.co/functions/v1/sms-rsvp-nudge-scheduler \
 *     -H "apikey: <service-role>"
 *
 * Response shape
 *   {
 *     ok: true,
 *     lazy_scheduled: <n>,
 *     scanned: <n>,
 *     fired:   <n>,
 *     skipped: { <reason>: <count>, ... }
 *   }
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendDm } from '../_sms-shared/dm-sender.ts';
import { personalizeBody } from '../_sms-shared/personalize.ts';
import { getServiceRoleKey } from '../_sms-shared/api-keys.ts';
import {
  type ReminderMessageType,
  type ScheduledReminderRow,
  type TripRow,
  type RespondentRow,
  type TripReminderSettingsRow,
  settingEnabled,
} from './types.ts';
import { evaluateCondition } from './conditions.ts';
import {
  buildRsvpNudgeBody,
  buildProfileCompletionBody,
  buildBookingNudgeBody,
  buildPreTripSummaryBody,
  buildReEngagementBody,
  type BookingGaps,
  type PreTripSummary,
} from './bodies.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RSVP_NUDGE_DELAY_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const admin = getServiceRoleClient();
  const now = new Date();

  // ─── 1. Lazy-schedule pass (Phase A → Phase C migration glue) ────
  const lazyScheduled = await lazySchedule(admin, now);

  // ─── 2. Drain queue ──────────────────────────────────────────────
  const { data: due, error: dueErr } = await admin
    .from('scheduled_reminders')
    .select('id, trip_id, recipient_respondent_id, message_type, scheduled_for, status, sent_thread_message_id, attempted_at, skip_reason')
    .eq('status', 'pending')
    .lte('scheduled_for', now.toISOString())
    .limit(200);

  if (dueErr) {
    return json({ ok: false, error: 'queue_query_failed', detail: dueErr.message }, 500);
  }
  const queue = (due ?? []) as ScheduledReminderRow[];
  if (queue.length === 0) {
    return json({ ok: true, lazy_scheduled: lazyScheduled, scanned: 0, fired: 0, skipped: {} });
  }

  // ─── 3. Batch-load trips, respondents, settings ──────────────────
  const tripIds = Array.from(new Set(queue.map((q) => q.trip_id)));
  const respondentIds = Array.from(new Set(queue.map((q) => q.recipient_respondent_id)));

  const [tripsRes, respRes, settingsRes] = await Promise.all([
    admin.from('trips').select('id, name, share_token, destination, start_date, end_date, cancelled_at').in('id', tripIds),
    admin.from('respondents').select('id, trip_id, name, phone, email, is_planner, rsvp_status, rsvp_status_updated_at, invited_at, user_id').in('id', respondentIds),
    admin.from('trip_reminder_settings').select('*').in('trip_id', tripIds),
  ]);

  const trips = new Map<string, TripRow>((tripsRes.data ?? []).map((t) => [t.id as string, t as TripRow]));
  const respondents = new Map<string, RespondentRow>((respRes.data ?? []).map((r) => [r.id as string, r as RespondentRow]));
  const settings = new Map<string, TripReminderSettingsRow>((settingsRes.data ?? []).map((s) => [s.trip_id as string, s as TripReminderSettingsRow]));

  // ─── 4. Process each due reminder ────────────────────────────────
  const skipped: Record<string, number> = {};
  let fired = 0;

  for (const row of queue) {
    const trip = trips.get(row.trip_id);
    const respondent = respondents.get(row.recipient_respondent_id);
    const tripSettings = settings.get(row.trip_id) ?? null;

    if (!trip || !respondent) {
      await markSkipped(admin, row.id, 'missing_trip_or_respondent');
      bump(skipped, 'missing_trip_or_respondent');
      continue;
    }
    if (!respondent.phone) {
      await markSkipped(admin, row.id, 'no_phone');
      bump(skipped, 'no_phone');
      continue;
    }
    if (!settingEnabled(tripSettings, row.message_type)) {
      await markSkipped(admin, row.id, 'host_disabled_type');
      bump(skipped, 'host_disabled_type');
      continue;
    }

    // Condition validator: still need to send?
    const cond = await evaluateCondition(row.message_type, { admin, trip, respondent, now });
    if (!cond.proceed) {
      await markSkipped(admin, row.id, cond.reason);
      bump(skipped, cond.reason);
      continue;
    }

    // Build body.
    const body = buildBody(row.message_type, trip, cond.payload);
    if (!body) {
      await markSkipped(admin, row.id, 'body_build_failed');
      bump(skipped, 'body_build_failed');
      continue;
    }

    const finalBody = personalizeBody(body, {
      Name:        firstName(respondent.name),
      Trip:        trip.name,
      Destination: trip.destination ?? '',
      ['Survey link']: `${siteUrl()}/invite/${trip.share_token}`,
    });

    // Send via the shared rail. dm-sender enforces opt-out via
    // users.opted_out (per Q23).
    const send = await sendDm(admin, respondent.phone, finalBody, { senderRole: 'rally' });

    if (send.sid) {
      // Patch the thread_messages row so the scheduler dedupes
      // correctly on the next tick (same pattern as Phase A).
      let threadId: string | null = null;
      const { data: tm } = await admin
        .from('thread_messages')
        .update({ trip_id: trip.id, message_type: row.message_type })
        .eq('message_sid', send.sid)
        .select('id')
        .maybeSingle();
      threadId = tm?.id ?? null;

      await admin
        .from('scheduled_reminders')
        .update({
          status: 'sent',
          sent_thread_message_id: threadId,
          attempted_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq('id', row.id);
      fired++;
    } else {
      const reason = send.error ?? 'send_failed';
      await markSkipped(admin, row.id, reason);
      bump(skipped, reason);
    }
  }

  return json({
    ok: true,
    lazy_scheduled: lazyScheduled,
    scanned: queue.length,
    fired,
    skipped,
  });
});

// ─── lazy-scheduling Phase A → Phase C migration glue ────────────

async function lazySchedule(admin: SupabaseClient, now: Date): Promise<number> {
  const dueBefore = new Date(now.getTime() - RSVP_NUDGE_DELAY_MS).toISOString();

  const { data: candidates } = await admin
    .from('respondents')
    .select('id, trip_id, invited_at, rsvp_status, phone')
    .in('rsvp_status', ['invited', 'maybe'])
    .lte('invited_at', dueBefore)
    .not('phone', 'is', null)
    .limit(500);

  if (!candidates || candidates.length === 0) return 0;

  // Filter out respondents that already have any rsvp_nudge row.
  const respondentIds = candidates.map((c) => c.id);
  const { data: existing } = await admin
    .from('scheduled_reminders')
    .select('recipient_respondent_id')
    .eq('message_type', 'rsvp_nudge')
    .in('recipient_respondent_id', respondentIds);

  const haveScheduled = new Set((existing ?? []).map((e) => e.recipient_respondent_id));
  const toSchedule = candidates.filter((c) => !haveScheduled.has(c.id));
  if (toSchedule.length === 0) return 0;

  const rows = toSchedule.map((c) => ({
    trip_id: c.trip_id,
    recipient_respondent_id: c.id,
    message_type: 'rsvp_nudge' as ReminderMessageType,
    scheduled_for: now.toISOString(),
    status: 'pending',
  }));
  // UNIQUE constraint on (trip_id, recipient_respondent_id, message_type)
  // WHERE status='pending' protects us from races on overlapping ticks.
  const { error } = await admin.from('scheduled_reminders').insert(rows);
  if (error) {
    console.warn('[scheduler] lazy schedule failed:', error.message);
    return 0;
  }
  return rows.length;
}

// ─── body dispatch ────────────────────────────────────────────────

function buildBody(
  type: ReminderMessageType,
  trip: TripRow,
  payload: unknown,
): string | null {
  switch (type) {
    case 'rsvp_nudge':                return buildRsvpNudgeBody(trip);
    case 'profile_completion_nudge':  return buildProfileCompletionBody(trip);
    case 'booking_nudge':             return buildBookingNudgeBody(trip, payload as BookingGaps);
    case 'pre_trip_summary':          return buildPreTripSummaryBody(trip, payload as PreTripSummary);
    case 're_engagement':             return buildReEngagementBody(trip, payload as string);
  }
}

// ─── helpers ──────────────────────────────────────────────────────

function firstName(full: string): string {
  return full.split(/\s+/)[0] ?? full;
}

async function markSkipped(admin: SupabaseClient, id: string, reason: string): Promise<void> {
  await admin.from('scheduled_reminders').update({
    status: 'skipped',
    skip_reason: reason,
    attempted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id);
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function siteUrl(): string {
  return Deno.env.get('PUBLIC_SITE_URL')
    ?? Deno.env.get('NEXT_PUBLIC_SITE_URL')
    ?? 'https://rallysurveys.netlify.app';
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function getServiceRoleClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = getServiceRoleKey();
  return createClient(url, key, { auth: { persistSession: false } });
}
