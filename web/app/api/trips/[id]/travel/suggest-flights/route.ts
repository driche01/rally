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

import { requireAuthUid } from "@/lib/auth";
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
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as
    | { respondent_id?: string; override_origin?: string; override_destination_airport?: string }
    | null;
  if (!body?.respondent_id) return jsonErr(400, "respondent_id_required");

  // Authorize.
  const { data: trip } = await r.supabase
    .from("trips")
    .select("id, name, destination, start_date, end_date, created_by")
    .eq("id", trip_id).maybeSingle();
  if (!trip) return jsonErr(404, "trip_not_found");
  if (trip.created_by !== r.authUid) {
    const { data: cohost } = await r.supabase
      .from("trip_cohosts").select("trip_id")
      .eq("trip_id", trip_id).eq("user_id", r.authUid).maybeSingle();
    if (!cohost) return jsonErr(403, "forbidden");
  }

  if (!trip.start_date || !trip.end_date) {
    return jsonErr(400, "dates_required");
  }

  const svc = createServiceClient();

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
  const destinationText = destinationAirport
    ? `airport code ${destinationAirport}`
    : `${trip.destination ?? "the trip's destination"}${destinationAirport ? ` (${destinationAirport})` : ""}`;

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
    callerUserId: r.authUid,
    kind: "flight_suggest",
    user: prompt,
    grounded: true,
    maxOutputTokens: 2400,
  });
  if (!result.ok) return jsonErr(502, "gemini_failed", result.error);

  const options = Array.isArray(result.data.options) ? result.data.options : [];
  if (options.length === 0) return jsonErr(502, "no_options");

  return jsonOk({
    respondent_id: resp.id,
    name: resp.name,
    origin,
    destination: destinationAirport ?? trip.destination ?? null,
    options,
    note: result.data.note ?? null,
  });
}
