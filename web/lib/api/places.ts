/**
 * Google Places Autocomplete — via Supabase Edge Function proxy.
 *
 * Mirrors `src/lib/api/places.ts` in the mobile app, ported to the
 * Next.js env-var conventions. All requests are proxied through
 * `supabase/functions/places-autocomplete` so the Google API is never
 * called directly from the browser. This avoids CORS issues and keeps
 * `GOOGLE_PLACES_API_KEY` server-side as a Supabase secret.
 *
 * Two parallel requests per query (geocode + establishment) so the
 * dropdown surfaces both cities and venues. Results are deduped by
 * Google's `place_id` and capped at 6.
 *
 * Returns empty array when the edge function is unreachable. Callers
 * should handle the empty case (e.g., let the user type freeform if
 * autocomplete is offline).
 */

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "";
const PUBLISHABLE   = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const FUNCTION_URL  = `${SUPABASE_URL}/functions/v1/places-autocomplete`;

export interface PlaceSuggestion {
  /** Google's stable `place_id`. */
  id: string;
  /** Full human-readable string, e.g. "Four Seasons Resort Bali, Indonesia" */
  description: string;
  /** Primary part, e.g. "Four Seasons Resort Bali" */
  mainText: string;
  /** Secondary part, e.g. "Bali, Indonesia" */
  secondaryText: string;
}

/**
 * Fetch autocomplete suggestions for a partial destination query.
 *
 * Fires two parallel requests (geocode + establishment) and interleaves
 * the results so cities and venues coexist in the same dropdown.
 *
 * @param input        the text the user has typed
 * @param sessionToken groups requests into a billing session — reset
 *                     after a selection lands to start a new session
 */
export async function fetchPlaceSuggestions(
  input: string,
  sessionToken: string,
): Promise<PlaceSuggestion[]> {
  const trimmed = input.trim();
  if (trimmed.length < 2) return [];

  try {
    const [geocodeResults, establishmentResults] = await Promise.all([
      autocomplete(trimmed, sessionToken, "geocode"),
      autocomplete(trimmed, sessionToken, "establishment"),
    ]);

    // Interleave: geocodes first, then establishments. Dedupe by place_id.
    const seen   = new Set<string>();
    const merged: PlaceSuggestion[] = [];
    for (const result of [...geocodeResults, ...establishmentResults]) {
      if (seen.has(result.id)) continue;
      seen.add(result.id);
      merged.push(result);
      if (merged.length === 6) break;
    }
    return merged;
  } catch {
    return [];
  }
}

async function autocomplete(
  input: string,
  sessionToken: string,
  types: "geocode" | "establishment",
): Promise<PlaceSuggestion[]> {
  if (!SUPABASE_URL || !PUBLISHABLE) return [];

  const params = new URLSearchParams({
    input,
    sessiontoken: sessionToken,
    types,
  });

  const res = await fetch(`${FUNCTION_URL}?${params}`, {
    headers: {
      apikey:        PUBLISHABLE,
      Authorization: `Bearer ${PUBLISHABLE}`,
    },
  });

  if (!res.ok) return [];

  // The edge function returns Google's raw autocomplete JSON, which has
  // a top-level `status` ("OK" / "ZERO_RESULTS" / ...) and a
  // `predictions` array. Anything other than OK should yield empty.
  type AutoCompletePrediction = {
    place_id: string;
    description: string;
    structured_formatting?: {
      main_text?:      string;
      secondary_text?: string;
    };
  };
  type AutoCompleteResponse = {
    status: string;
    predictions?: AutoCompletePrediction[];
  };

  const body = (await res.json()) as AutoCompleteResponse;
  if (body.status !== "OK") return [];

  return (body.predictions ?? []).slice(0, 4).map((p) => ({
    id:             p.place_id,
    description:    p.description,
    mainText:       p.structured_formatting?.main_text      ?? p.description,
    secondaryText:  p.structured_formatting?.secondary_text ?? "",
  }));
}

/**
 * Make a fresh billing-session token for a new autocomplete session.
 * Google groups all autocomplete calls under the same token into one
 * billed session — cheaper than charging per keystroke.
 */
export function makePlacesSessionToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
