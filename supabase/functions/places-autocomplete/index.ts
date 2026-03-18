/**
 * Supabase Edge Function — Google Places Autocomplete proxy.
 *
 * Proxies requests to the Google Places Autocomplete API server-side,
 * so the client (especially web) is never blocked by CORS.
 *
 * Deploy:   supabase functions deploy places-autocomplete
 * Secret:   supabase secrets set GOOGLE_PLACES_API_KEY=AIza...
 *
 * Query params:
 *   input        - the search string (required)
 *   sessiontoken - billing session token
 *   types        - geocode | establishment (optional)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const input = url.searchParams.get('input') ?? '';
    const sessiontoken = url.searchParams.get('sessiontoken') ?? '';
    const types = url.searchParams.get('types') ?? '';

    if (!input.trim()) {
      return json([]);
    }

    const PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? '';
    if (!PLACES_API_KEY) {
      return json({ error: 'GOOGLE_PLACES_API_KEY not configured' }, 500);
    }

    const params = new URLSearchParams({
      input: input.trim(),
      key: PLACES_API_KEY,
      language: 'en',
      ...(sessiontoken ? { sessiontoken } : {}),
      ...(types ? { types } : {}),
    });

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`,
    );
    const data = await res.json();

    return json(data);
  } catch (err) {
    console.error('[places-autocomplete]', err);
    return json({ status: 'ERROR', error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
