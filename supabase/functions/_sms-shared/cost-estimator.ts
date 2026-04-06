/**
 * Component 10: CostEstimator
 *
 * Uses Gemini API with Google Search grounding for:
 *   - Flight cost estimates (per origin × destination pair)
 *   - Lodging cost estimates (group rental default)
 *   - Subgroup flight coalescing (specific bookable flights)
 *   - Lodging recommendations (Phase 4)
 *   - Flight price monitoring (buy-now-vs-wait)
 *
 * All Gemini responses are JSON-parsed with markdown fence stripping.
 */

// ─── Gemini JSON parsing ─────────────────────────────────────────────────────

// #77 — Strips markdown fences before JSON.parse. callGeminiWithRetry retries
// once on failure. On final failure, returns null (marks estimate unavailable).
function parseGeminiJson(raw: string): unknown {
  // Strategy 1: Strip markdown fences and parse directly
  const stripped = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Strategy 2: Extract JSON object/array from mixed text
    // Grounded responses often include natural language around the JSON
    const jsonMatch = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // Fall through
      }
    }
    throw new Error(`Cannot parse Gemini response as JSON. Raw text: ${raw.slice(0, 300)}`);
  }
}

async function callGemini(prompt: string): Promise<unknown | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    console.error('[cost-estimator] GEMINI_API_KEY not set');
    return null;
  }

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
        }),
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[cost-estimator] Gemini API error:', response.status, errBody.slice(0, 500));
      return null;
    }

    const result = await response.json();
    const candidate = result.candidates?.[0];

    // Check for blocked/safety filtered responses
    if (candidate?.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
      console.error('[cost-estimator] Gemini finish reason:', candidate.finishReason,
        'Safety ratings:', JSON.stringify(candidate.safetyRatings ?? []).slice(0, 300));
      return null;
    }

    // With google_search grounding, text may be across multiple parts
    const parts = candidate?.content?.parts ?? [];
    const text = parts.map((p: { text?: string }) => p.text ?? '').join('').trim();
    if (!text) {
      console.error('[cost-estimator] Gemini returned no text. Parts:', JSON.stringify(parts).slice(0, 300),
        'Full response:', JSON.stringify(result).slice(0, 500));
      return null;
    }

    return parseGeminiJson(text);
  } catch (err) {
    console.error('[cost-estimator] Gemini call failed:', (err as Error).message ?? err);
    return null;
  }
}

// Retry wrapper
async function callGeminiWithRetry(prompt: string): Promise<unknown | null> {
  const result = await callGemini(prompt);
  if (result !== null) return result;

  // One retry
  console.log('[cost-estimator] Retrying Gemini call...');
  return callGemini(prompt);
}

// ─��─ Flight cost estimation ──────────────────────────────────────────────────

export interface FlightEstimate {
  origin: string;
  destination: string;
  low: number;
  mid: number;
  high: number;
  google_flights_url: string;
}

export interface FlightExample {
  origin: string;
  destination: string;
  airline: string;
  price: number;
  booking_url: string;
}

export async function estimateFlightCost(
  origin: string,
  destination: string,
  startDate: string,
  endDate: string,
): Promise<{ estimate: FlightEstimate | null; example: FlightExample | null }> {
  const estimatePrompt = `Find a round-trip economy flight search link from ${origin} to ${destination} for ${startDate}–${endDate} on Google Flights. Return a JSON object with keys: low (integer USD, budget estimate), mid (integer USD, standard estimate), high (integer USD, flexible), google_flights_url (string, deep link to this search on Google Flights). No explanation.`;

  const examplePrompt = `Using Google Flights, find a real round-trip economy flight from ${origin} to ${destination} departing ${startDate} returning ${endDate}. Return a JSON object with keys: airline (string), price (integer, USD), booking_url (string, Google Flights deep link URL). No explanation.`;

  const [estimateResult, exampleResult] = await Promise.all([
    callGeminiWithRetry(estimatePrompt),
    callGeminiWithRetry(examplePrompt),
  ]);

  // #82 — If Gemini returns no data (e.g. "no flights found"), estimate is null.
  // phase-flow.ts shows a fallback message when CostEstimator returns null.
  const estimate = estimateResult
    ? { origin, destination, ...(estimateResult as Omit<FlightEstimate, 'origin' | 'destination'>) }
    : null;

  const rawExample = exampleResult
    ? { origin, destination, ...(exampleResult as Omit<FlightExample, 'origin' | 'destination'>) }
    : null;

  // Validate example — discard if airline is null/empty or price is 0/missing
  const example = (rawExample && rawExample.airline && rawExample.price > 0) ? rawExample : null;

  return { estimate, example };
}

// ─── Lodging cost estimation ─────────────────────────────────────────────────

export interface LodgingEstimate {
  property_name: string;
  total_per_night: number;
  listing_url: string | null;
}

export async function estimateLodgingCost(
  destination: string,
  startDate: string,
  endDate: string,
  headcount: number,
): Promise<LodgingEstimate | null> {
  const prompt = `Using Airbnb and VRBO listing data, find a real or representative vacation rental in ${destination} that comfortably sleeps ${headcount} people, available for the dates ${startDate} to ${endDate}. Return a JSON object with keys: property_name (string), total_per_night (integer, USD, total not per person), listing_url (string, direct Airbnb or VRBO URL if available, else null). No explanation.`;

  const result = await callGeminiWithRetry(prompt);
  return result as LodgingEstimate | null;
}

// ─── Full cost estimation (Step 6) ──────────────────────────────────────────

export interface CostEstimateResult {
  destination: string;
  flight_low: number;
  flight_mid: number;
  flight_high: number;
  example_flight: FlightExample | null;
  per_person_lodging_cost: number;
  example_lodging: LodgingEstimate | null;
  lodging_type_used: string;
  fetched_at: string;
}

export async function runFullEstimate(
  destination: string,
  origins: { origin: string; count: number }[],
  startDate: string,
  endDate: string,
  headcount: number,
): Promise<CostEstimateResult | null> {
  // Use most common origin for the primary estimate
  const primaryOrigin = origins.sort((a, b) => b.count - a.count)[0]?.origin;
  if (!primaryOrigin) return null;

  const nights = Math.ceil(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / (24 * 60 * 60 * 1000),
  );

  const [flightResult, lodgingResult] = await Promise.all([
    estimateFlightCost(primaryOrigin, destination, startDate, endDate),
    estimateLodgingCost(destination, startDate, endDate, headcount),
  ]);

  const perPersonLodging = lodgingResult
    ? Math.round((lodgingResult.total_per_night * nights) / headcount)
    : 0;

  return {
    destination,
    flight_low: flightResult.estimate?.low ?? 0,
    flight_mid: flightResult.estimate?.mid ?? 0,
    flight_high: flightResult.estimate?.high ?? 0,
    example_flight: flightResult.example,
    per_person_lodging_cost: perPersonLodging,
    example_lodging: lodgingResult,
    lodging_type_used: 'group_rental',
    fetched_at: new Date().toISOString(),
  };
}

// ─── Subgroup flight coalescing ──────────────────────────────────────────────

export interface SubgroupFlight {
  airline: string;
  flight_number: string;
  departure_time: string;
  arrival_time: string;
  price: number;
  booking_url: string;
}

export async function getSubgroupFlight(
  origin: string,
  destination: string,
  startDate: string,
  endDate: string,
): Promise<SubgroupFlight | null> {
  const prompt = `Using Google Flights, find one specific round-trip economy flight from ${origin} to ${destination} departing ${startDate} returning ${endDate}. Pick the best combination of price and convenient departure time (prefer morning departures). Return a JSON object: { airline, flight_number, departure_time, arrival_time, price (integer USD), booking_url }. No explanation.`;

  const result = await callGeminiWithRetry(prompt);
  return result as SubgroupFlight | null;
}

// ─── Lodging recommendations (Phase 4) ──────────────────────────────────────

export interface LodgingRecommendation {
  name: string;
  type: string;
  bedrooms: number;
  total_cost: number;
  per_person_cost: number;
  short_description: string;
  listing_url: string | null;
}

export async function getLodgingRecommendations(
  destination: string,
  startDate: string,
  endDate: string,
  headcount: number,
  preferences: string,
): Promise<LodgingRecommendation[]> {
  const prompt = `Using Airbnb, VRBO, and Google Hotels data, find 3–5 lodging options in ${destination} for ${headcount} people from ${startDate} to ${endDate}. Preferences: ${preferences || 'none specified'}. For each option return: name (string), type (string, e.g. "beach house" or "boutique hotel"), bedrooms (integer), total_cost (integer, USD, full stay not per night), per_person_cost (integer, USD), short_description (string, max 20 words), listing_url (string). Return a JSON array. No explanation.`;

  const result = await callGeminiWithRetry(prompt);
  if (!Array.isArray(result)) return [];
  return result as LodgingRecommendation[];
}

// ─── Flight price monitoring (buy-now-vs-wait) ──────────────────────────────

export interface FlightPriceCheck {
  current_price: number;
  typical_low: number;
  typical_high: number;
  trend: 'rising' | 'falling' | 'stable' | 'unknown';
  recommendation: 'buy_now' | 'wait' | 'neutral';
  google_flights_url: string;
}

export async function checkFlightPrice(
  origin: string,
  destination: string,
  startDate: string,
  endDate: string,
): Promise<FlightPriceCheck | null> {
  const prompt = `Using Google Flights, check current round-trip economy flight prices from ${origin} to ${destination} for ${startDate}–${endDate}.

Return a JSON object with:
- current_price (integer USD, cheapest option right now)
- typical_low (integer USD, low end of typical range for this route)
- typical_high (integer USD, high end of typical range)
- trend ("rising", "falling", "stable", or "unknown")
- recommendation ("buy_now" if price is good or expected to rise, "wait" if above typical and expected to drop, "neutral" if no strong signal)
- google_flights_url (string, search link)

No explanation.`;

  const result = await callGeminiWithRetry(prompt);
  return result as FlightPriceCheck | null;
}

// ──�� Message formatting helpers ──────────────────────────────────────────────

export function formatCostSummary(estimate: CostEstimateResult, headcount: number): string {
  const totalPerPerson = estimate.flight_mid + estimate.per_person_lodging_cost;
  const lines: string[] = [];

  lines.push(`${estimate.destination} \u2014 ~$${totalPerPerson}/person`);

  if (estimate.example_flight) {
    lines.push(
      `\u2708\uFE0F ${estimate.example_flight.airline}, ~$${estimate.example_flight.price} rt` +
        (estimate.example_flight.booking_url ? `: ${estimate.example_flight.booking_url}` : ''),
    );
  }

  if (estimate.example_lodging) {
    const ppCost = estimate.per_person_lodging_cost;
    lines.push(
      `\u{1F3E0} ${estimate.example_lodging.property_name} (sleeps ${headcount}), ~$${ppCost}/person` +
        (estimate.example_lodging.listing_url ? `: ${estimate.example_lodging.listing_url}` : ''),
    );
  }

  return lines.join('\n');
}

export function formatFlightPriceAlert(
  check: FlightPriceCheck,
  origin: string,
  destination: string,
): string {
  const { current_price, typical_low, typical_high, trend, recommendation } = check;

  if (recommendation === 'wait' && trend === 'falling') {
    return `${destination} flights from ${origin} are $${current_price} right now \u2014 above the typical $${typical_low}\u2013$${typical_high} range. Prices trending down. Worth waiting a week or two. I'll check again Monday.`;
  }

  if (recommendation === 'buy_now' && current_price > typical_high) {
    return `${destination} flights from ${origin} are $${current_price} and holding \u2014 this might be as good as it gets. Worth booking now. ${check.google_flights_url}`;
  }

  if (recommendation === 'buy_now' && current_price <= typical_high) {
    return `Flight update \u2708\uFE0F ${destination} from ${origin} just dropped to $${current_price} \u2014 that's in the normal range. Good time to book. ${check.google_flights_url}`;
  }

  // Neutral
  return `${destination} flights from ${origin} are running ~$${current_price} \u2014 normal for this route. No urgency either way.`;
}

// ─── Activity & restaurant recommendations (Phase 5) ─────────────────────────

export interface ActivityRecommendation {
  name: string;
  short_description: string;
  approx_cost_per_person: number;
  url: string;
  seasonal_note?: string;
}

export interface RestaurantRecommendation {
  name: string;
  cuisine: string;
  short_description: string;
  price_range: string;
  url: string;
}

export async function getActivityRecommendations(
  destination: string,
  headcount: number,
  tripMonth: string,
  tripSeason: string,
): Promise<ActivityRecommendation[]> {
  const prompt = `Using Google and travel sites, find 3 highly rated activities or experiences in ${destination} in ${tripMonth} (${tripSeason}) that would appeal to a group of ${headcount} friends. Consider what's in season, any seasonal events or festivals, and what's actually good to do at this time of year. Return a JSON array, each with: name (string), short_description (string, max 15 words), approx_cost_per_person (integer, USD or 0 if free), url (string), seasonal_note (string, max 10 words, why this is good in ${tripMonth} — omit if not relevant). No explanation.`;

  const result = await callGeminiWithRetry(prompt);
  if (!Array.isArray(result)) return [];
  return result as ActivityRecommendation[];
}

export async function getRestaurantRecommendations(
  destination: string,
  headcount: number,
  tripMonth: string,
  tripSeason: string,
): Promise<RestaurantRecommendation[]> {
  const prompt = `Using Google Maps and restaurant review sites, find 3 great restaurants in ${destination} suitable for a group of ${headcount} visiting in ${tripMonth}. Mix of vibes (e.g. one casual, one mid-range, one special occasion). Consider outdoor seating suitability for ${tripSeason}. Return a JSON array, each with: name (string), cuisine (string), short_description (string, max 12 words), price_range (string, e.g. "$$"), url (string). No explanation.`;

  const result = await callGeminiWithRetry(prompt);
  if (!Array.isArray(result)) return [];
  return result as RestaurantRecommendation[];
}
