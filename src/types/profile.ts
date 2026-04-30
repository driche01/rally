/**
 * TravelerProfile — per-respondent answers to the post-survey
 * preference questions. Keyed off phone (E.164). See migration 062.
 *
 * The literal-string unions match the values stored in the DB. Question
 * options live alongside as labelled tuples so the UI can render them
 * without duplicating the option list.
 */

export type TravelPref =
  | 'with_group'
  | 'with_group_flexible'
  | 'separate'
  | 'no_pref';

export type FlightDealbreaker =
  | 'red_eye'
  | 'multi_stop'
  | 'early_dep'
  | 'late_arr';
// "None — flexible" is represented by an empty array, not a value.

export type SleepPref =
  | 'own_room'
  | 'own_bed'
  | 'share_bed'
  | 'flexible';

export type LodgingPref = 'hotel' | 'rental' | 'either';

export type DietaryRestriction =
  | 'vegetarian'
  | 'vegan'
  | 'gluten_free'
  | 'dairy_free'
  | 'allergies'
  | 'other';

export type MealPref = 'eat_out' | 'mixed' | 'cook_in' | 'no_pref';

export type DrinkingPref =
  | 'drinker_central'
  | 'casual'
  | 'sober_friendly'
  | 'low_no';

export type PhysicalLimitation =
  | 'limited_walking'
  | 'avoid_water'
  | 'avoid_intense'
  | 'other';

export type ActivityType =
  | 'food'
  | 'sightseeing'
  | 'culture'
  | 'outdoor'
  | 'nightlife'
  | 'wellness';

export type BudgetPosture = 'splurge' | 'middle' | 'budget' | 'flexible';

export interface TravelerProfile {
  phone: string;
  user_id: string | null;

  home_airport: string | null;
  travel_pref: TravelPref | null;
  flight_dealbreakers: FlightDealbreaker[];

  sleep_pref: SleepPref | null;
  lodging_pref: LodgingPref | null;

  dietary_restrictions: DietaryRestriction[];
  dietary_specifics: string | null;
  meal_pref: MealPref | null;
  drinking_pref: DrinkingPref | null;

  physical_limitations: PhysicalLimitation[];
  physical_specifics: string | null;
  trip_pace: 1 | 2 | 3 | 4 | null;
  activity_types: ActivityType[];

  budget_posture: BudgetPosture | null;

  notes: string | null;

  created_at: string;
  updated_at: string;
}

/** Empty-state profile for the form's initial render when no profile exists yet. */
export function emptyProfileDraft(phone: string): TravelerProfileDraft {
  return {
    phone,
    home_airport: null,
    travel_pref: null,
    flight_dealbreakers: [],
    sleep_pref: null,
    lodging_pref: null,
    dietary_restrictions: [],
    dietary_specifics: null,
    meal_pref: null,
    drinking_pref: null,
    physical_limitations: [],
    physical_specifics: null,
    trip_pace: null,
    activity_types: [],
    budget_posture: null,
    notes: null,
  };
}

/**
 * Form-state shape — strips DB-only fields (user_id, timestamps).
 * What the upsert RPC accepts as the JSON payload.
 */
export type TravelerProfileDraft = Omit<TravelerProfile, 'user_id' | 'created_at' | 'updated_at'>;

// ─── UI option lists ─────────────────────────────────────────────────────────
// Tuples of [value, label] so the form can render labels without
// duplicating the value-set elsewhere. Order matches the spec.

export const TRAVEL_PREF_OPTIONS: Array<[TravelPref, string]> = [
  ['with_group', 'Travel with the group'],
  ['with_group_flexible', "Travel with the group when it's easy, but okay splitting up"],
  ['separate', 'Book my own travel and meet everyone there'],
  ['no_pref', 'No preference'],
];

export const FLIGHT_DEALBREAKER_OPTIONS: Array<[FlightDealbreaker, string]> = [
  ['red_eye', 'Red-eyes'],
  ['multi_stop', 'More than one stop'],
  ['early_dep', 'Very early morning departures (before 7am)'],
  ['late_arr', 'Very late arrivals (after 10pm)'],
];

export const SLEEP_PREF_OPTIONS: Array<[SleepPref, string]> = [
  ['own_room', 'Need my own room'],
  ['own_bed', 'Okay sharing a room, need my own bed'],
  ['share_bed', 'Okay sharing a bed with the right person'],
  ['flexible', 'Flexible — couch, floor, whatever'],
];

export const LODGING_PREF_OPTIONS: Array<[LodgingPref, string]> = [
  ['hotel', 'Hotel'],
  ['rental', 'Airbnb / house rental'],
  ['either', 'Either works'],
];

export const DIETARY_OPTIONS: Array<[DietaryRestriction, string]> = [
  ['vegetarian', 'Vegetarian'],
  ['vegan', 'Vegan'],
  ['gluten_free', 'Gluten-free'],
  ['dairy_free', 'Dairy-free'],
  ['allergies', 'Allergies (specify)'],
  ['other', 'Other (specify)'],
];

export const MEAL_PREF_OPTIONS: Array<[MealPref, string]> = [
  ['eat_out', 'Mostly eat out'],
  ['mixed', 'Mix of eating out and cooking together'],
  ['cook_in', 'Mostly cook / eat in'],
  ['no_pref', 'No preference'],
];

export const DRINKING_PREF_OPTIONS: Array<[DrinkingPref, string]> = [
  ['drinker_central', "I drink — happy to build the trip around it"],
  ['casual', 'I drink casually'],
  ['sober_friendly', "I don't drink, but don't mind if others do"],
  ['low_no', "I'd prefer a low/no-alcohol trip"],
];

export const PHYSICAL_LIMITATION_OPTIONS: Array<[PhysicalLimitation, string]> = [
  ['limited_walking', 'Limited walking / hiking'],
  ['avoid_water', 'Avoid water activities'],
  ['avoid_intense', 'Avoid high-intensity activities'],
  ['other', 'Other (specify)'],
];

export const TRIP_PACE_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'Very chill, mostly relaxing',
  2: 'Light plans, lots of downtime',
  3: 'Balanced',
  4: 'Packed schedule, maximize the time',
};

export const TRIP_PACE_OPTIONS: Array<[1 | 2 | 3 | 4, string]> = [
  [1, TRIP_PACE_LABELS[1]],
  [2, TRIP_PACE_LABELS[2]],
  [3, TRIP_PACE_LABELS[3]],
  [4, TRIP_PACE_LABELS[4]],
];

export const ACTIVITY_TYPE_OPTIONS: Array<[ActivityType, string]> = [
  ['food', 'Food (restaurants, tastings, markets)'],
  ['sightseeing', 'Sightseeing (landmarks, views, neighborhoods)'],
  ['culture', 'Culture (museums, shows, sports, events)'],
  ['outdoor', 'Outdoor / adventure (hikes, water, excursions)'],
  ['nightlife', 'Nightlife (bars, clubs, going out)'],
  ['wellness', 'Wellness (spas, yoga, slow mornings)'],
];

export const BUDGET_POSTURE_OPTIONS: Array<[BudgetPosture, string]> = [
  ['splurge', 'The one pushing for nicer / splurgier options'],
  ['middle', 'Comfortable in the middle'],
  ['budget', 'The one keeping things budget-friendly'],
  ['flexible', 'Genuinely flexible — I go with the group'],
];
