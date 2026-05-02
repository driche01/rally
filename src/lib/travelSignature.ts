/**
 * Travel-suggestions cache signature.
 *
 * Mirrored EXACTLY from `supabase/functions/suggest-travel/index.ts`
 * `computeSignature`. Both sides must agree byte-for-byte — the client
 * uses this to decide whether `trip.cached_travel_suggestions` is fresh
 * enough to render directly (no edge-function call).
 *
 * If you change the signature format, bump `TRAVEL_CACHE_SIGNATURE_VERSION`
 * here AND in the edge function so old cached rows fall through to a
 * recompute instead of being trusted under the new schema.
 */

export const TRAVEL_CACHE_SIGNATURE_VERSION = 'v1';

export interface TravelSignatureInputs {
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  groupSize: number;
  budgetPerPerson: string | null;
  tripType: string | null;
}

export function computeTravelSignature(input: TravelSignatureInputs): string {
  const parts = [
    TRAVEL_CACHE_SIGNATURE_VERSION,
    input.destination ?? '',
    input.startDate ?? '',
    input.endDate ?? '',
    String(input.groupSize),
    input.budgetPerPerson ?? '',
    input.tripType ?? '',
  ];
  return parts.join('|');
}
