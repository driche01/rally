/**
 * Per-reminder-type triggering-condition validators.
 *
 * Each validator runs at send time on the queue-drain pass. If the
 * triggering condition that justified scheduling the reminder has
 * since resolved (user RSVPed, booked a flight, etc.), the validator
 * returns `{ proceed: false, reason }` and the scheduler marks the
 * row 'skipped' rather than sending.
 *
 * Validators return the data the body builder needs (e.g. booking
 * gaps) when they say proceed=true, so the scheduler doesn't fetch
 * the same data twice.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type {
  ReminderMessageType,
  RespondentRow,
  TripRow,
} from './types.ts';
import type { BookingGaps, PreTripSummary } from './bodies.ts';

export interface ConditionContext {
  admin:      SupabaseClient;
  trip:       TripRow;
  respondent: RespondentRow;
  now:        Date;
}

export type ConditionResult =
  | { proceed: false; reason: string }
  | { proceed: true;  payload: unknown };

export async function evaluateCondition(
  type: ReminderMessageType,
  ctx: ConditionContext,
): Promise<ConditionResult> {
  // Cancelled trips short-circuit every reminder type.
  if (ctx.trip.cancelled_at) {
    return { proceed: false, reason: 'trip_cancelled' };
  }

  switch (type) {
    case 'rsvp_nudge':                return await rsvpNudge(ctx);
    case 'profile_completion_nudge':  return await profileCompletion(ctx);
    case 'booking_nudge':             return await bookingNudge(ctx);
    case 'pre_trip_summary':          return await preTripSummary(ctx);
    case 're_engagement':             return await reEngagement(ctx);
  }
}

// ─── per-type validators ─────────────────────────────────────────

async function rsvpNudge(ctx: ConditionContext): Promise<ConditionResult> {
  const status = ctx.respondent.rsvp_status ?? 'invited';
  if (status === 'going' || status === 'cant_go') {
    return { proceed: false, reason: 'rsvp_resolved' };
  }
  // Body builder doesn't need anything beyond trip — payload empty.
  return { proceed: true, payload: null };
}

async function profileCompletion(ctx: ConditionContext): Promise<ConditionResult> {
  if (ctx.respondent.rsvp_status !== 'going') {
    return { proceed: false, reason: 'not_going' };
  }
  if (!ctx.respondent.phone) {
    // No phone → look up by user_id is the only resolution path,
    // and traveler_profiles is keyed on phone (Q2). Skip.
    return { proceed: false, reason: 'no_phone_for_profile_lookup' };
  }
  const { data: profile } = await ctx.admin
    .from('traveler_profiles')
    .select('home_airport, vibe_beach_or_mountain, vibe_spa_or_hike, vibe_foodie_or_casual, vibe_social_or_chill, vibe_culture_or_relaxation, budget_comfort')
    .eq('phone', ctx.respondent.phone)
    .maybeSingle();

  const incomplete =
    !profile ||
    !profile.home_airport ||
    !profile.vibe_beach_or_mountain ||
    !profile.vibe_spa_or_hike ||
    !profile.vibe_foodie_or_casual ||
    !profile.vibe_social_or_chill ||
    !profile.vibe_culture_or_relaxation ||
    !profile.budget_comfort;

  if (!incomplete) return { proceed: false, reason: 'profile_already_complete' };
  return { proceed: true, payload: null };
}

async function bookingNudge(ctx: ConditionContext): Promise<ConditionResult> {
  if (ctx.respondent.rsvp_status !== 'going') {
    return { proceed: false, reason: 'not_going' };
  }
  if (!ctx.trip.start_date) {
    return { proceed: false, reason: 'no_start_date' };
  }
  // Don't nudge if start is too close — pre_trip_summary takes over.
  const daysUntil = (new Date(ctx.trip.start_date).getTime() - ctx.now.getTime()) / 86_400_000;
  if (daysUntil < 3) return { proceed: false, reason: 'too_close' };

  // Has a travel arrangement?
  const { data: travel } = await ctx.admin
    .from('travel_arrangements')
    .select('id')
    .eq('respondent_id', ctx.respondent.id)
    .limit(1);
  // Has a lodging room assignment?
  const { data: room } = await ctx.admin
    .from('lodging_room_assignments')
    .select('id')
    .eq('respondent_id', ctx.respondent.id)
    .limit(1);

  const gaps: BookingGaps = {
    travel:  (travel?.length ?? 0) === 0,
    lodging: (room?.length   ?? 0) === 0,
  };
  if (!gaps.travel && !gaps.lodging) {
    return { proceed: false, reason: 'all_booked' };
  }
  return { proceed: true, payload: gaps };
}

async function preTripSummary(ctx: ConditionContext): Promise<ConditionResult> {
  if (ctx.respondent.rsvp_status !== 'going') {
    return { proceed: false, reason: 'not_going' };
  }

  const { data: room } = await ctx.admin
    .from('lodging_room_assignments')
    .select('id')
    .eq('respondent_id', ctx.respondent.id)
    .limit(1);
  const { data: travel } = await ctx.admin
    .from('travel_arrangements')
    .select('id')
    .eq('respondent_id', ctx.respondent.id)
    .limit(1);
  const { data: firstItem } = await ctx.admin
    .from('itinerary_blocks')
    .select('title, day_date, start_time')
    .eq('trip_id', ctx.trip.id)
    .order('day_date',   { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();

  const payload: PreTripSummary = {
    room_assigned:  (room?.length ?? 0) > 0,
    travel_set:     (travel?.length ?? 0) > 0,
    first_activity: firstItem?.title ?? null,
  };
  return { proceed: true, payload };
}

async function reEngagement(ctx: ConditionContext): Promise<ConditionResult> {
  // Re-engagement runs against the planner specifically (not whoever
  // the scheduled_reminders row points at — but in practice we
  // schedule these against the planner's own self-respondent row).
  if (!ctx.respondent.is_planner) {
    return { proceed: false, reason: 'not_planner' };
  }

  // Stall signals: confirm at least one still holds. The detection
  // job that schedules these will have already done this, but we
  // re-check at send time to avoid stale nudges.
  const stallSignals = await getStallSignals(ctx);
  if (stallSignals.length === 0) {
    return { proceed: false, reason: 'no_longer_stalled' };
  }
  return { proceed: true, payload: stallSignals[0] };
}

async function getStallSignals(ctx: ConditionContext): Promise<string[]> {
  const out: string[] = [];

  // Signal 1: no activity in 14 days AND start_date > 21d out.
  if (ctx.trip.start_date) {
    const daysUntilStart = (new Date(ctx.trip.start_date).getTime() - ctx.now.getTime()) / 86_400_000;
    if (daysUntilStart > 21) {
      const cutoff = new Date(ctx.now.getTime() - 14 * 86_400_000).toISOString();
      const { data: recent } = await ctx.admin
        .from('activity_feed_entries')
        .select('id')
        .eq('trip_id', ctx.trip.id)
        .gt('created_at', cutoff)
        .limit(1);
      if ((recent?.length ?? 0) === 0) {
        out.push("the feed's gone quiet");
      }
    }
  }

  // Signal 2: > 50% of going members have no lodging assignment
  // AND start_date < 30d. The signal is really about soft headcount
  // (you haven't slotted people into rooms because you're not sure
  // who's coming yet) — frame it that way so the planner SMS doesn't
  // sound like a vendor-booking nudge.
  if (ctx.trip.start_date) {
    const daysUntilStart = (new Date(ctx.trip.start_date).getTime() - ctx.now.getTime()) / 86_400_000;
    if (daysUntilStart < 30) {
      const { data: going } = await ctx.admin
        .from('respondents')
        .select('id')
        .eq('trip_id', ctx.trip.id)
        .eq('rsvp_status', 'going');
      const goingIds = (going ?? []).map((r) => r.id);
      if (goingIds.length > 0) {
        const { data: assigned } = await ctx.admin
          .from('lodging_room_assignments')
          .select('respondent_id')
          .in('respondent_id', goingIds);
        const assignedFrac = (assigned?.length ?? 0) / goingIds.length;
        if (assignedFrac < 0.5) {
          out.push("the headcount's still soft");
        }
      }
    }
  }

  // Signal 3: no itinerary items AND start_date < 21d.
  if (ctx.trip.start_date) {
    const daysUntilStart = (new Date(ctx.trip.start_date).getTime() - ctx.now.getTime()) / 86_400_000;
    if (daysUntilStart < 21) {
      const { data: items } = await ctx.admin
        .from('itinerary_blocks')
        .select('id')
        .eq('trip_id', ctx.trip.id)
        .limit(1);
      if ((items?.length ?? 0) === 0) {
        out.push("nothing's planned yet");
      }
    }
  }

  return out;
}
