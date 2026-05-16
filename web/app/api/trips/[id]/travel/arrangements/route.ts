/**
 * POST /api/trips/[id]/travel/arrangements
 *   Upsert a per-member travel arrangement.
 *   Body: {
 *     respondent_id?: string,   // planner only — edit on someone's behalf
 *     session_token?: string,   // member self-edit (anon-friendly)
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
 * Auth: planner/cohost can edit any arrangement by passing
 * respondent_id. Members edit their own by passing session_token.
 */

import { requireAuthUid } from "@/lib/auth";
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

  // Resolve respondent_id by either path.
  let respondent_id: string | null = null;
  if (typeof body.session_token === "string" && body.session_token.trim()) {
    const { data } = await svc
      .from("respondents").select("id")
      .eq("trip_id", trip_id).eq("session_token", body.session_token.trim())
      .maybeSingle();
    if (!data) return jsonErr(404, "respondent_not_found");
    respondent_id = data.id;
  } else if (typeof body.respondent_id === "string" && body.respondent_id.trim()) {
    // Planner-on-behalf path — auth required, planner/cohost.
    const r = await requireAuthUid();
    if (!r.ok) return jsonErr(r.status, "unauthenticated");
    const { data: trip } = await r.supabase
      .from("trips").select("id, created_by").eq("id", trip_id).maybeSingle();
    if (!trip) return jsonErr(404, "trip_not_found");
    if (trip.created_by !== r.authUid) {
      const { data: cohost } = await r.supabase
        .from("trip_cohosts").select("trip_id")
        .eq("trip_id", trip_id).eq("user_id", r.authUid).maybeSingle();
      if (!cohost) return jsonErr(403, "forbidden");
    }
    const { data: resp } = await svc
      .from("respondents").select("id, trip_id")
      .eq("id", body.respondent_id).maybeSingle();
    if (!resp || resp.trip_id !== trip_id) return jsonErr(404, "respondent_not_found");
    respondent_id = resp.id;
  } else {
    // No session_token, no respondent_id → try authed-self path.
    const r = await requireAuthUid();
    if (!r.ok) return jsonErr(r.status, "unauthenticated_no_token");
    const { data: u } = await svc
      .from("users").select("id").eq("auth_user_id", r.authUid).maybeSingle();
    if (!u?.id) return jsonErr(404, "rally_user_not_found");
    const { data: resp } = await svc
      .from("respondents").select("id")
      .eq("trip_id", trip_id).eq("user_id", u.id).maybeSingle();
    if (!resp?.id) return jsonErr(404, "respondent_not_found_for_authed_user");
    respondent_id = resp.id;
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
