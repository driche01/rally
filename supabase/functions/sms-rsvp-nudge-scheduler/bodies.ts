/**
 * Per-reminder-type SMS body builders.
 *
 * Voice principles (from scope doc): playful, personal, link-driven.
 * Keep each body under 320 chars so it fits in two segments worst-case
 * (one segment if all-ASCII and short).
 *
 * Personalization tokens consumed downstream by personalize.ts:
 *   [Name]         — recipient's first name
 *   [Trip]         — trip.name
 *   [Destination]  — trip.destination (optional, may be empty string)
 *   [Survey link]  — RSVP / dashboard link
 */

import type { TripRow } from './types.ts';

export function buildRsvpNudgeBody(trip: TripRow): string {
  return `👀 [Name], heads-up on [Trip]${
    trip.destination ? ` (${trip.destination})` : ''
  } — haven't seen your RSVP yet. Two taps: [Survey link]`;
}

export function buildProfileCompletionBody(trip: TripRow): string {
  return `[Name], one more thing for [Trip] — finish your travel profile so we can build the right itinerary for the group. Takes 25 sec: [Survey link]`;
}

export function buildBookingNudgeBody(trip: TripRow, missing: BookingGaps): string {
  // Phase C v1 framing: "log your status" — Rally tracks who's
  // bringing what (flight info, lodging preference), not actual
  // bookings (those are deep-link-out). The nudge is asking the
  // member to share their plan, not commit to a vendor.
  // missing: { lodging: bool, travel: bool }
  const ask: string =
    missing.travel && missing.lodging
      ? 'share your travel plan + weigh in on lodging'
      : missing.travel
        ? 'share your travel plan'
        : 'weigh in on lodging';
  return `hey [Name] — [Trip]${trip.destination ? ` (${trip.destination})` : ''} is getting close. quick ask: tap the page + ${ask} so the host can lock things in →  [Survey link]`;
}

export function buildPreTripSummaryBody(
  trip: TripRow,
  summary: PreTripSummary,
): string {
  // We pre-format the personalized summary into the body since this
  // type needs more variable content than the personalize.ts token set.
  const parts: string[] = [];
  parts.push(`✈️ [Name], [Trip] in 3 days.`);
  parts.push(summary.room_assigned ? '🛏 Room: assigned.' : '🛏 Room: NOT assigned.');
  parts.push(summary.travel_set    ? '🚗 Travel: set.'    : '🚗 Travel: NOT set.');
  if (summary.first_activity) parts.push(`🎯 First up: ${summary.first_activity}.`);
  parts.push(`Full plan: [Survey link]`);
  return parts.join(' ');
}

export function buildReEngagementBody(trip: TripRow, stallReason: string): string {
  // Goes to the planner specifically — voice shifts to "your trip"
  // rather than "the trip you're invited to." Phase C v1 framing
  // leans into the commitment-confirmation angle (not booking).
  return `hey [Name] — [Trip] looks stalled (${stallReason}). a quick blast to confirm who's still in would unstick it. open the dashboard → [Survey link]`;
}

export function buildCancellationNoticeBody(trip: TripRow): string {
  return `[Name] — [Trip]${trip.destination ? ` (${trip.destination})` : ''} has been cancelled by the host. Details + activity feed still live at: [Survey link]`;
}

// ─── shared shapes ───────────────────────────────────────────────

export interface BookingGaps {
  lodging: boolean;
  travel: boolean;
}

export interface PreTripSummary {
  room_assigned:  boolean;
  travel_set:     boolean;
  first_activity: string | null;
}
