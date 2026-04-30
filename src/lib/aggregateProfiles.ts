/**
 * aggregateProfiles — turn a list of per-participant traveler profiles
 * into the planner-useful summaries shown on the Group Dashboard.
 *
 * Returns named slots (none/some/many semantics) so the UI can decide
 * which to render. Each slot includes the underlying counts so the
 * card can show a "3 of 5" style breakdown when the planner taps in.
 */
import type {
  ActivityType,
  BudgetPosture,
  DietaryRestriction,
  DrinkingPref,
  FlightDealbreaker,
  LodgingPref,
  MealPref,
  PhysicalLimitation,
  SleepPref,
  TravelPref,
  TravelerProfile,
} from '@/types/profile';
import {
  ACTIVITY_TYPE_OPTIONS,
  BUDGET_POSTURE_OPTIONS,
  DIETARY_OPTIONS,
  DRINKING_PREF_OPTIONS,
  FLIGHT_DEALBREAKER_OPTIONS,
  LODGING_PREF_OPTIONS,
  MEAL_PREF_OPTIONS,
  PHYSICAL_LIMITATION_OPTIONS,
  SLEEP_PREF_OPTIONS,
  TRAVEL_PREF_OPTIONS,
  TRIP_PACE_LABELS,
} from '@/types/profile';

interface Counted<T extends string> {
  value: T;
  label: string;
  count: number;
}

export interface ProfileAggregations {
  /** Total participants on the trip. */
  totalParticipants: number;
  /** Of `totalParticipants`, how many have a non-null profile. */
  filledProfiles: number;

  /** Top activity picks across the group, sorted desc by count. */
  topActivities: Counted<ActivityType>[];

  /** Average pace (1–4) and the count contributing to the average. */
  avgPace: { avg: number; sample: number } | null;

  /** Dominant lodging lean (most-picked option) + the spread. */
  lodging: { dominant: Counted<LodgingPref> | null; spread: Counted<LodgingPref>[] };

  /** Dominant meal preference. */
  meals: { dominant: Counted<MealPref> | null; spread: Counted<MealPref>[] };

  /** Sleep prefs spread. */
  sleep: { dominant: Counted<SleepPref> | null; spread: Counted<SleepPref>[] };

  /** Travel-with-group spread. */
  travel: { dominant: Counted<TravelPref> | null; spread: Counted<TravelPref>[] };

  /** Drinking spread. */
  drinking: { dominant: Counted<DrinkingPref> | null; spread: Counted<DrinkingPref>[] };

  /** Budget posture spread. */
  budget: { dominant: Counted<BudgetPosture> | null; spread: Counted<BudgetPosture>[] };

  /**
   * "Things to plan around" — flagged dietary restrictions, physical
   * limitations, and flight dealbreakers. Each row points to the people
   * with that flag (so the planner can drill in).
   */
  needs: {
    dietary: Counted<DietaryRestriction>[];
    physical: Counted<PhysicalLimitation>[];
    flightDealbreakers: Counted<FlightDealbreaker>[];
  };

  /** Unique home airports across the group, with counts. */
  airports: Array<{ iata: string; count: number }>;

  /** Anyone with a non-empty notes field. */
  notesCount: number;
}

function labelFor<T extends string>(options: Array<[T, string]>, value: T): string {
  return options.find(([v]) => v === value)?.[1] ?? value;
}

function countSingle<T extends string>(
  values: (T | null)[],
  options: Array<[T, string]>,
): Counted<T>[] {
  const map = new Map<T, number>();
  for (const v of values) {
    if (v === null) continue;
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, label: labelFor(options, value), count }))
    .sort((a, b) => b.count - a.count);
}

function countMulti<T extends string>(
  arrays: T[][],
  options: Array<[T, string]>,
): Counted<T>[] {
  const map = new Map<T, number>();
  for (const arr of arrays) {
    for (const v of arr) {
      map.set(v, (map.get(v) ?? 0) + 1);
    }
  }
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, label: labelFor(options, value), count }))
    .sort((a, b) => b.count - a.count);
}

export function aggregateProfiles(
  profiles: (TravelerProfile | null)[],
): ProfileAggregations {
  const totalParticipants = profiles.length;
  const filled = profiles.filter((p): p is TravelerProfile => p !== null);

  // Activities — multi-select, top picks
  const topActivities = countMulti(
    filled.map((p) => p.activity_types),
    ACTIVITY_TYPE_OPTIONS,
  ).slice(0, 4);

  // Pace — average across non-null
  const paces = filled.map((p) => p.trip_pace).filter((n): n is 1 | 2 | 3 | 4 => n !== null);
  const avgPace = paces.length > 0
    ? { avg: paces.reduce((s, n) => s + n, 0) / paces.length, sample: paces.length }
    : null;

  // Single-select aggregations with dominant + spread
  function single<T extends string>(
    values: (T | null)[],
    options: Array<[T, string]>,
  ): { dominant: Counted<T> | null; spread: Counted<T>[] } {
    const spread = countSingle(values, options);
    return { dominant: spread[0] ?? null, spread };
  }

  const lodging = single(filled.map((p) => p.lodging_pref), LODGING_PREF_OPTIONS);
  const meals = single(filled.map((p) => p.meal_pref), MEAL_PREF_OPTIONS);
  const sleep = single(filled.map((p) => p.sleep_pref), SLEEP_PREF_OPTIONS);
  const travel = single(filled.map((p) => p.travel_pref), TRAVEL_PREF_OPTIONS);
  const drinking = single(filled.map((p) => p.drinking_pref), DRINKING_PREF_OPTIONS);
  const budget = single(filled.map((p) => p.budget_posture), BUDGET_POSTURE_OPTIONS);

  // Things to plan around
  const dietary = countMulti(
    filled.map((p) => p.dietary_restrictions),
    DIETARY_OPTIONS,
  );
  const physical = countMulti(
    filled.map((p) => p.physical_limitations),
    PHYSICAL_LIMITATION_OPTIONS,
  );
  const flightDealbreakers = countMulti(
    filled.map((p) => p.flight_dealbreakers),
    FLIGHT_DEALBREAKER_OPTIONS,
  );

  // Airports
  const airportMap = new Map<string, number>();
  for (const p of filled) {
    if (!p.home_airport) continue;
    airportMap.set(p.home_airport, (airportMap.get(p.home_airport) ?? 0) + 1);
  }
  const airports = Array.from(airportMap.entries())
    .map(([iata, count]) => ({ iata, count }))
    .sort((a, b) => b.count - a.count);

  // Notes count
  const notesCount = filled.filter((p) => p.notes && p.notes.trim().length > 0).length;

  return {
    totalParticipants,
    filledProfiles: filled.length,
    topActivities,
    avgPace,
    lodging,
    meals,
    sleep,
    travel,
    drinking,
    budget,
    needs: { dietary, physical, flightDealbreakers },
    airports,
    notesCount,
  };
}

/** Format the average pace as `"3.2 — Balanced"` style label. */
export function formatPace(avgPace: ProfileAggregations['avgPace']): string {
  if (!avgPace) return 'No data';
  const rounded = Math.round(avgPace.avg) as 1 | 2 | 3 | 4;
  const decimals = avgPace.avg.toFixed(1);
  return `${decimals} — ${TRIP_PACE_LABELS[rounded]}`;
}
