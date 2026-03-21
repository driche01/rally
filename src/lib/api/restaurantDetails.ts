/**
 * Restaurant details lookup — via Supabase Edge Function proxy.
 * Wraps the Google Places Text Search + Details APIs server-side.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/restaurant-details`;

export interface RestaurantDetails {
  found: true;
  name: string;
  price_level: number | null;
  price_display: string | null;       // "$", "$$", "$$$", "$$$$" or null
  hours_today: { open: string; close: string; all_day?: boolean } | null;
  google_maps_url: string | null;
}

export type RestaurantLookupResult = RestaurantDetails | { found: false };

/**
 * Look up a restaurant by combining the block title + location as the search query.
 * @param title     Block title, e.g. "Dinner at Boon Eat + Drink"
 * @param location  Block location, e.g. "14701 Armstrong Woods Rd, Guerneville"
 * @param dayDate   YYYY-MM-DD — used to pick the right day's opening hours
 */
export async function lookupRestaurantDetails(
  title: string,
  location: string,
  dayDate: string,
): Promise<RestaurantLookupResult> {
  // Combine title + location for the best Places match
  const query = [title.trim(), location.trim()].filter(Boolean).join(' ');

  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ query, day_date: dayDate }),
  });

  if (!res.ok) return { found: false };
  const data = await res.json();
  return data as RestaurantLookupResult;
}
