/**
 * Supabase Edge Function — restaurant-details
 *
 * Given a restaurant name + location string and a day_date, returns:
 *   - Confirmed place name
 *   - Price level ($–$$$$)
 *   - Opening hours for the requested day
 *   - Google Maps URL
 *
 * Deploy:  supabase functions deploy restaurant-details
 * Secret:  GOOGLE_PLACES_API_KEY (shared with places-autocomplete)
 *
 * POST body:
 *   { query: string, day_date: string }   // query = "Title Location"
 *
 * Response:
 *   { found: true, name, price_level, price_display, hours_today, google_maps_url }
 *   { found: false }
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Convert price_level (0–4) to display string */
function priceDisplay(level: number | undefined): string | null {
  if (level === undefined || level === null) return null;
  return ['Free', '$', '$$', '$$$', '$$$$'][level] ?? null;
}

/** Get day-of-week index (0=Sun … 6=Sat) from a YYYY-MM-DD string */
function dayOfWeek(dayDate: string): number {
  // Parse as UTC midnight to avoid timezone shifting the day
  const [y, m, d] = dayDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Format a Places API time string "HHMM" → "H:MM AM/PM" */
function formatHHMM(t: string): string {
  const h = parseInt(t.slice(0, 2), 10);
  const m = t.slice(2);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m} ${period}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? '';
    if (!apiKey) return json({ error: 'GOOGLE_PLACES_API_KEY not configured' }, 500);

    const { query, day_date } = await req.json();
    if (!query?.trim()) return json({ found: false });

    // ── Step 1: Text Search to get place_id ──────────────────────────────────
    const searchParams = new URLSearchParams({
      query: query.trim(),
      type: 'restaurant',
      key: apiKey,
    });

    const searchRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?${searchParams}`
    );
    const searchData = await searchRes.json();

    if (searchData.status !== 'OK' || !searchData.results?.length) {
      return json({ found: false });
    }

    const placeId = searchData.results[0].place_id as string;

    // ── Step 2: Place Details for price, hours, URL ───────────────────────────
    const detailParams = new URLSearchParams({
      place_id: placeId,
      fields: 'name,price_level,opening_hours,url',
      key: apiKey,
    });

    const detailRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${detailParams}`
    );
    const detailData = await detailRes.json();

    if (detailData.status !== 'OK' || !detailData.result) {
      return json({ found: false });
    }

    const place = detailData.result;

    // ── Step 3: Extract hours for the requested day ───────────────────────────
    let hoursToday: { open: string; close: string } | null = null;
    let openAllDay = false;

    const periods: Array<{ open: { day: number; time: string }; close?: { day: number; time: string } }> =
      place.opening_hours?.periods ?? [];

    if (periods.length === 1 && periods[0].open?.day === 0 && periods[0].open?.time === '0000' && !periods[0].close) {
      // Open 24 hours
      openAllDay = true;
    } else if (day_date) {
      const targetDay = dayOfWeek(day_date);
      const period = periods.find((p) => p.open?.day === targetDay);
      if (period) {
        hoursToday = {
          open: formatHHMM(period.open.time),
          close: period.close ? formatHHMM(period.close.time) : 'midnight',
        };
      }
    }

    return json({
      found: true,
      name: place.name as string,
      price_level: place.price_level ?? null,
      price_display: priceDisplay(place.price_level),
      hours_today: openAllDay ? { open: '12:00 AM', close: '12:00 AM', all_day: true } : hoursToday,
      google_maps_url: place.url as string ?? null,
    });
  } catch (err) {
    console.error('[restaurant-details]', err);
    return json({ error: String(err) }, 500);
  }
});
