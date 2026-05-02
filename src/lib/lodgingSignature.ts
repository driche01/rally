/**
 * Lodging-suggestions cache signature.
 *
 * Mirrored EXACTLY from `supabase/functions/suggest-lodging/index.ts`
 * `computeSignature`. Both sides must agree byte-for-byte — the client
 * uses this to decide whether `trip.cached_lodging_suggestions` is fresh
 * enough to render directly (no edge-function call).
 *
 * If you change the signature format, bump `CACHE_SIGNATURE_VERSION`
 * here AND in the edge function so old cached rows fall through to a
 * recompute instead of being trusted under the new schema.
 */
import type { GroupLodgingPrefSummary } from '@/lib/api/travelerProfiles';

export const CACHE_SIGNATURE_VERSION = 'v1';

export interface LodgingSignatureInputs {
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  groupSize: number;
  budgetPerPerson: string | null;
  flightCostPerPerson: number | null;
  tripType: string | null;
  prefSummary: GroupLodgingPrefSummary;
}

export function computeLodgingSignature(input: LodgingSignatureInputs): string {
  const { prefSummary } = input;
  const parts = [
    CACHE_SIGNATURE_VERSION,
    input.destination ?? '',
    input.startDate ?? '',
    input.endDate ?? '',
    String(input.groupSize),
    input.budgetPerPerson ?? '',
    input.flightCostPerPerson != null ? String(input.flightCostPerPerson) : '',
    input.tripType ?? '',
    String(prefSummary.total),
    String(prefSummary.counts.hotel ?? 0),
    String(prefSummary.counts.rental ?? 0),
    String(prefSummary.counts.either ?? 0),
    String(prefSummary.sleepCounts.own_room ?? 0),
    String(prefSummary.sleepCounts.own_bed ?? 0),
    String(prefSummary.sleepCounts.share_bed ?? 0),
    String(prefSummary.sleepCounts.flexible ?? 0),
    prefSummary.lastUpdatedAt ?? '',
  ];
  return parts.join('|');
}
