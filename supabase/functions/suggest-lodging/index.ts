/**
 * Supabase Edge Function — suggest-lodging
 *
 * Given a trip's destination, dates, group size, budget, and member preferences,
 * uses Gemini to suggest 3 lodging options with rationale and pre-built
 * Airbnb/VRBO/Booking.com search URLs.
 *
 * Deploy:  supabase functions deploy suggest-lodging
 * Secret:  supabase secrets set GEMINI_API_KEY=AIza...
 *
 * POST body: { trip_id: string }
 * Requires: Authorization header with the planner's JWT
 *
 * Returns: { suggestions: LodgingSuggestion[] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPublishableKey } from '../_sms-shared/api-keys.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export interface LodgingSuggestion {
  index: number;
  label: string;           // e.g. "Beachfront House", "Central Apartment", "Budget-Friendly Cottage"
  description: string;     // 1-2 sentence rationale
  propertyType: string;    // e.g. "entire home", "apartment", "villa"
  idealFor: string;        // e.g. "groups who want space to cook and hang out"
  estimatedNightlyRate: string | null;  // e.g. "$200–350/night total"
  platforms: ('airbnb' | 'vrbo' | 'booking')[];  // platforms where this type of property is realistically listed
  airbnbUrl: string | null;
  vrboUrl: string | null;
  bookingUrl: string | null;
}

// ── URL builders (mirrored from client lib/api/lodging.ts) ───────────────────

function buildAirbnbUrl(params: {
  destination: string;
  checkIn: string | null;
  checkOut: string | null;
  guests: number;
}): string {
  const base = 'https://www.airbnb.com/s';
  const p = new URLSearchParams();
  p.set('query', params.destination);
  if (params.checkIn) p.set('checkin', params.checkIn);
  if (params.checkOut) p.set('checkout', params.checkOut);
  p.set('adults', String(params.guests));
  p.set('room_types[]', 'Entire home/apt');
  return `${base}/${encodeURIComponent(params.destination)}/homes?${p.toString()}`;
}

function buildVrboUrl(params: {
  destination: string;
  checkIn: string | null;
  checkOut: string | null;
  guests: number;
}): string {
  const p = new URLSearchParams();
  p.set('q', params.destination);
  if (params.checkIn) p.set('startDate', params.checkIn);
  if (params.checkOut) p.set('endDate', params.checkOut);
  p.set('adults', String(params.guests));
  return `https://www.vrbo.com/search?${p.toString()}`;
}

function buildBookingUrl(params: {
  destination: string;
  checkIn: string | null;
  checkOut: string | null;
  guests: number;
}): string {
  const p = new URLSearchParams();
  p.set('ss', params.destination);
  if (params.checkIn) p.set('checkin', params.checkIn);
  if (params.checkOut) p.set('checkout', params.checkOut);
  p.set('group_adults', String(params.guests));
  p.set('no_rooms', '1');
  return `https://www.booking.com/searchresults.html?${p.toString()}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      getPublishableKey(),
      { global: { headers: { Authorization: authHeader } } }
    );

    const { trip_id } = await req.json();
    if (!trip_id) {
      return new Response(JSON.stringify({ error: 'trip_id required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── Fetch trip + member preferences ───────────────────────────────────────
    const [tripRes, respondentsRes, prefsRes] = await Promise.all([
      supabase.from('trips').select('*').eq('id', trip_id).single(),
      supabase.from('respondents').select('id, rsvp_status').eq('trip_id', trip_id),
      supabase
        .from('respondent_rsvp_preferences')
        .select('needs, energy, vibes, pace')
        .eq('trip_id', trip_id),
    ]);

    const trip = tripRes.data;
    if (!trip) {
      return new Response(JSON.stringify({ error: 'Trip not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const respondents = respondentsRes.data ?? [];
    const prefs = prefsRes.data ?? [];

    const destination = trip.destination ?? trip.name ?? 'the destination';
    const checkIn = trip.start_date ?? null;
    const checkOut = trip.end_date ?? null;
    const groupSize = trip.group_size_precise ?? respondents.length + 1 ?? 4;
    const budget = trip.budget_per_person ?? null;
    const tripType = trip.trip_type ?? null;

    // Aggregate preferences
    const allNeeds = prefs.flatMap((p) => p.needs ?? []);
    const accessibilityNeeds = allNeeds.filter((n) =>
      ['wheelchair', 'mobility', 'accessible'].some((k) => n.toLowerCase().includes(k))
    );
    const allVibes = prefs.flatMap((p) => p.vibes ?? []);
    const energyLevels = prefs.map((p) => p.energy).filter(Boolean);
    const relaxingCount = energyLevels.filter((e) => e === 'relaxing').length;
    const adventurousCount = energyLevels.filter((e) => e === 'adventurous').length;
    const dominantEnergy = relaxingCount > adventurousCount ? 'relaxing' : adventurousCount > relaxingCount ? 'adventurous' : 'mixed';

    const nights = checkIn && checkOut
      ? Math.round((new Date(checkOut + 'T12:00:00').getTime() - new Date(checkIn + 'T12:00:00').getTime()) / 86400000)
      : null;

    // ── Build Gemini prompt ───────────────────────────────────────────────────
    const prompt = `
You are a travel planning assistant helping a group find the ideal lodging.

Trip context:
- Destination: ${destination}
${checkIn ? `- Check-in: ${checkIn}` : ''}
${checkOut ? `- Check-out: ${checkOut}` : ''}
${nights ? `- Duration: ${nights} nights` : ''}
- Group size: ${groupSize} people
${budget ? `- Budget per person (total trip): ${budget}` : ''}
${tripType ? `- Trip type: ${tripType}` : ''}
${dominantEnergy !== 'mixed' ? `- Group energy: mostly ${dominantEnergy}` : '- Group energy: mixed adventurous/relaxing'}
${allVibes.length > 0 ? `- Group vibes: ${[...new Set(allVibes)].slice(0, 5).join(', ')}` : ''}
${accessibilityNeeds.length > 0 ? `- Accessibility needs: ${accessibilityNeeds.join(', ')}` : ''}

Suggest exactly 3 distinct lodging options, from most to least expensive. Each option should represent a genuinely different approach (e.g., luxury rental vs. central apartment vs. budget-friendly option).

Respond with ONLY a JSON array of 3 objects, no markdown, no explanation:
[
  {
    "index": 0,
    "label": "short catchy name (3-4 words)",
    "description": "1-2 sentence rationale for why this works for this group",
    "propertyType": "e.g. entire home, apartment, villa, cottage",
    "idealFor": "short phrase, e.g. 'groups who want a home base to cook and relax'",
    "estimatedNightlyRate": "e.g. '$300–500/night total' or null if unknown",
    "searchArea": "specific neighborhood or area within ${destination} to search in",
    "platforms": ["airbnb", "vrbo"]
  },
  ...
]

For "platforms": include only the booking platforms where this type of property is realistically listed. Rules:
- Entire homes, cottages, cabins, villas → ["airbnb", "vrbo"]
- Hotels, motels, B&Bs, hostels → ["booking"]
- Apartments, condos → ["airbnb", "booking"]
- Unique/quirky stays (treehouses, yurts, etc.) → ["airbnb"]
`.trim();

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192, responseMimeType: 'application/json' },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini error:', errText);
      return new Response(JSON.stringify({ error: 'AI generation failed' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const geminiData = await geminiRes.json();
    const parts = geminiData.candidates?.[0]?.content?.parts ?? [];
    const rawText = (parts.find((p: { thought?: boolean; text?: string }) => !p.thought)?.text ?? '').trim() || '[]';

    // Parse and augment with platform search URLs
    let rawSuggestions: Array<{
      index: number;
      label: string;
      description: string;
      propertyType: string;
      idealFor: string;
      estimatedNightlyRate: string | null;
      searchArea: string;
    }>;

    try {
      rawSuggestions = JSON.parse(rawText);
    } catch {
      // Try to extract JSON from text
      const match = rawText.match(/\[[\s\S]*\]/);
      rawSuggestions = match ? JSON.parse(match[0]) : [];
    }

    const searchParams = { destination, checkIn, checkOut, guests: groupSize };
    const suggestions: LodgingSuggestion[] = rawSuggestions.map((s) => {
      const platforms: ('airbnb' | 'vrbo' | 'booking')[] = Array.isArray(s.platforms) ? s.platforms : ['airbnb', 'vrbo', 'booking'];
      const area = s.searchArea ?? destination;
      return {
        ...s,
        platforms,
        airbnbUrl: platforms.includes('airbnb') ? buildAirbnbUrl({ ...searchParams, destination: area }) : null,
        vrboUrl: platforms.includes('vrbo') ? buildVrboUrl({ ...searchParams, destination: area }) : null,
        bookingUrl: platforms.includes('booking') ? buildBookingUrl({ ...searchParams, destination: area }) : null,
      };
    });

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('suggest-lodging error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
