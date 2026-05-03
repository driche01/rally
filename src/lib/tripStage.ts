import type { Trip } from '@/types/database';
import { getEffectiveTripDates, type DatePollLike } from './tripDates';

export type TripStage =
  | 'deciding'
  | 'confirmed'
  | 'planning'
  | 'experiencing'
  | 'reconciling'
  | 'done';

export const STAGES: TripStage[] = [
  'deciding',
  'confirmed',
  'planning',
  'experiencing',
  'reconciling',
  'done',
];

/**
 * Narrative stage badges shown on the hero card and the trip-list cards
 * — the all-caps "story" copy. Single source of truth so the trip
 * detail screen and the trip-list dashboard read the same language at a
 * glance.
 */
export const STAGE_BADGE_LABEL: Record<TripStage, string> = {
  deciding:     'FIGURING IT OUT',
  confirmed:    'CONFIRMED',
  planning:     'PLANNING',
  experiencing: 'TRIP IS ON!',
  reconciling:  'SORTING IT OUT',
  done:         'WHAT A TRIP!',
};

/**
 * Derives the current trip stage from existing Trip fields — no extra DB column needed.
 *
 * Heuristics:
 *   done         → status === 'closed'
 *   reconciling  → end_date < today (trip over, still active)
 *   experiencing → start_date ≤ today ≤ end_date
 *   planning     → phase2_unlocked && trip hasn't started yet
 *   confirmed    → start_date + destination + budget_per_person + trip_type all set, phase2 not yet unlocked
 *   deciding     → default (still missing one or more of the above)
 *
 * `polls` is optional. When provided, the stage's date checks gate
 * through `getEffectiveTripDates` so a planner's pre-poll seed value on
 * trip.start_date doesn't prematurely flip the stage to `confirmed` /
 * `experiencing` while a date-range dates-poll is still up for vote. List
 * surfaces that don't have polls in scope (the trip-list dashboard) can
 * keep calling without polls; they'll see the slightly looser behavior,
 * which is fine for a card-level summary.
 */
export function getTripStage(
  trip: Pick<Trip, 'status' | 'start_date' | 'end_date' | 'phase2_unlocked' | 'destination' | 'budget_per_person' | 'trip_type'>,
  polls?: DatePollLike[],
): TripStage {
  if (trip.status === 'closed') return 'done';

  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

  // When polls are passed, use the date-locking gate so a planner-seed
  // value doesn't drive stage transitions before the dates poll decides.
  // Without polls we fall back to the raw trip-row dates (legacy callers).
  const { startDate: effStart, endDate: effEnd } = polls
    ? getEffectiveTripDates(trip, polls)
    : { startDate: trip.start_date, endDate: trip.end_date };

  if (effEnd && effEnd < today) return 'reconciling';
  if (effStart && effStart <= today && (!effEnd || effEnd >= today)) return 'experiencing';
  if (trip.phase2_unlocked) return 'planning';
  if (effStart && trip.destination && trip.budget_per_person && trip.trip_type) return 'confirmed';

  return 'deciding';
}

export function getStageIndex(stage: TripStage): number {
  return STAGES.indexOf(stage);
}

import { T } from '@/theme';

/**
 * Primary accent color for each stage — use for nav elements, CTAs, progress fills.
 *
 * 2026-04-24 brand: primary CTA = deep green across the whole app. Per-stage
 * differentiation (coral, blue, bright-green) was retired because (a) the
 * blue planning accent violated the "no blue" rule and (b) the trip-hub
 * stage banners already carry stage storytelling via their dark moody
 * backgrounds. Nav/CTA accents stay constant so the brand reads as one app
 * regardless of which stage you're looking at. Reconciling + done get a
 * quieter ink-tone since those stages are post-active.
 *
 * Source of truth: src/theme/colors.ts (T.*). Don't hardcode hex here.
 */
export const STAGE_ACCENT: Record<TripStage, string> = {
  deciding:     T.green,
  confirmed:    T.green,
  planning:     T.green,
  experiencing: T.green,
  reconciling:  T.muted,
  done:         T.ink,
};
