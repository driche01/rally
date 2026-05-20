/**
 * POST /api/trips/[id]/travel/arrangements
 *   Upsert a per-member travel arrangement.
 *   Body: {
 *     respondent_id?: string,   // target arrangement (omit = caller's own)
 *     session_token?: string,   // legacy path — cookie now supplies this
 *     arrival_mode?: 'flight'|'drive'|'train'|'other',
 *     arrival_datetime?: string,    // ISO
 *     departure_datetime?: string,  // ISO
 *     flight_number?: string,
 *     flight_origin_airport?: string,
 *     flight_destination_airport?: string,
 *     vehicle_capacity?: number,    // for drivers
 *     gear_notes?: string,
 *   }
 *
 * Auth (alpha, 2026-05-19): any trip participant can edit any
 * arrangement. The participant is resolved via resolveTripParticipant
 * which checks auth.uid() first, then the rally_session_token cookie.
 * The body.session_token path is kept for clients that pass the token
 * explicitly rather than via cookie.
 */

import { resolveTripParticipant } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

const ALLOWED_MODES = new Set(["flight", "drive", "train", "other"]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: trip_id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as
    | {
        respondent_id?: string;
        session_token?: string;
        arrival_mode?: string;
        arrival_datetime?: string;
        departure_datetime?: string;
        flight_number?: string;
        flight_origin_airport?: string;
        flight_destination_airport?: string;
        vehicle_capacity?: number;
        gear_notes?: string;
      }
    | null;
  if (!body) return jsonErr(400, "invalid_json");

  const svc = createServiceClient();

  // Authorize: who's making this call?
  // Path A: legacy body.session_token (some clients pass the cookie
  // value explicitly). Maps to a respondent on this trip.
  // Path B: cookie or auth — resolveTripParticipant figures it out.
  let callerRespondentId: string | null = null;
  if (typeof body.session_token === "string" && body.session_token.trim()) {
    const { data } = await svc
      .from("respondents").select("id")
      .eq("trip_id", trip_id).eq("session_token", body.session_token.trim())
      .maybeSingle();
    if (!data) return jsonErr(404, "respondent_not_found");
    callerRespondentId = data.id;
  } else {
    const r = await resolveTripParticipant(trip_id);
    if (!r.ok) return jsonErr(r.status, r.status === 401 ? "unauthenticated" : "forbidden");
    callerRespondentId = r.participant.respondentId;
  }

  // Resolve target arrangement. Explicit respondent_id wins; otherwise
  // edit caller's own row. Any participant can edit any target (alpha
  // policy — every trip member is a planner-equivalent collaborator).
  let respondent_id: string | null = null;
  if (typeof body.respondent_id === "string" && body.respondent_id.trim()) {
    const { data: target } = await svc
      .from("respondents").select("id, trip_id")
      .eq("id", body.respondent_id).maybeSingle();
    if (!target || target.trip_id !== trip_id) return jsonErr(404, "respondent_not_found");
    respondent_id = target.id;
  } else if (callerRespondentId) {
    respondent_id = callerRespondentId;
  } else {
    return jsonErr(400, "respondent_id_required");
  }

  // Validate inputs.
  if (body.arrival_mode && !ALLOWED_MODES.has(body.arrival_mode)) {
    return jsonErr(400, "invalid_arrival_mode");
  }
  if (body.vehicle_capacity != null &&
      (typeof body.vehicle_capacity !== "number" || body.vehicle_capacity < 0)) {
    return jsonErr(400, "invalid_vehicle_capacity");
  }

  const row = {
    trip_id,
    respondent_id,
    arrival_mode:               body.arrival_mode ?? null,
    arrival_datetime:           body.arrival_datetime ?? null,
    departure_datetime:         body.departure_datetime ?? null,
    flight_number:              body.flight_number?.trim() ?? null,
    flight_origin_airport:      body.flight_origin_airport?.trim().toUpperCase() ?? null,
    flight_destination_airport: body.flight_destination_airport?.trim().toUpperCase() ?? null,
    vehicle_capacity:           body.vehicle_capacity ?? null,
    gear_notes:                 body.gear_notes?.trim().slice(0, 1000) ?? null,
    updated_at:                 new Date().toISOString(),
  };

  const { data, error } = await svc
    .from("travel_arrangements")
    .upsert(row, { onConflict: "trip_id,respondent_id" })
    .select("*")
    .single();
  if (error) return jsonErr(500, "arrangement_upsert_failed", error.message);

  return jsonOk(data);
}
