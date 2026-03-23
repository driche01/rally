/**
 * Supabase Edge Function — generate-nudge
 *
 * Analyzes the current state of a trip and returns a prioritized list of
 * action items for the planner coach card. Stateless — no DB writes.
 *
 * Deploy:  supabase functions deploy generate-nudge
 *
 * POST body: { trip_id: string }
 * Requires: Authorization header with the planner's JWT
 *
 * Returns: { nudges: Nudge[] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export interface Nudge {
  id: string;         // stable key for the nudge scenario
  priority: number;   // 1 = highest
  title: string;
  subtitle: string;
  cta: string;        // button label
  ctaTarget: string;  // deep-link target: 'polls' | 'lodging' | 'travel' | 'itinerary' | 'expenses' | 'share' | 'agent_message:<scenario>'
  agentMessageScenario?: string; // if ctaTarget starts with 'agent_message:'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { trip_id } = await req.json();
    if (!trip_id) {
      return new Response(JSON.stringify({ error: 'trip_id required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── Fetch trip data ──────────────────────────────────────────────────────
    const [tripRes, pollsRes, respondentsRes, lodgingRes, travelRes, itineraryRes] =
      await Promise.all([
        supabase.from('trips').select('*').eq('id', trip_id).single(),
        supabase.from('polls').select('id, status, type, decided_option_id').eq('trip_id', trip_id),
        supabase.from('respondents').select('id, rsvp_status').eq('trip_id', trip_id),
        supabase.from('lodging_options').select('id, status').eq('trip_id', trip_id),
        supabase.from('trip_travel_legs').select('id').eq('trip_id', trip_id).is('respondent_id', null),
        supabase.from('itinerary_blocks').select('id').eq('trip_id', trip_id),
      ]);

    const trip = tripRes.data;
    if (!trip) {
      return new Response(JSON.stringify({ error: 'Trip not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const polls = pollsRes.data ?? [];
    const respondents = respondentsRes.data ?? [];
    const lodgingOptions = lodgingRes.data ?? [];
    const travelLegs = travelRes.data ?? [];
    const itineraryBlocks = itineraryRes.data ?? [];

    const stage = trip.stage ?? 'deciding';
    const tripStart = trip.start_date ? new Date(trip.start_date + 'T12:00:00') : null;
    const now = new Date();
    const daysUntilTrip = tripStart ? Math.round((tripStart.getTime() - now.getTime()) / 86400000) : null;

    // ── Derived state ────────────────────────────────────────────────────────
    const livePolls = polls.filter((p) => p.status === 'live');
    const decidedPolls = polls.filter((p) => p.status === 'decided');
    const undecidedPolls = polls.filter((p) => p.status !== 'decided');

    const totalRespondents = respondents.length;
    const confirmedRespondents = respondents.filter((r) => r.rsvp_status === 'confirmed').length;
    const pendingRsvp = respondents.filter((r) => !r.rsvp_status || r.rsvp_status === 'pending').length;

    const hasBookedLodging = lodgingOptions.some((l) => l.status === 'booked');
    const hasLodgingOptions = lodgingOptions.length > 0;
    const hasTravelLegs = travelLegs.length > 0;
    const hasItinerary = itineraryBlocks.length > 0;

    // ── Build nudges ─────────────────────────────────────────────────────────
    const nudges: Nudge[] = [];

    if (stage === 'deciding') {
      // Highest priority: get people to vote on live polls
      if (livePolls.length > 0) {
        nudges.push({
          id: 'poll_reminder',
          priority: 1,
          title: `${livePolls.length} poll${livePolls.length > 1 ? 's' : ''} waiting for votes`,
          subtitle: 'Send a nudge to your group to vote',
          cta: 'Send group reminder',
          ctaTarget: 'agent_message:poll_reminder',
          agentMessageScenario: 'poll_reminder',
        });
      }
      if (polls.length === 0) {
        nudges.push({
          id: 'create_poll',
          priority: 2,
          title: 'No polls yet',
          subtitle: 'Start by creating a destination or dates poll',
          cta: 'Create poll',
          ctaTarget: 'polls',
        });
      }
    }

    if (stage === 'confirmed') {
      // Priority 1: get group to confirm attendance
      if (pendingRsvp > 0) {
        nudges.push({
          id: 'rsvp_reminder',
          priority: 1,
          title: `${pendingRsvp} person${pendingRsvp > 1 ? 's' : ''} haven't confirmed`,
          subtitle: 'Send the confirmed plan and ask them to join',
          cta: 'Send confirmation request',
          ctaTarget: 'agent_message:plan_share',
          agentMessageScenario: 'plan_share',
        });
      }
      if (totalRespondents === 0) {
        nudges.push({
          id: 'invite_group',
          priority: 1,
          title: 'No one has joined yet',
          subtitle: 'Share your invite link so the group can confirm',
          cta: 'Share invite',
          ctaTarget: 'share',
        });
      }
      // Everyone confirmed — nudge to kick off planning thread
      if (pendingRsvp === 0 && totalRespondents > 0) {
        nudges.push({
          id: 'all_confirmed_summary',
          priority: 1,
          title: `Everyone's in — ${confirmedRespondents + 1} confirmed`,
          subtitle: 'Send the group a message to kick off planning',
          cta: 'Send trip summary',
          ctaTarget: 'agent_message:confirmed_group_summary',
          agentMessageScenario: 'confirmed_group_summary',
        });
      }
      // Lodging and travel nudges apply regardless of RSVP state
      if (!hasBookedLodging) {
        nudges.push({
          id: 'lodging_unconfirmed_confirmed_stage',
          priority: 2,
          title: hasLodgingOptions ? 'Lodging not confirmed yet' : 'No lodging added yet',
          subtitle: hasLodgingOptions
            ? `You have ${lodgingOptions.length} option${lodgingOptions.length > 1 ? 's' : ''} — time to pick one`
            : 'Sort out where you\'re staying',
          cta: hasLodgingOptions ? 'Review options' : 'Find lodging',
          ctaTarget: 'lodging',
        });
      }
      if (!hasTravelLegs) {
        nudges.push({
          id: 'travel_missing_confirmed_stage',
          priority: 3,
          title: 'No travel added yet',
          subtitle: 'Add how everyone\'s getting there',
          cta: 'Add travel',
          ctaTarget: 'travel',
        });
      }
    }

    if (stage === 'planning') {
      // Start new thread with confirmed group once everyone is in
      if (confirmedRespondents > 0 && pendingRsvp === 0) {
        nudges.push({
          id: 'group_summary',
          priority: 1,
          title: `Group is set — ${confirmedRespondents + 1} people confirmed`,
          subtitle: 'Kick off planning with a summary message to the group',
          cta: 'Send trip summary',
          ctaTarget: 'agent_message:confirmed_group_summary',
          agentMessageScenario: 'confirmed_group_summary',
        });
      }

      // Lodging
      if (!hasBookedLodging) {
        const urgency = daysUntilTrip !== null && daysUntilTrip < 30 ? '— trip is less than a month away!' : '';
        nudges.push({
          id: 'lodging_unconfirmed',
          priority: hasLodgingOptions ? 2 : 1,
          title: hasLodgingOptions ? 'Lodging not confirmed yet' : 'No lodging added yet',
          subtitle: hasLodgingOptions
            ? `You have ${lodgingOptions.length} option${lodgingOptions.length > 1 ? 's' : ''} — time to pick one ${urgency}`.trim()
            : `Find a place to stay ${urgency}`.trim(),
          cta: hasLodgingOptions ? 'Review options' : 'Find lodging',
          ctaTarget: 'lodging',
        });
      }

      // Travel
      if (!hasTravelLegs && daysUntilTrip !== null && daysUntilTrip < 60) {
        nudges.push({
          id: 'travel_missing',
          priority: 2,
          title: 'No travel legs added',
          subtitle: "Add your flights, trains, or driving plans so the group knows how everyone's getting there",
          cta: 'Add travel',
          ctaTarget: 'travel',
        });
      }

      // Itinerary
      if (!hasItinerary && daysUntilTrip !== null && daysUntilTrip < 21) {
        nudges.push({
          id: 'itinerary_missing',
          priority: 3,
          title: 'Itinerary not started',
          subtitle: 'Trip is less than 3 weeks away — build a day-by-day plan',
          cta: 'Build itinerary',
          ctaTarget: 'itinerary',
        });
      }
    }

    if (stage === 'experiencing') {
      if (!hasItinerary) {
        nudges.push({
          id: 'itinerary_missing_live',
          priority: 1,
          title: "You're here — no itinerary yet",
          subtitle: 'Add activities so the group knows what\'s on for today',
          cta: 'Add to itinerary',
          ctaTarget: 'itinerary',
        });
      }
    }

    if (stage === 'reconciling') {
      nudges.push({
        id: 'settle_expenses',
        priority: 1,
        title: 'Time to settle up',
        subtitle: 'Review balances and mark splits as settled',
        cta: 'Review expenses',
        ctaTarget: 'expenses',
      });
    }

    // Sort by priority
    nudges.sort((a, b) => a.priority - b.priority);

    return new Response(JSON.stringify({ nudges: nudges.slice(0, 3) }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('generate-nudge error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
