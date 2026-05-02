/**
 * API functions for F1 AI suggestions — lodging and travel.
 */

import { supabase } from '../supabase';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LodgingSuggestion {
  index: number;
  label: string;
  description: string;
  propertyType: string;
  idealFor: string;
  estimatedNightlyRate: string | null;
  platforms: ('airbnb' | 'vrbo' | 'booking')[];
  airbnbUrl: string | null;
  vrboUrl: string | null;
  bookingUrl: string | null;
}

export type RecommendedPlatform = 'airbnb' | 'vrbo' | 'booking' | 'mixed';

export interface LodgingSuggestionsResult {
  suggestions: LodgingSuggestion[];
  /** Platform highlighted to the planner based on the group's dominant lodging_pref. */
  recommendedPlatform: RecommendedPlatform;
  /** Aggregated dominant lodging_pref across the group's traveler profiles. */
  lodgingPref: 'hotel' | 'rental' | 'either';
}

export interface TravelSuggestion {
  index: number;
  mode: 'flight' | 'train' | 'car' | 'ferry' | 'bus' | 'other';
  label: string;
  description: string;
  estimatedDuration: string;
  estimatedCostPerPerson: string | null;
  pros: string[];
  cons: string[];
  searchUrl: string;
  bookingTip: string | null;
}

// ─── Lodging suggestions ───────────────────────────────────────────────────────

export interface LodgingSuggestionsOpts {
  /** Planner-supplied steering note ("more boutique hotels", "near the beach").
   *  When set, the edge function bypasses the trip-row cache (read AND write)
   *  and applies the note as an extra prompt directive. */
  note?: string;
}

export async function getLodgingSuggestions(
  tripId: string,
  opts: LodgingSuggestionsOpts = {},
): Promise<LodgingSuggestionsResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No active session');

  const note = opts.note?.trim() ?? '';
  const body: { trip_id: string; note?: string } = { trip_id: tripId };
  if (note.length > 0) body.note = note;

  const { data, error } = await supabase.functions.invoke('suggest-lodging', {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  const payload = (data ?? {}) as Partial<LodgingSuggestionsResult>;
  return {
    suggestions: payload.suggestions ?? [],
    recommendedPlatform: payload.recommendedPlatform ?? 'mixed',
    lodgingPref: payload.lodgingPref ?? 'either',
  };
}

// ─── Travel suggestions ────────────────────────────────────────────────────────

export interface TravelSuggestionsOpts {
  origin?: string;
  /**
   * When set, the edge function returns suggestions tailored to a single
   * traveler — using their saved home_airport + flight_dealbreakers instead
   * of the group-wide aggregation.
   */
  respondentPhone?: string;
}

export interface TravelSuggestionsResult {
  suggestions: TravelSuggestion[];
  /**
   * When `suggestions` is empty, the edge function may set a machine-readable
   * reason so the UI can give actionable guidance instead of a generic "tap to
   * retry". Currently used for `'no_origin'` (no home_airport on the planner /
   * single-person profile — the function refuses to hallucinate a city).
   */
  reason: string | null;
}

export async function getTravelSuggestions(
  tripId: string,
  opts: TravelSuggestionsOpts = {},
): Promise<TravelSuggestionsResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No active session');

  const { data, error } = await supabase.functions.invoke('suggest-travel', {
    body: {
      trip_id: tripId,
      origin: opts.origin ?? null,
      respondent_phone: opts.respondentPhone ?? null,
    },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  const payload = data as { suggestions?: TravelSuggestion[]; reason?: string };
  return { suggestions: payload.suggestions ?? [], reason: payload.reason ?? null };
}
