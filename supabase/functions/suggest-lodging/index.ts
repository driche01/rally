/**
 * Supabase Edge Function — suggest-lodging
 *
 * Two callers:
 *   1. Planners hitting it from the lodging tab (or a client prefetch).
 *      Returns the cached payload immediately when the trip's stored
 *      signature matches the current input signature; otherwise computes
 *      via Gemini, writes the result back to the trip row, and returns.
 *   2. The `trip_warm_lodging_cache` Postgres trigger (migration 102),
 *      fired by pg_net the moment a planner commits the destination /
 *      dates / budget. Sends `{ trip_id, warm: true }`. Same flow —
 *      computes + writes if cache is empty or stale, otherwise no-op.
 *
 * The cache lives on `trips.cached_lodging_suggestions` (jsonb) gated
 * by `cached_lodging_suggestions_signature`. Writes use the service-role
 * key so RLS doesn't block trigger-initiated calls.
 *
 * Deploy:  supabase functions deploy suggest-lodging
 * Secret:  supabase secrets set GEMINI_API_KEY=AIza...
 *
 * POST body: { trip_id: string, warm?: boolean }
 *   `warm: true` skips the response body (the trigger doesn't read it).
 *
 * Returns: { suggestions, recommendedPlatform, lodgingPref, cached: boolean }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPublishableKey, getServiceRoleKey } from '../_sms-shared/api-keys.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const CACHE_SIGNATURE_VERSION = 'v1';

type Platform = 'airbnb' | 'vrbo' | 'booking';
type LodgingPref = 'hotel' | 'rental' | 'either';
type BudgetPosture = 'splurge' | 'middle' | 'budget' | 'flexible';
type RecommendedPlatform = Platform | 'mixed';

export interface LodgingSuggestion {
  index: number;
  label: string;
  description: string;
  propertyType: string;
  idealFor: string;
  estimatedNightlyRate: string | null;
  platforms: Platform[];
  airbnbUrl: string | null;
  vrboUrl: string | null;
  bookingUrl: string | null;
}

interface CachedPayload {
  suggestions: LodgingSuggestion[];
  recommendedPlatform: RecommendedPlatform;
  lodgingPref: LodgingPref;
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
  // VRBO's `?q=` param is unreliable — when it doesn't parse the value the
  // site falls back to the user's geo (e.g. San Francisco for a Bali query).
  // The `/search/keywords:{location}` path form is the supported way to
  // pin the location. Mirror this exactly on the client (lib/api/lodging.ts).
  const q = encodeURIComponent(params.destination);
  let url = `https://www.vrbo.com/search/keywords:${q}`;
  const qs: string[] = [];
  if (params.checkIn)  qs.push(`arrival=${params.checkIn}`);
  if (params.checkOut) qs.push(`departure=${params.checkOut}`);
  qs.push(`numAdults=${params.guests}`);
  if (qs.length > 0) url += `?${qs.join('&')}`;
  return url;
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

// ── Lodging preference aggregation ───────────────────────────────────────────

function dominantLodgingPref(prefs: (LodgingPref | null)[]): LodgingPref {
  const counts: Record<LodgingPref, number> = { hotel: 0, rental: 0, either: 0 };
  for (const p of prefs) {
    if (p) counts[p]++;
  }
  const hotelScore = counts.hotel + counts.either * 0.5;
  const rentalScore = counts.rental + counts.either * 0.5;
  if (hotelScore > rentalScore && counts.hotel > 0) return 'hotel';
  if (rentalScore > hotelScore && counts.rental > 0) return 'rental';
  return 'either';
}

function platformsFor(pref: LodgingPref): Platform[] {
  if (pref === 'hotel') return ['booking'];
  if (pref === 'rental') return ['airbnb', 'vrbo'];
  return ['airbnb', 'vrbo', 'booking'];
}

function recommendedPlatformFor(pref: LodgingPref): RecommendedPlatform {
  if (pref === 'hotel') return 'booking';
  if (pref === 'rental') return 'airbnb';
  return 'mixed';
}

function parseBudgetPerPerson(s: string | null): number | null {
  if (!s) return null;
  const cleaned = s.toLowerCase().replace(/,/g, '');
  const numRe = /(\d+(?:\.\d+)?)(k)?/g;
  const nums: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(cleaned)) !== null) {
    const n = parseFloat(m[1]) * (m[2] === 'k' ? 1000 : 1);
    nums.push(n);
  }
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];
  return (nums[0] + nums[1]) / 2;
}

// ── Cache signature ──────────────────────────────────────────────────────────
//
// The signature is a stable string of every input that affects the
// suggestion payload. The same algorithm runs client-side
// (`computeLodgingSignature` in src/lib/lodgingSignature.ts) so the client
// can verify a cached row before rendering it.

interface SignatureInputs {
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  groupSize: number;
  budgetPerPerson: string | null;
  flightCostPerPerson: number | null;
  tripType: string | null;
  prefSummary: {
    total: number;
    counts: Record<LodgingPref, number>;
    sleepCounts: Record<'own_room' | 'own_bed' | 'share_bed' | 'flexible', number>;
    lastUpdatedAt: string | null;
  };
}

function computeSignature(input: SignatureInputs): string {
  const parts = [
    CACHE_SIGNATURE_VERSION,
    input.destination ?? '',
    input.startDate ?? '',
    input.endDate ?? '',
    String(input.groupSize),
    input.budgetPerPerson ?? '',
    input.flightCostPerPerson != null ? String(input.flightCostPerPerson) : '',
    input.tripType ?? '',
    String(input.prefSummary.total),
    String(input.prefSummary.counts.hotel ?? 0),
    String(input.prefSummary.counts.rental ?? 0),
    String(input.prefSummary.counts.either ?? 0),
    String(input.prefSummary.sleepCounts.own_room ?? 0),
    String(input.prefSummary.sleepCounts.own_bed ?? 0),
    String(input.prefSummary.sleepCounts.share_bed ?? 0),
    String(input.prefSummary.sleepCounts.flexible ?? 0),
    input.prefSummary.lastUpdatedAt ?? '',
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      getPublishableKey(),
      { global: { headers: { Authorization: authHeader } } }
    );

    // Service-role client is used for cache writebacks. RLS would block
    // the user-scoped client from writing to the cache columns when the
    // call originates from a non-planner (or from the trigger).
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      getServiceRoleKey(),
      { auth: { persistSession: false } }
    );

    const body = await req.json() as { trip_id?: string; warm?: boolean; note?: string };
    const trip_id = body.trip_id;
    const isWarmCall = body.warm === true;
    // Optional planner-supplied steering note ("more boutique hotels",
    // "near the beach"). When present we treat the call as a one-off
    // re-roll: skip the cache on read AND skip the cache writeback so we
    // don't poison the canonical cached payload with note-tuned results.
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const hasNote = note.length > 0;
    if (!trip_id) {
      return new Response(JSON.stringify({ error: 'trip_id required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── Fetch trip + member preferences ───────────────────────────────────────
    const [tripRes, respondentsRes, prefsRes] = await Promise.all([
      // Use admin client so warm-cache calls (no user JWT) still see the row.
      supabaseAdmin.from('trips').select('*').eq('id', trip_id).single(),
      supabaseAdmin.from('respondents').select('id, phone, rsvp_status').eq('trip_id', trip_id),
      supabaseAdmin
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

    const phones = respondents
      .map((r: { phone: string | null }) => r.phone)
      .filter((p): p is string => !!p);
    let travelerProfiles: Array<{
      lodging_pref: LodgingPref | null;
      sleep_pref: 'own_room' | 'own_bed' | 'share_bed' | 'flexible' | null;
      budget_posture: BudgetPosture | null;
      updated_at: string;
    }> = [];
    if (phones.length > 0) {
      const profilesRes = await supabaseAdmin
        .from('traveler_profiles')
        .select('lodging_pref, sleep_pref, budget_posture, updated_at')
        .in('phone', phones);
      travelerProfiles = profilesRes.data ?? [];
    }

    const destination = trip.destination ?? trip.name ?? 'the destination';
    const checkIn = trip.start_date ?? null;
    const checkOut = trip.end_date ?? null;
    const groupSize = trip.group_size_precise ?? respondents.length + 1 ?? 4;
    const budgetLabel = trip.budget_per_person ?? null;
    const tripType = trip.trip_type ?? null;
    const flightCostPerPerson: number | null = typeof trip.estimated_flight_cost_per_person === 'number'
      ? trip.estimated_flight_cost_per_person
      : null;

    // ── PrefSummary fingerprint (matches client `getGroupLodgingPrefSummary`) ─
    const lodgingCounts: Record<LodgingPref, number> = { hotel: 0, rental: 0, either: 0 };
    const sleepCounts: Record<'own_room' | 'own_bed' | 'share_bed' | 'flexible', number> = {
      own_room: 0, own_bed: 0, share_bed: 0, flexible: 0,
    };
    let lastUpdatedAt: string | null = null;
    for (const p of travelerProfiles) {
      if (p.lodging_pref) lodgingCounts[p.lodging_pref]++;
      if (p.sleep_pref) sleepCounts[p.sleep_pref]++;
      if (!lastUpdatedAt || p.updated_at > lastUpdatedAt) lastUpdatedAt = p.updated_at;
    }
    const prefSummary = {
      total: travelerProfiles.length,
      counts: lodgingCounts,
      sleepCounts,
      lastUpdatedAt,
    };

    // ── Cache check ───────────────────────────────────────────────────────────
    const signature = computeSignature({
      destination: trip.destination ?? null,
      startDate: checkIn,
      endDate: checkOut,
      groupSize,
      budgetPerPerson: budgetLabel,
      flightCostPerPerson,
      tripType,
      prefSummary,
    });

    // Cache short-circuits ONLY when there's no steering note. With a note
    // the planner is explicitly asking for a re-roll; we always recompute
    // and never write the result back to the cached_lodging_suggestions
    // column (otherwise the next planner without a note would inherit
    // someone else's tuned results).
    if (
      !hasNote &&
      trip.cached_lodging_suggestions_signature === signature &&
      trip.cached_lodging_suggestions
    ) {
      const cached = trip.cached_lodging_suggestions as CachedPayload;
      if (isWarmCall) {
        return new Response(JSON.stringify({ ok: true, cached: true }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ...cached, cached: true }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── Cache miss — compute via Gemini ───────────────────────────────────────
    const lodgingPref = dominantLodgingPref(travelerProfiles.map((p) => p.lodging_pref));
    const allowedPlatforms = platformsFor(lodgingPref);
    const recommendedPlatform = recommendedPlatformFor(lodgingPref);

    const postureCounts: Record<BudgetPosture, number> = { splurge: 0, middle: 0, budget: 0, flexible: 0 };
    for (const p of travelerProfiles) {
      if (p.budget_posture) postureCounts[p.budget_posture]++;
    }
    const dominantPosture = (Object.entries(postureCounts) as Array<[BudgetPosture, number]>)
      .sort((a, b) => b[1] - a[1])[0];
    const budgetPosture: BudgetPosture | null = dominantPosture && dominantPosture[1] > 0 ? dominantPosture[0] : null;

    const allNeeds = prefs.flatMap((p: { needs: string[] | null }) => p.needs ?? []);
    const accessibilityNeeds = allNeeds.filter((n) =>
      ['wheelchair', 'mobility', 'accessible'].some((k) => n.toLowerCase().includes(k))
    );
    const allVibes = prefs.flatMap((p: { vibes: string[] | null }) => p.vibes ?? []);
    const energyLevels = prefs.map((p: { energy: string | null }) => p.energy).filter(Boolean);
    const relaxingCount = energyLevels.filter((e: string) => e === 'relaxing').length;
    const adventurousCount = energyLevels.filter((e: string) => e === 'adventurous').length;
    const dominantEnergy = relaxingCount > adventurousCount ? 'relaxing' : adventurousCount > relaxingCount ? 'adventurous' : 'mixed';

    const nights = checkIn && checkOut
      ? Math.round((new Date(checkOut + 'T12:00:00').getTime() - new Date(checkIn + 'T12:00:00').getTime()) / 86400000)
      : null;

    const budgetTotalPerPerson = parseBudgetPerPerson(budgetLabel);
    const remainingPerPerson = budgetTotalPerPerson != null
      ? Math.max(0, budgetTotalPerPerson - (flightCostPerPerson ?? 0))
      : null;
    const lodgingBudgetTotalForGroup = remainingPerPerson != null
      ? Math.round(remainingPerPerson * groupSize)
      : null;
    const lodgingNightlyForGroup = lodgingBudgetTotalForGroup != null && nights && nights > 0
      ? Math.round(lodgingBudgetTotalForGroup / nights)
      : null;

    const lodgingDirective = lodgingPref === 'hotel'
      ? 'The group prefers HOTELS / B&Bs over home rentals. Suggest only hotels, boutique hotels, B&Bs, or hostels. Use the booking platform.'
      : lodgingPref === 'rental'
      ? 'The group prefers HOME RENTALS (Airbnb / VRBO style) over hotels. Suggest only entire homes, apartments, villas, or cottages. Use airbnb and vrbo platforms.'
      : 'The group is mixed on hotel vs. rental — include a variety: at least one hotel option (booking) and at least one home rental option (airbnb/vrbo).';

    const budgetBlock = lodgingBudgetTotalForGroup != null
      ? `- Per-person total budget: ${budgetLabel}${flightCostPerPerson ? ` (≈$${flightCostPerPerson}/person reserved for flights)` : ''}\n- Remaining lodging budget for the whole group: ≈$${lodgingBudgetTotalForGroup}${lodgingNightlyForGroup != null ? ` (≈$${lodgingNightlyForGroup}/night for the group across ${nights} nights)` : ''}\n- Suggestions MUST fit within this remaining lodging budget.`
      : budgetLabel
      ? `- Budget per person (total trip): ${budgetLabel}`
      : '';

    const prompt = `
You are a travel planning assistant helping a group find the ideal lodging.

Trip context:
- Destination: ${destination}
${checkIn ? `- Check-in: ${checkIn}` : ''}
${checkOut ? `- Check-out: ${checkOut}` : ''}
${nights ? `- Duration: ${nights} nights` : ''}
- Group size: ${groupSize} people
${budgetBlock}
${tripType ? `- Trip type: ${tripType}` : ''}
${dominantEnergy !== 'mixed' ? `- Group energy: mostly ${dominantEnergy}` : '- Group energy: mixed adventurous/relaxing'}
${budgetPosture ? `- Group budget posture: ${budgetPosture}` : ''}
${allVibes.length > 0 ? `- Group vibes: ${[...new Set(allVibes)].slice(0, 5).join(', ')}` : ''}
${accessibilityNeeds.length > 0 ? `- Accessibility needs: ${accessibilityNeeds.join(', ')}` : ''}

Lodging style: ${lodgingDirective}
${hasNote ? `\nPlanner steering note (apply this directly — it overrides any prior leaning): "${note}"\n` : ''}
Suggest exactly 3 distinct lodging options, from most to least expensive. Each option should represent a genuinely different approach within the lodging style above (e.g., for rentals: luxury villa vs. central apartment vs. budget cottage; for hotels: boutique vs. mid-range chain vs. budget pick).

Respond with ONLY a JSON array of 3 objects, no markdown, no explanation:
[
  {
    "index": 0,
    "label": "short catchy name (3-4 words)",
    "description": "1-2 sentence rationale for why this works for this group",
    "propertyType": "e.g. entire home, apartment, villa, hotel, B&B",
    "idealFor": "short phrase, e.g. 'groups who want a home base to cook and relax'",
    "estimatedNightlyRate": "e.g. '$300–500/night total' or null if unknown",
    "searchArea": "specific neighborhood or area within ${destination} to search in",
    "platforms": ${JSON.stringify(allowedPlatforms)}
  },
  ...
]

For "platforms": include only platforms from this allowed set: ${JSON.stringify(allowedPlatforms)}. Apply these property→platform rules within that set:
- Entire homes, cottages, cabins, villas → ["airbnb", "vrbo"]
- Hotels, motels, B&Bs, hostels → ["booking"]
- Apartments, condos → ["airbnb", "booking"] (intersect with allowed)
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

    let rawSuggestions: Array<{
      index: number;
      label: string;
      description: string;
      propertyType: string;
      idealFor: string;
      estimatedNightlyRate: string | null;
      searchArea: string;
      platforms?: Platform[];
    }>;

    try {
      rawSuggestions = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\[[\s\S]*\]/);
      rawSuggestions = match ? JSON.parse(match[0]) : [];
    }

    const searchParams = { destination, checkIn, checkOut, guests: groupSize };
    const suggestions: LodgingSuggestion[] = rawSuggestions.map((s) => {
      const requested: Platform[] = Array.isArray(s.platforms) ? s.platforms : allowedPlatforms;
      const platforms = requested.filter((p) => allowedPlatforms.includes(p));
      const finalPlatforms = platforms.length > 0 ? platforms : allowedPlatforms;
      const area = s.searchArea ?? destination;
      return {
        index: s.index,
        label: s.label,
        description: s.description,
        propertyType: s.propertyType,
        idealFor: s.idealFor,
        estimatedNightlyRate: s.estimatedNightlyRate ?? null,
        platforms: finalPlatforms,
        airbnbUrl: finalPlatforms.includes('airbnb') ? buildAirbnbUrl({ ...searchParams, destination: area }) : null,
        vrboUrl: finalPlatforms.includes('vrbo') ? buildVrboUrl({ ...searchParams, destination: area }) : null,
        bookingUrl: finalPlatforms.includes('booking') ? buildBookingUrl({ ...searchParams, destination: area }) : null,
      };
    });

    const payload: CachedPayload = { suggestions, recommendedPlatform, lodgingPref };

    // ── Write cache ───────────────────────────────────────────────────────────
    // Service-role client bypasses RLS so the writeback always lands.
    // Skip the writeback when a steering note was supplied — note-tuned
    // results are intentionally one-offs and shouldn't replace the
    // canonical cache that other planners + the warm trigger rely on.
    if (!hasNote) {
      const { error: writeErr } = await supabaseAdmin
        .from('trips')
        .update({
          cached_lodging_suggestions: payload,
          cached_lodging_suggestions_signature: signature,
          cached_lodging_suggestions_updated_at: new Date().toISOString(),
        })
        .eq('id', trip_id);
      if (writeErr) {
        console.error('cache write failed:', writeErr.message);
        // Non-fatal — return the freshly computed payload anyway.
      }
    }

    if (isWarmCall) {
      return new Response(JSON.stringify({ ok: true, cached: false }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ...payload, cached: false }), {
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
