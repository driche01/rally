/**
 * Supabase Edge Function — suggest-travel
 *
 * Given a trip's destination, dates, group size, and budget, uses Gemini to
 * suggest the best travel modes and routes with pros/cons and deep links to
 * Google Flights, Maps, or relevant search.
 *
 * Two callers:
 *   1. User-driven via the Travel tab. Auth header is the planner/member JWT;
 *      the response body holds the suggestions for the client to render.
 *   2. The `trip_warm_travel_cache` Postgres trigger (migration 103), which
 *      fires `{ trip_id, warm: true }` whenever destination/dates/etc change.
 *      Same flow — but we can skip the response body since pg_net discards it.
 *
 * Cache lives on `trips.cached_travel_suggestions` (JSONB) gated by
 * `cached_travel_suggestions_signature`. Writes use the service-role client
 * because RLS blocks the user-scoped client from updating cache columns.
 * Group scope only — per-member suggestions stay on the on-demand path.
 *
 * Deploy:  supabase functions deploy suggest-travel
 * Secret:  supabase secrets set GEMINI_API_KEY=AIza...
 *
 * POST body: { trip_id: string, origin?: string, respondent_phone?: string, warm?: boolean }
 *
 * Returns: { suggestions: TravelSuggestion[] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPublishableKey, getServiceRoleKey } from '../_sms-shared/api-keys.ts';

const TRAVEL_CACHE_SIGNATURE_VERSION = 'v1';

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

interface TravelSignatureInputs {
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  groupSize: number;
  budgetPerPerson: string | null;
  tripType: string | null;
}

function computeTravelSignature(input: TravelSignatureInputs): string {
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

    const body = await req.json();
    const { trip_id, origin, respondent_phone, warm, note: noteRaw } = body as {
      trip_id: string;
      origin?: string;
      /**
       * When set, suggestions are scoped to this individual traveler — their
       * own home_airport drives the route and their own dealbreakers drive
       * the constraints (group aggregation is skipped).
       */
      respondent_phone?: string;
      /** True when invoked by the trip_warm_travel_cache trigger. */
      warm?: boolean;
      /** Planner-supplied steering note ("more direct flights", "no red-eyes").
       *  Bypasses cache (read AND write) so the canonical row stays untainted. */
      note?: string;
    };
    const note = typeof noteRaw === 'string' ? noteRaw.trim() : '';
    const hasNote = note.length > 0;
    if (!trip_id) {
      return new Response(JSON.stringify({ error: 'trip_id required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Service-role client is used for cache writebacks. RLS would block the
    // user-scoped client from writing to the cache columns when the call
    // comes from a non-planner (or from the warm-cache trigger, which has
    // no user JWT at all).
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      getServiceRoleKey(),
      { auth: { persistSession: false } }
    );

    // For the trigger-driven warm call there is no user JWT — fall back to
    // the admin client for the trip read so we can still load the row.
    const supabase = warm
      ? supabaseAdmin
      : createClient(
          Deno.env.get('SUPABASE_URL')!,
          getPublishableKey(),
          { global: { headers: { Authorization: authHeader } } },
        );

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

    // ── Cache check (group scope only) ───────────────────────────────────────
    // Per-member queries use a different traveler context that's not part of
    // the cached signature, so they always recompute. Group queries with a
    // matching signature short-circuit straight to the cached payload — this
    // is what makes opening the Travel tab instant after the first generation.
    const isGroupScope = !respondent_phone;
    const expectedSignature = computeTravelSignature({
      destination: trip.destination,
      startDate: trip.start_date,
      endDate: trip.end_date,
      groupSize,
      budgetPerPerson: trip.budget_per_person,
      tripType: trip.trip_type,
    });

    // Cache short-circuits ONLY when there's no steering note. With a note
    // we always recompute — the note isn't part of the signature, so a
    // hit would serve stale "no-note" suggestions, and a writeback would
    // poison the canonical row for the next planner without a note.
    if (
      isGroupScope &&
      !warm &&
      !hasNote &&
      Array.isArray(trip.cached_travel_suggestions) &&
      trip.cached_travel_suggestions_signature === expectedSignature
    ) {
      return new Response(
        JSON.stringify({ suggestions: trip.cached_travel_suggestions }),
        { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    // ── Resolve origin + flight constraints ──────────────────────────────────
    // Two modes:
    //   - Group mode (default): origin = planner's home airport; constraints =
    //     dealbreakers/travel_prefs aggregated across the group's profiles.
    //   - Single-person mode (respondent_phone passed): origin + constraints
    //     come from that one respondent's profile only — no group aggregation.
    let originCity: string | null = origin ?? null;
    let flightDealbreakers: string[] = [];
    let travelPrefs: string[] = [];
    const singlePerson = !!respondent_phone;

    if (singlePerson) {
      const { data: memberProfile } = await supabase
        .from('traveler_profiles')
        .select('home_airport, flight_dealbreakers')
        .eq('phone', respondent_phone)
        .maybeSingle();
      if (memberProfile?.home_airport && !originCity) {
        originCity = memberProfile.home_airport;
      }
      flightDealbreakers = (memberProfile?.flight_dealbreakers as string[] | null) ?? [];
    } else {
      if (!originCity && trip.created_by) {
        const { data: planner } = await supabase
          .from('profiles')
          .select('phone')
          .eq('id', trip.created_by)
          .maybeSingle();
        if (planner?.phone) {
          const { data: plannerProfile } = await supabase
            .from('traveler_profiles')
            .select('home_airport')
            .eq('phone', planner.phone)
            .maybeSingle();
          if (plannerProfile?.home_airport) originCity = plannerProfile.home_airport;
        }
      }

      const { data: respondents } = await supabase
        .from('respondents')
        .select('phone')
        .eq('trip_id', trip_id);
      const phones = (respondents ?? [])
        .map((r: { phone: string | null }) => r.phone)
        .filter((p: string | null): p is string => !!p);
      if (phones.length > 0) {
        const { data: profiles } = await supabase
          .from('traveler_profiles')
          .select('flight_dealbreakers, travel_pref')
          .in('phone', phones);
        const dealbreakerCounts = new Map<string, number>();
        const prefCounts = new Map<string, number>();
        for (const p of (profiles ?? []) as Array<{ flight_dealbreakers: string[] | null; travel_pref: string | null }>) {
          for (const d of p.flight_dealbreakers ?? []) {
            dealbreakerCounts.set(d, (dealbreakerCounts.get(d) ?? 0) + 1);
          }
          if (p.travel_pref) prefCounts.set(p.travel_pref, (prefCounts.get(p.travel_pref) ?? 0) + 1);
        }
        const threshold = Math.max(1, Math.ceil(profiles!.length / 3));
        flightDealbreakers = Array.from(dealbreakerCounts.entries())
          .filter(([, n]) => n >= threshold)
          .map(([k]) => k);
        travelPrefs = Array.from(prefCounts.entries())
          .filter(([, n]) => n >= threshold)
          .map(([k]) => k);
      }
    }

    // Without a known origin we have nothing to anchor the route on — Gemini
    // will happily invent one (e.g. "Boston → NYC" because the model has a
    // strong prior on Northeast Corridor routes). That hallucinated origin
    // then gets cached on the trip row and continues to serve even after the
    // planner sets their home_airport (the cache key doesn't include origin —
    // invalidation happens via the traveler_profiles trigger). Return empty
    // and skip the cache write so the next call retries cleanly.
    if (!originCity) {
      if (warm) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no_origin' }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ suggestions: [], reason: 'no_origin' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const dealbreakerLabels: Record<string, string> = {
      red_eye: 'no red-eye flights',
      multi_stop: 'no multi-stop itineraries',
      early_dep: 'no early-morning departures',
      late_arr: 'no late-night arrivals',
    };
    const prefLabels: Record<string, string> = {
      with_group: 'group wants to travel together on the same flights',
      with_group_flexible: 'group prefers traveling together but is flexible',
      separate: 'group will book independently from different cities',
      no_pref: '',
    };
    const dealbreakerLine = flightDealbreakers
      .map((d) => dealbreakerLabels[d])
      .filter(Boolean)
      .join('; ');
    const prefLine = travelPrefs
      .map((p) => prefLabels[p])
      .filter(Boolean)
      .join('; ');

    // ── Build Gemini prompt ───────────────────────────────────────────────────
    const promptHeader = singlePerson
      ? 'You are a travel planning assistant helping one traveler figure out the best way to get to their destination, in the context of a group trip.'
      : 'You are a travel planning assistant helping a group figure out the best way to get to their destination.';
    const partySizeLine = singlePerson
      ? '- Traveler: 1 person (this is for an individual member of the group, not the whole group)'
      : `- Group size: ${groupSize} people`;
    const constraintLine = singlePerson
      ? (dealbreakerLine ? `- This traveler's flight constraints: ${dealbreakerLine}` : '')
      : (dealbreakerLine ? `- Group flight constraints: ${dealbreakerLine}` : '');
    const styleLine = singlePerson ? '' : (prefLine ? `- Group travel style: ${prefLine}` : '');
    const taskLine = singlePerson
      ? `Suggest 2-3 realistic travel options for this individual to get to ${destination}. Only include modes that genuinely make sense for this route from ${originCity ?? 'their departure city'}. If flying is the only practical option, suggest 2-3 flight variations (direct vs. connecting, timing options). Respect the traveler's flight constraints — do not suggest options that violate them.`
      : `Suggest 2-3 realistic travel options for this group to get to ${destination}. Only include modes that genuinely make sense for this route. If flying is the only practical option, suggest 2-3 flight variations (e.g., direct vs. connecting, timing options). If driving and flying are both realistic, include both. Respect the group's flight constraints — do not suggest options that violate them.`;

    const prompt = `
${promptHeader}

Trip context:
- Destination: ${destination}
${originCity ? `- Departing from: ${originCity}` : '- Departure city: unknown (suggest based on destination)'}
${departureDate ? `- Departure date: ${departureDate}` : ''}
${returnDate ? `- Return date: ${returnDate}` : ''}
${partySizeLine}
${budget ? `- Total trip budget per person: ${budget} (travel should fit within this)` : ''}
${tripType ? `- Trip type: ${tripType}` : ''}
${constraintLine}
${styleLine}
${hasNote ? `\nPlanner steering note (apply this directly — it overrides any prior leaning): "${note}"\n` : ''}
${taskLine}

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
      return new Response(JSON.stringify({ error: 'Suggestion generation failed' }), {
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

    // Write back to the cache for the group scope so the next open is
    // instant. Per-member generations skip the cache (different scope, not
    // covered by the trip-level signature). Note-tuned generations also
    // skip the writeback — the note isn't part of the signature, so caching
    // would poison the canonical row for the next planner without a note.
    // Best-effort: a write failure shouldn't fail the whole request.
    if (isGroupScope && !hasNote) {
      const { error: cacheError } = await supabaseAdmin
        .from('trips')
        .update({
          cached_travel_suggestions: suggestions,
          cached_travel_suggestions_signature: expectedSignature,
          cached_travel_suggestions_updated_at: new Date().toISOString(),
        })
        .eq('id', trip_id);
      if (cacheError) {
        console.warn('suggest-travel cache write failed:', cacheError.message);
      }
    }

    // Warm calls (from the trigger) discard the body; skip serialization.
    if (warm) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

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
