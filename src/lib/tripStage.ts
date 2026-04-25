import type { Trip } from '@/types/database';

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

export const STAGE_LABEL: Record<TripStage, string> = {
  deciding:     'Deciding',
  confirmed:    "It's On!",
  planning:     'Planning',
  experiencing: "We're Here",
  reconciling:  'Wrapping Up',
  done:         'Done',
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
 */
export function getTripStage(trip: Pick<Trip, 'status' | 'start_date' | 'end_date' | 'phase2_unlocked' | 'destination' | 'budget_per_person' | 'trip_type'>): TripStage {
  if (trip.status === 'closed') return 'done';

  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

  if (trip.end_date && trip.end_date < today) return 'reconciling';
  if (trip.start_date && trip.start_date <= today && (!trip.end_date || trip.end_date >= today)) return 'experiencing';
  if (trip.phase2_unlocked) return 'planning';
  if (trip.start_date && trip.destination && trip.budget_per_person && trip.trip_type) return 'confirmed';

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
