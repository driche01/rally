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
  confirmed:    'Confirmed',
  planning:     'Planning',
  experiencing: 'Experiencing',
  reconciling:  'Reconciling',
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

/** Primary accent color for each stage — use for nav elements, CTAs, progress fills. */
export const STAGE_ACCENT: Record<TripStage, string> = {
  deciding:     '#D85A30',
  confirmed:    '#235C38',
  planning:     '#1A4060',
  experiencing: '#085041',
  reconciling:  '#666666',
  done:         '#2C2C2A',
};
