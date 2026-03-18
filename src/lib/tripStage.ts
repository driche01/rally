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
 *   confirmed    → start_date set but phase2 not yet unlocked
 *   deciding     → default (no dates, not unlocked)
 */
export function getTripStage(trip: Pick<Trip, 'status' | 'start_date' | 'end_date' | 'phase2_unlocked'>): TripStage {
  if (trip.status === 'closed') return 'done';

  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

  if (trip.end_date && trip.end_date < today) return 'reconciling';
  if (trip.start_date && trip.start_date <= today && (!trip.end_date || trip.end_date >= today)) return 'experiencing';
  if (trip.phase2_unlocked) return 'planning';
  if (trip.start_date) return 'confirmed';

  return 'deciding';
}

export function getStageIndex(stage: TripStage): number {
  return STAGES.indexOf(stage);
}
