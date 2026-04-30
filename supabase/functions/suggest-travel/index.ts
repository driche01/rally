/**
 * Supabase Edge Function — suggest-travel
 *
 * Given a trip's destination, dates, group size, and budget, uses Gemini to
 * suggest the best travel modes and routes with pros/cons and deep links to
 * Google Flights, Maps, or relevant search.
 *
 * Deploy:  supabase functions deploy suggest-travel
 * Secret:  supabase secrets set GEMINI_API_KEY=AIza...
 *
 * POST body: { trip_id: string, origin?: string }
 * Requires: Authorization header with the planner's JWT
 *
 * Returns: { suggestions: TravelSuggestion[] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPublishableKey } from '../_sms-shared/api-keys.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export interface TravelSuggestion {
  index: number;
  mode: 'flight' | 'train' | 'car' | 'ferry' | 'bus' | 'other';
  label: string;              // e.g. "Direct flight", "Scenic train route", "Road trip"
  description: string;        // 1-2 sentence rationale
  estimatedDuration: string;  // e.g. "~2h flight", "3.5h drive"
  estimatedCostPerPerson: string | null;  // e.g. "$150–250 each way"
  pros: string[];             // 2-3 bullet points
  cons: string[];             // 1-2 bullet points
  searchUrl: string;          // deep link to Google Flights / Maps / search
  bookingTip: string | null;  // e.g. "Book 6+ weeks out for best prices"
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

    const body = await req.json();
    const { trip_id, origin } = body as { trip_id: string; origin?: string };
    if (!trip_id) {
      return new Response(JSON.stringify({ error: 'trip_id required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── Fetch trip ────────────────────────────────────────────────────────────
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('*')
      .eq('id', trip_id)
      .single();

    if (tripError || !trip) {
      return new Response(JSON.stringify({ error: 'Trip not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const destination = trip.destination ?? trip.name ?? 'the destination';
    const departureDate = trip.start_date ?? null;
    const returnDate = trip.end_date ?? null;
    const groupSize = trip.group_size_precise ?? 4;
    const budget = trip.budget_per_person ?? null;
    const tripType = trip.trip_type ?? null;
    const originCity = origin ?? null;

    // ── Build Gemini prompt ───────────────────────────────────────────────────
    const prompt = `
You are a travel planning assistant helping a group figure out the best way to get to their destination.

Trip context:
- Destination: ${destination}
${originCity ? `- Departing from: ${originCity}` : '- Departure city: unknown (suggest based on destination)'}
${departureDate ? `- Departure date: ${departureDate}` : ''}
${returnDate ? `- Return date: ${returnDate}` : ''}
- Group size: ${groupSize} people
${budget ? `- Total trip budget per person: ${budget} (travel should fit within this)` : ''}
${tripType ? `- Trip type: ${tripType}` : ''}

Suggest 2-3 realistic travel options for this group to get to ${destination}. Only include modes that genuinely make sense for this route. If flying is the only practical option, suggest 2-3 flight variations (e.g., direct vs. connecting, timing options). If driving and flying are both realistic, include both.

Respond with ONLY a JSON array, no markdown, no explanation:
[
  {
    "index": 0,
    "mode": "flight" | "train" | "car" | "ferry" | "bus" | "other",
    "label": "short catchy label (2-4 words)",
    "description": "1-2 sentence rationale",
    "estimatedDuration": "e.g. '~2h flight' or '3.5h drive'",
    "estimatedCostPerPerson": "e.g. '$150–250 each way' or null",
    "pros": ["pro 1", "pro 2"],
    "cons": ["con 1"],
    "searchQuery": "the best search query to use for finding this option (for Google Flights or Maps)",
    "bookingTip": "short actionable booking tip, or null"
  },
  ...
]
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
        generationConfig: { temperature: 0.6, maxOutputTokens: 8192, responseMimeType: 'application/json' },
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

    let rawSuggestions: Array<{
      index: number;
      mode: string;
      label: string;
      description: string;
      estimatedDuration: string;
      estimatedCostPerPerson: string | null;
      pros: string[];
      cons: string[];
      searchQuery: string;
      bookingTip: string | null;
    }>;

    try {
      rawSuggestions = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\[[\s\S]*\]/);
      rawSuggestions = match ? JSON.parse(match[0]) : [];
    }

    // Build search URLs based on mode
    const suggestions: TravelSuggestion[] = rawSuggestions.map((s) => {
      const q = encodeURIComponent(s.searchQuery ?? `${originCity ?? ''} to ${destination}`);
      let searchUrl: string;
      switch (s.mode) {
        case 'flight':
          searchUrl = `https://www.google.com/travel/flights?q=${q}`;
          break;
        case 'train':
          searchUrl = `https://www.google.com/search?q=train+${q}`;
          break;
        case 'car':
          searchUrl = `https://www.google.com/maps/dir/${encodeURIComponent(originCity ?? '')}/${encodeURIComponent(destination)}`;
          break;
        case 'bus':
          searchUrl = `https://www.google.com/search?q=bus+${q}`;
          break;
        case 'ferry':
          searchUrl = `https://www.google.com/search?q=ferry+${q}`;
          break;
        default:
          searchUrl = `https://www.google.com/search?q=${q}`;
      }
      return {
        index: s.index,
        mode: s.mode as TravelSuggestion['mode'],
        label: s.label,
        description: s.description,
        estimatedDuration: s.estimatedDuration,
        estimatedCostPerPerson: s.estimatedCostPerPerson,
        pros: s.pros,
        cons: s.cons,
        searchUrl,
        bookingTip: s.bookingTip,
      };
    });

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('suggest-travel error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
