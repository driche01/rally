/**
 * Google Places Autocomplete — via Supabase Edge Function proxy.
 *
 * All requests are proxied through `supabase/functions/places-autocomplete`
 * so the Google API is never called directly from the client. This avoids
 * CORS issues on web and keeps the API key server-side.
 *
 * Falls back to POPULAR_DESTINATIONS if the edge function is unreachable.
 */

import { POPULAR_DESTINATIONS } from '@/lib/constants/destinations';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/places-autocomplete`;

export interface PlaceSuggestion {
  id: string;
  /** Full human-readable string, e.g. "Four Seasons Resort Bali, Indonesia" */
  description: string;
  /** Primary part, e.g. "Four Seasons Resort Bali" */
  mainText: string;
  /** Secondary part, e.g. "Bali, Indonesia" */
  secondaryText: string;
}

/**
 * Fetch autocomplete suggestions for a partial destination/establishment query.
 *
 * Fires two parallel requests (geocode + establishment) and interleaves
 * the results so both cities and venues appear in the same list.
 *
 * @param input        The text the user has typed.
 * @param sessionToken Groups requests into a billing session; reset after selection.
 */
export async function fetchPlaceSuggestions(
  input: string,
  sessionToken: string,
): Promise<PlaceSuggestion[]> {
  const trimmed = input.trim();
  if (trimmed.length < 2) return [];

  try {
    // Two parallel requests: one for geographic places, one for establishments
    const [geocodeResults, establishmentResults] = await Promise.all([
      autocomplete(trimmed, sessionToken, 'geocode'),
      autocomplete(trimmed, sessionToken, 'establishment'),
    ]);

    // Interleave results, geocodes first, deduplicated by place_id, max 6
    const seen = new Set<string>();
    const merged: PlaceSuggestion[] = [];

    for (const result of [...geocodeResults, ...establishmentResults]) {
      if (!seen.has(result.id)) {
        seen.add(result.id);
        merged.push(result);
      }
      if (merged.length === 6) break;
    }

    return merged.length > 0 ? merged : staticFallback(trimmed);
  } catch {
    return staticFallback(trimmed);
  }
}

async function autocomplete(
  input: string,
  sessionToken: string,
  types: 'geocode' | 'establishment',
): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ input, sessiontoken: sessionToken, types });

  const res = await fetch(`${FUNCTION_URL}?${params}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!res.ok) return [];

  const json = await res.json();
  if (json.status !== 'OK') return [];

  return (json.predictions ?? []).slice(0, 4).map((p: any) => ({
    id: p.place_id as string,
    description: p.description as string,
    mainText: (p.structured_formatting?.main_text ?? p.description) as string,
    secondaryText: (p.structured_formatting?.secondary_text ?? '') as string,
  }));
}

function staticFallback(input: string): PlaceSuggestion[] {
  const lower = input.toLowerCase();
  return (POPULAR_DESTINATIONS as readonly string[])
    .filter((d) => d.toLowerCase().includes(lower))
    .slice(0, 6)
    .map((d) => ({ id: d, description: d, mainText: d, secondaryText: '' }));
}
