/**
 * Supabase Edge Function — auto-remind
 *
 * Runs on a pg_cron schedule (daily at 9 AM UTC). For every trip where the
 * planner has toggled auto_remind ON, it:
 *   1. Skips trips that received a notification in the last 22 hours
 *   2. Runs the same nudge-scoring logic as generate-nudge
 *   3. If there are actionable nudges, sends an Expo push notification to
 *      each of the planner's registered devices
 *   4. Updates agent_settings.last_notified_at
 *
 * Deploy:  supabase functions deploy auto-remind
 *
 * Called by pg_cron via net.http_post with the service role key — no user JWT.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MIN_HOURS_BETWEEN_NOTIFS = 22;

// ─── Nudge scoring (mirrors generate-nudge logic) ─────────────────────────────

interface Nudge {
  id: string;
  title: string;
  subtitle: string;
}

function scoreNudges(
  stage: string,
  polls: { status: string }[],
  respondents: { rsvp_status: string | null }[],
  lodgingOptions: { status: string }[],
  travelLegs: unknown[],
  itineraryBlocks: unknown[],
  daysUntilTrip: number | null
): Nudge[] {
  const nudges: { nudge: Nudge; priority: number }[] = [];

  const livePolls = polls.filter((p) => p.status === 'live');
  const totalRespondents = respondents.length;
  const pendingRsvp = respondents.filter((r) => !r.rsvp_status || r.rsvp_status === 'pending').length;
  const confirmedRespondents = respondents.filter((r) => r.rsvp_status === 'confirmed').length;
  const hasBookedLodging = lodgingOptions.some((l) => l.status === 'booked');
  const hasLodgingOptions = lodgingOptions.length > 0;
  const hasTravelLegs = travelLegs.length > 0;
  const hasItinerary = itineraryBlocks.length > 0;

  if (stage === 'deciding') {
    if (livePolls.length > 0) {
      nudges.push({ priority: 1, nudge: { id: 'poll_reminder', title: `${livePolls.length} poll${livePolls.length > 1 ? 's' : ''} waiting for votes`, subtitle: 'Tap to send a reminder to your group' } });
    }
    if (polls.length === 0) {
      nudges.push({ priority: 2, nudge: { id: 'create_poll', title: 'No polls yet', subtitle: 'Start by creating a destination or dates poll' } });
    }
  }

  if (stage === 'confirmed') {
    if (pendingRsvp > 0) {
      nudges.push({ priority: 1, nudge: { id: 'rsvp_reminder', title: `${pendingRsvp} person${pendingRsvp > 1 ? 's' : ''} haven't confirmed`, subtitle: 'Send them a nudge to lock in their spot' } });
    }
    if (totalRespondents === 0) {
      nudges.push({ priority: 1, nudge: { id: 'invite_group', title: 'No one has joined yet', subtitle: 'Share your invite link to get the group in' } });
    }
    if (pendingRsvp === 0 && totalRespondents > 0) {
      nudges.push({ priority: 1, nudge: { id: 'all_confirmed', title: `Everyone's in — ${confirmedRespondents + 1} confirmed`, subtitle: 'Kick off planning with a group message' } });
    }
    if (!hasBookedLodging) {
      nudges.push({ priority: 2, nudge: { id: 'lodging', title: hasLodgingOptions ? 'Lodging not confirmed yet' : 'No lodging added yet', subtitle: hasLodgingOptions ? 'Time to pick one' : "Sort out where you're staying" } });
    }
    if (!hasTravelLegs) {
      nudges.push({ priority: 3, nudge: { id: 'travel', title: 'No travel added yet', subtitle: "Add how everyone's getting there" } });
    }
  }

  if (stage === 'planning') {
    if (!hasBookedLodging) {
      const urgency = daysUntilTrip !== null && daysUntilTrip < 30 ? ' — less than a month away!' : '';
      nudges.push({ priority: hasLodgingOptions ? 2 : 1, nudge: { id: 'lodging', title: hasLodgingOptions ? 'Lodging not confirmed yet' : 'No lodging added yet', subtitle: (hasLodgingOptions ? 'Time to pick one' : "Find a place to stay") + urgency } });
    }
    if (!hasTravelLegs && daysUntilTrip !== null && daysUntilTrip < 60) {
      nudges.push({ priority: 2, nudge: { id: 'travel', title: 'No travel legs added', subtitle: "Add flights, trains, or driving plans" } });
    }
    if (!hasItinerary && daysUntilTrip !== null && daysUntilTrip < 21) {
      nudges.push({ priority: 3, nudge: { id: 'itinerary', title: 'Itinerary not started', subtitle: 'Trip is less than 3 weeks away — build a plan' } });
    }
  }

  if (stage === 'experiencing') {
    if (!hasItinerary) {
      nudges.push({ priority: 1, nudge: { id: 'itinerary_live', title: "You're here — no itinerary yet", subtitle: "Add activities so the group knows what's on today" } });
    }
  }

  if (stage === 'reconciling') {
    nudges.push({ priority: 1, nudge: { id: 'settle_expenses', title: 'Time to settle up', subtitle: 'Review balances and mark splits as settled' } });
  }

  return nudges
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)
    .map((n) => n.nudge);
}

// ─── Expo push helper ─────────────────────────────────────────────────────────

async function sendExpoPush(tokens: string[], tripId: string, title: string, body: string) {
  if (tokens.length === 0) return;

  const messages = tokens.map((token) => ({
    to: token,
    title: 'Rally',
    body: title,
    subtitle: body,
    sound: 'default',
    data: { screen: `/(app)/trips/${tripId}`, type: 'auto_remind' },
  }));

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify(messages),
  });

  if (!res.ok) {
    console.error(`[auto-remind] Expo push failed for trip ${tripId}:`, await res.text());
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const now = new Date();
  const cutoff = new Date(now.getTime() - MIN_HOURS_BETWEEN_NOTIFS * 60 * 60 * 1000).toISOString();

  try {
    // 1. Find all trips with auto_remind = true that haven't been notified recently
    const { data: settings, error: settingsErr } = await admin
      .from('agent_settings')
      .select('id, trip_id, last_notified_at')
      .eq('auto_remind', true)
      .or(`last_notified_at.is.null,last_notified_at.lt.${cutoff}`);

    if (settingsErr) throw settingsErr;
    if (!settings || settings.length === 0) {
      return new Response(JSON.stringify({ sent: 0, skipped: 0, reason: 'no eligible trips' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    let sent = 0;
    let skipped = 0;

    for (const setting of settings) {
      const tripId = setting.trip_id;

      try {
        // 2. Fetch trip state
        const [tripRes, pollsRes, respondentsRes, lodgingRes, travelRes, itineraryRes] =
          await Promise.all([
            admin.from('trips').select('stage, start_date, name').eq('id', tripId).single(),
            admin.from('polls').select('status').eq('trip_id', tripId),
            admin.from('respondents').select('rsvp_status').eq('trip_id', tripId),
            admin.from('lodging_options').select('status').eq('trip_id', tripId),
            admin.from('trip_travel_legs').select('id').eq('trip_id', tripId).is('respondent_id', null),
            admin.from('itinerary_blocks').select('id').eq('trip_id', tripId),
          ]);

        const trip = tripRes.data;
        if (!trip) { skipped++; continue; }

        // Skip trips that are done
        if (trip.stage === 'done') { skipped++; continue; }

        const tripStart = trip.start_date ? new Date(trip.start_date + 'T12:00:00') : null;
        const daysUntilTrip = tripStart
          ? Math.round((tripStart.getTime() - now.getTime()) / 86400000)
          : null;

        // 3. Score nudges
        const nudges = scoreNudges(
          trip.stage ?? 'deciding',
          pollsRes.data ?? [],
          respondentsRes.data ?? [],
          lodgingRes.data ?? [],
          travelRes.data ?? [],
          itineraryRes.data ?? [],
          daysUntilTrip
        );

        if (nudges.length === 0) { skipped++; continue; }

        // 4. Get planner's user_id
        const { data: plannerMember } = await admin
          .from('trip_members')
          .select('user_id')
          .eq('trip_id', tripId)
          .eq('role', 'planner')
          .single();

        if (!plannerMember) { skipped++; continue; }

        // 5. Get planner's push tokens
        const { data: tokens } = await admin
          .from('push_tokens')
          .select('token')
          .eq('user_id', plannerMember.user_id);

        const tokenList = (tokens ?? []).map((t: { token: string }) => t.token);
        if (tokenList.length === 0) { skipped++; continue; }

        // 6. Send push notification with top nudge
        const topNudge = nudges[0];
        await sendExpoPush(tokenList, tripId, topNudge.title, topNudge.subtitle);

        // 7. Update last_notified_at
        await admin
          .from('agent_settings')
          .update({ last_notified_at: now.toISOString() })
          .eq('id', setting.id);

        sent++;
        console.log(`[auto-remind] Sent notification for trip ${tripId} (${trip.name})`);
      } catch (tripErr) {
        console.error(`[auto-remind] Error processing trip ${tripId}:`, tripErr);
        skipped++;
      }
    }

    return new Response(JSON.stringify({ sent, skipped }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[auto-remind] Fatal error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
