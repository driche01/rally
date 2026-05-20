/**
 * POST /api/trips/[id]/travel/suggest-flights
 *
 * Planner/cohost asks Gemini (grounded) for 3-5 flight options for
 * one specific member, based on their home airport (from the
 * traveler_profile) → trip destination on the trip dates.
 *
 * Body: { respondent_id: string, override_origin?: string, override_destination_airport?: string }
 *
 * Returns the suggestions in-line (does NOT persist to DB — flight
 * options are ephemeral; the member can then enter their actual
 * booking via the arrangements endpoint).
 */

import { resolveTripParticipant } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { callGeminiJson } from "@/lib/ai/gemini";
import { jsonErr, jsonOk } from "@/lib/http";

interface FlightOption {
  airline: string;
  flight_numbers?: string[];
  origin_airport: string;
  destination_airport: string;
  depart_local: string;       // ISO datetime in origin local time, ideally
  arrive_local: string;
  stops: number;
  duration_minutes: number;
  price_usd: number;
  booking_url: string;        // Google Flights deep link (or airline)
  notes?: string;
}

interface FlightResponse {
  options: FlightOption[];
  note?: string;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: trip_id } = await ctx.params;

  // Auth (alpha, 2026-05-19): any trip participant can run flight
  // suggestions for any member. Planner/cohost/respondent all welcome.
  const r = await resolveTripParticipant(trip_id);
  if (!r.ok) return jsonErr(r.status, r.status === 401 ? "unauthenticated" : "forbidden");

  const body = (await req.json().catch(() => null)) as
    | { respondent_id?: string; override_origin?: string; override_destination_airport?: string }
    | null;
  if (!body?.respondent_id) return jsonErr(400, "respondent_id_required");

  const svc = createServiceClient();

  // Trip details for the Gemini prompt.
  const { data: trip } = await svc
    .from("trips")
    .select("id, name, destination, destination_address, start_date, end_date")
    .eq("id", trip_id).maybeSingle();
  if (!trip) return jsonErr(404, "trip_not_found");

  if (!trip.start_date || !trip.end_date) {
    return jsonErr(400, "dates_required");
  }

  // Get the member's name + phone for the traveler_profile lookup.
  const { data: resp } = await svc
    .from("respondents")
    .select("id, name, phone")
    .eq("id", body.respondent_id).maybeSingle();
  if (!resp || !resp.phone) return jsonErr(404, "respondent_not_found_or_no_phone");

  const { data: profile } = await svc
    .from("traveler_profiles")
    .select("home_airport")
    .eq("phone", resp.phone)
    .maybeSingle();

  const origin = body.override_origin?.trim().toUpperCase()
    ?? profile?.home_airport?.trim().toUpperCase()
    ?? null;

  if (!origin) {
    return jsonErr(400, "origin_airport_unknown",
      "Member's home airport isn't on file. Pass override_origin or have them update their profile.");
  }

  const destinationAirport = body.override_destination_airport?.trim().toUpperCase();
  // Prefer the full address ("Paris, France") over the short
  // destination ("Paris") so Gemini's grounded search has enough
  // context to disambiguate. The short destination is the fallback
  // for trips created before the autocomplete shipped (migration 150)
  // or when the planner typed freeform without picking a suggestion.
  const destinationLabel = (trip.destination_address as string | null)?.trim()
    || trip.destination?.trim()
    || "the trip's destination";
  const destinationText = destinationAirport
    ? `airport code ${destinationAirport}`
    : `${destinationLabel}${destinationAirport ? ` (${destinationAirport})` : ""}`;

  const prompt = `Find 3-5 real flight options for one person attending a group trip.

Origin airport: ${origin}
Destination: ${destinationText}
Depart: on or near ${trip.start_date}
Return: on or near ${trip.end_date}
Passenger: 1

Use Google Search to ground prices + schedules.

For each option:
- airline name
- flight number(s) (if direct, one; if connecting, both)
- origin + destination airport codes
- depart datetime (local origin time, ISO 8601)
- arrive datetime (local destination time, ISO 8601)
- number of stops
- total duration in minutes
- estimated USD price
- a Google Flights deep link (https://www.google.com/travel/flights?...)
- a one-sentence notes field (e.g. "cheapest", "non-stop", "best timing for the rest of the group")

Output strict JSON only (no prose, no fences):
{
  "options": [
    {
      "airline": "...",
      "flight_numbers": ["AA123", "AA456"],
      "origin_airport": "${origin}",
      "destination_airport": "${destinationAirport ?? "..."}",
      "depart_local": "2026-MM-DDT07:30",
      "arrive_local": "2026-MM-DDT11:45",
      "stops": 0,
      "duration_minutes": 255,
      "price_usd": 420,
      "booking_url": "https://www.google.com/travel/flights?...",
      "notes": "non-stop, mid-morning arrival"
    }
  ],
  "note": "(optional caveats)"
}`;

  const result = await callGeminiJson<FlightResponse>({
    admin: svc,
    tripId: trip_id,
    // Anonymous respondent callers may not have an authUid — pass null
    // in that case; the generation log just records "anon" for the caller.
    callerUserId: r.participant.authUid ?? null,
    kind: "flight_suggest",
    user: prompt,
    grounded: true,
    maxOutputTokens: 2400,
  });
  if (!result.ok) return jsonErr(502, "gemini_failed", result.error);

  const options = Array.isArray(result.data.options) ? result.data.options : [];
  if (options.length === 0) {
    // Gemini answered, just with zero options — almost always because
    // the destination is too vague (e.g., "Italy" with no airport
    // code), the dates are outside Google Flights' search window
    // (more than ~330 days out / in the past), or the origin airport
    // wasn't recognized. Surface the model's own `note` field so the
    // planner sees the actual reason instead of a bare "no_options".
    const reason = result.data.note?.trim()
      || `No flight options came back from ${origin} → ${destinationText}. Try a more specific destination (city or airport code) or check the trip dates.`;
    return jsonErr(502, "no_options", reason);
  }

  return jsonOk({
    respondent_id: resp.id,
    name: resp.name,
    origin,
    destination: destinationAirport ?? trip.destination ?? null,
    options,
    note: result.data.note ?? null,
  });
}
