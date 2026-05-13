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
  // missing: { lodging: bool, travel: bool }
  const parts: string[] = [];
  if (missing.lodging) parts.push('a room');
  if (missing.travel)  parts.push('your travel plan');
  const what = parts.length === 2 ? `${parts[0]} or ${parts[1]}` : parts[0] ?? 'a few things';
  return `[Name], [Trip]${trip.destination ? ` (${trip.destination})` : ''} is getting close and you haven't locked in ${what} yet. Tap to handle: [Survey link]`;
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
  // rather than "the trip you're invited to."
  return `[Name], [Trip] has been quiet — ${stallReason}. A blast from you would unstick it. Open the dashboard: [Survey link]`;
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
