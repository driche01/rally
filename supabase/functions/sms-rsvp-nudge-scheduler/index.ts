/**
 * Supabase Edge Function — sms-rsvp-nudge-scheduler
 *
 * Phase A Auto Reminder: follows up with invitees who haven't fully
 * RSVPed yet (status still 'invited' or 'maybe') 3 days after they
 * were invited.
 *
 * Per BUILD_QUESTIONS Q7 (RESOLVED with strict isolation): runs as a
 * NEW function rather than extending the legacy sms-nudge-scheduler.
 * Reuses the _sms-shared helpers (sendDm + personalize) so SMS body
 * formatting + opt-out + retry behavior stays consistent with the
 * existing rail.
 *
 * Per BUILD_QUESTIONS Q5 (RESOLVED, revised): reads/writes the
 * shared `thread_messages` table — not a new `sms_messages` queue.
 *   - Initial invitation SMS fires from /web/api/trips/[id]/invitations
 *     (Step 6) with message_type='rsvp_nudge'.
 *   - This function fires the +3d follow-up, also with
 *     message_type='rsvp_nudge'. Phase A caps at one follow-up; if
 *     this function sees ≥ 2 prior outbound rsvp_nudge entries for
 *     a phone+trip, it skips that respondent. Subsequent nudge
 *     types (profile_completion, booking_nudge, pre_trip_summary)
 *     are Phase C — explicitly out of Phase A scope.
 *
 * Deployment + cron
 *   supabase functions deploy sms-rsvp-nudge-scheduler --no-verify-jwt
 *
 *   Then schedule with pg_cron in the SQL editor (or via a separate
 *   migration). Recommended cadence: every 6 hours:
 *
 *     SELECT cron.schedule(
 *       'sms-rsvp-nudge-scheduler',
 *       '0 *_/ 6 * * *',                            -- (remove the _ in real use)
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
 *   { ok: true, scanned: <n>, fired: <n>, skipped: { dedupe: <n>,
 *     too_recent: <n>, capped: <n>, no_phone: <n> } }
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendDm } from '../_sms-shared/dm-sender.ts';
import { personalizeBody } from '../_sms-shared/personalize.ts';
import { getServiceRoleKey } from '../_sms-shared/api-keys.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Cadence config — knobs the planner team will probably tune in the
// first week of alpha.
const NUDGE_DELAY_MS    = 3 * 24 * 60 * 60 * 1000;  // 3 days since invited_at
const MIN_GAP_SINCE_LAST = 24 * 60 * 60 * 1000;     // don't double-send same day
const MAX_FOLLOWUPS     = 1;                         // Phase A cap

interface RespondentRow {
  id:                       string;
  trip_id:                  string;
  name:                     string;
  phone:                    string | null;
  rsvp_status:              string;
  rsvp_status_updated_at:   string | null;
  invited_at:               string | null;
}

interface TripRow {
  id:           string;
  name:         string;
  share_token:  string;
  destination:  string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const admin = getServiceRoleClient();
  const now = Date.now();
  const dueBefore = new Date(now - NUDGE_DELAY_MS).toISOString();

  // 1. Pull respondents ripe for a follow-up.
  const { data: respondents, error: respErr } = await admin
    .from('respondents')
    .select(
      'id, trip_id, name, phone, rsvp_status, rsvp_status_updated_at, invited_at',
    )
    .in('rsvp_status', ['invited', 'maybe'])
    .lte('invited_at', dueBefore)
    .not('phone', 'is', null);

  if (respErr) {
    return json({ ok: false, error: 'respondents_query_failed', detail: respErr.message }, 500);
  }
  const rows = (respondents ?? []) as RespondentRow[];

  if (rows.length === 0) {
    return json({ ok: true, scanned: 0, fired: 0, skipped: zeroSkipped() });
  }

  // 2. Batch-load the trips referenced.
  const tripIds = Array.from(new Set(rows.map((r) => r.trip_id)));
  const { data: tripsData } = await admin
    .from('trips')
    .select('id, name, share_token, destination')
    .in('id', tripIds);
  const trips = new Map<string, TripRow>(
    (tripsData ?? []).map((t) => [t.id as string, t as TripRow]),
  );

  // 3. For each respondent, check prior rsvp_nudge sends + apply caps.
  const skipped = zeroSkipped();
  let fired = 0;
  for (const r of rows) {
    if (!r.phone) { skipped.no_phone++; continue; }
    const trip = trips.get(r.trip_id);
    if (!trip) { skipped.too_recent++; continue; } // shouldn't happen

    const { data: priorSends } = await admin
      .from('thread_messages')
      .select('id, created_at')
      .eq('trip_id', r.trip_id)
      .eq('sender_phone', r.phone)
      .eq('direction', 'outbound')
      .eq('message_type', 'rsvp_nudge')
      .order('created_at', { ascending: false });

    const priorCount = priorSends?.length ?? 0;
    // Initial send (1 prior) is expected; we send the follow-up.
    // 2+ prior means we've already sent a follow-up. Cap.
    if (priorCount >= 1 + MAX_FOLLOWUPS) {
      skipped.capped++;
      continue;
    }
    // Don't pile on if the last send was less than 24h ago — defensive.
    const lastTs = priorSends?.[0]?.created_at;
    if (lastTs && (now - new Date(lastTs).getTime()) < MIN_GAP_SINCE_LAST) {
      skipped.too_recent++;
      continue;
    }

    const body = personalizeBody(buildFollowupBody(trip), {
      Name:        r.name.split(/\s+/)[0] ?? r.name,
      Trip:        trip.name,
      Destination: trip.destination ?? '',
      ['Survey link']: `${siteUrl()}/invite/${trip.share_token}`,
    });

    const send = await sendDm(admin, r.phone, body, {
      senderRole: 'rally',
    });

    // sendDm logs to thread_messages with trip_session_id (legacy
    // column) but doesn't know about our Phase A trip_id +
    // message_type columns. Patch the row it just created so the
    // scheduler dedupes correctly on the next run.
    if (send.sid) {
      await admin
        .from('thread_messages')
        .update({
          trip_id: r.trip_id,
          message_type: 'rsvp_nudge',
        })
        .eq('message_sid', send.sid);
      fired++;
    } else {
      skipped.too_recent++; // counted as "couldn't send" — body will
                            // be in the log via dm-sender anyway
    }
  }

  return json({
    ok: true,
    scanned: rows.length,
    fired,
    skipped,
  });
});

// ─── helpers ────────────────────────────────────────────────────────

function zeroSkipped() {
  return { dedupe: 0, too_recent: 0, capped: 0, no_phone: 0 };
}

function buildFollowupBody(trip: TripRow): string {
  // Voice: playful, personal, link-driven (per scope doc).
  return `👀 [Name], heads-up on [Trip]${
    trip.destination ? ` (${trip.destination})` : ''
  } — haven't seen your RSVP yet. Two taps: [Survey link]`;
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
