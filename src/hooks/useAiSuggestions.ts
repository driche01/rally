/**
 * React Query hooks for F1 AI suggestions — lodging and travel.
 */

import { useQuery, type QueryClient, type UseQueryOptions } from '@tanstack/react-query';
import {
  getLodgingSuggestions,
  getTravelSuggestions,
  type LodgingSuggestionsResult,
} from '@/lib/api/aiSuggestions';
import { getGroupLodgingPrefSummary, type GroupLodgingPrefSummary } from '@/lib/api/travelerProfiles';

// ─── Lodging suggestions ──────────────────────────────────────────────────────
//
// Lodging suggestions auto-fetch once the trip has enough context (destination
// + dates) and the planner is on the lodging tab. The query key includes the
// trip details that affect the recommendation plus a summary of the group's
// lodging-pref answers — when a late respondent flips the dominant pref from
// "rental" to "hotel", the key changes and react-query refetches.

export interface LodgingSuggestionsKeyDeps {
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  groupSize: number | null;
  budgetPerPerson: string | null;
  estimatedFlightCostPerPerson: number | null;
  /** Aggregated summary of the group's lodging_pref answers — drives the auto-refetch. */
  prefSummary: GroupLodgingPrefSummary | null;
  /** Planner-supplied steering note for re-rolls. Empty string and undefined
   *  both mean "no note" — they share the same canonical cache entry so
   *  clearing the textarea doesn't trigger a refetch. */
  note?: string;
}

const PREF_SUMMARY_STALE = 30_000;
const LODGING_SUGGESTIONS_STALE = 5 * 60_000;

function prefSummaryKey(tripId: string) {
  return ['group-lodging-pref-summary', tripId] as const;
}

function lodgingSuggestionsKey(tripId: string, deps: LodgingSuggestionsKeyDeps) {
  return [
    'lodging-suggestions',
    tripId,
    deps.destination,
    deps.startDate,
    deps.endDate,
    deps.groupSize,
    deps.budgetPerPerson,
    deps.estimatedFlightCostPerPerson,
    deps.prefSummary?.lastUpdatedAt ?? null,
    deps.prefSummary?.total ?? 0,
    // counts per option — flips in dominant pref change the key
    deps.prefSummary?.counts.hotel ?? 0,
    deps.prefSummary?.counts.rental ?? 0,
    deps.prefSummary?.counts.either ?? 0,
    // Steering note — empty/undefined collapse to the canonical key
    (deps.note ?? '').trim(),
  ] as const;
}

export function useGroupLodgingPrefSummary(tripId: string) {
  return useQuery({
    queryKey: prefSummaryKey(tripId),
    queryFn: () => getGroupLodgingPrefSummary(tripId),
    enabled: !!tripId,
    staleTime: PREF_SUMMARY_STALE,
  });
}

export function useGetLodgingSuggestions(
  tripId: string,
  deps: LodgingSuggestionsKeyDeps,
  opts?: { enabled?: boolean },
) {
  const enabled =
    (opts?.enabled ?? true) &&
    !!tripId &&
    !!deps.destination &&
    !!deps.startDate &&
    !!deps.endDate;

  const queryOpts: UseQueryOptions<LodgingSuggestionsResult> = {
    queryKey: lodgingSuggestionsKey(tripId, deps),
    queryFn: () => getLodgingSuggestions(tripId, { note: deps.note }),
    enabled,
    staleTime: LODGING_SUGGESTIONS_STALE,
    retry: 1,
  };
  return useQuery(queryOpts);
}

/**
 * Warms the lodging-suggestions cache from a parent screen (e.g. the trip
 * dashboard) so opening the Lodging tab renders instantly instead of waiting
 * on the suggest-lodging call.
 *
 * Fetches the prefSummary first because it's part of the suggestions cache
 * key — without it, the prefetched cache entry wouldn't match what the
 * lodging tab queries with.
 */
export async function prefetchLodgingSuggestions(
  qc: QueryClient,
  tripId: string,
  deps: Omit<LodgingSuggestionsKeyDeps, 'prefSummary'>,
) {
  if (!tripId || !deps.destination || !deps.startDate || !deps.endDate) return;
  const prefSummary = await qc.fetchQuery({
    queryKey: prefSummaryKey(tripId),
    queryFn: () => getGroupLodgingPrefSummary(tripId),
    staleTime: PREF_SUMMARY_STALE,
  });
  return qc.prefetchQuery({
    queryKey: lodgingSuggestionsKey(tripId, { ...deps, prefSummary }),
    queryFn: () => getLodgingSuggestions(tripId),
    staleTime: LODGING_SUGGESTIONS_STALE,
  });
}

// ─── Travel suggestions ───────────────────────────────────────────────────────
// Backed by react-query for in-session caching, but the source of truth is the
// trip row (`trips.cached_travel_suggestions`) — `TravelSuggestionCard` reads
// that directly for instant render. The query only fires on cache miss /
// signature mismatch, or for per-member scope (which has no row cache).

function travelSuggestionsKey(tripId: string, respondentPhone: string | null, note: string) {
  const scope: 'group' | 'member' = respondentPhone ? 'member' : 'group';
  // Empty/undefined notes collapse to the canonical key so clearing the
  // textarea doesn't trigger a refetch (mirrors lodging's note keying).
  return ['travel-suggestions', scope, tripId, respondentPhone, note] as const;
}

export function useTravelSuggestionsQuery(
  tripId: string,
  opts: { enabled?: boolean; respondentPhone?: string | null; note?: string } = {},
) {
  const enabled = opts.enabled ?? true;
  const respondentPhone = opts.respondentPhone ?? null;
  const note = (opts.note ?? '').trim();
  return useQuery({
    queryKey: travelSuggestionsKey(tripId, respondentPhone, note),
    queryFn: () => getTravelSuggestions(tripId, {
      respondentPhone: respondentPhone ?? undefined,
      note: note || undefined,
    }),
    enabled: enabled && !!tripId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}

/** @deprecated Use `useTravelSuggestionsQuery` directly. */
export function useMemberTravelSuggestions(
  tripId: string,
  respondentPhone: string | null,
  opts: { enabled: boolean },
) {
  return useTravelSuggestionsQuery(tripId, {
    enabled: opts.enabled && !!respondentPhone,
    respondentPhone,
  });
}
