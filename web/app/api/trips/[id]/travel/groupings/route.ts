/**
 * POST /api/trips/[id]/travel/groupings
 *   Any trip participant creates a car/shuttle grouping.
 *   Body: {
 *     direction: 'outbound'|'return',
 *     departure_datetime: ISO,
 *     driver_respondent_id?: string,
 *     notes?: string,                  // planner-logistics
 *     seats_total?: number,            // alpha+ Q30: defaults to
 *                                       // driver's vehicle_capacity
 *                                       // if set + driver_respondent_id
 *                                       // provided
 *     space_comfort?: 'tight'|'comfortable'|'spacious',
 *     ride_notes?: string              // driver-to-passengers
 *   }
 *
 * DELETE /api/trips/[id]/travel/groupings
 *   Body: { grouping_id: string }
 *
 * Auth (alpha, 2026-05-19): any trip participant — planner, cohost,
 * or respondent — can create/delete groupings. resolveTripParticipant
 * is the single gate.
 */

import { resolveTripParticipant } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: trip_id } = await ctx.params;
  const r = await resolveTripParticipant(trip_id);
  if (!r.ok) return jsonErr(r.status, r.status === 401 ? "unauthenticated" : "forbidden");

  const body = (await req.json().catch(() => null)) as
    | {
        direction?: string;
        departure_datetime?: string;
        driver_respondent_id?: string;
        notes?: string;
        seats_total?: number;
        space_comfort?: string;
        ride_notes?: string;
      }
    | null;
  if (!body) return jsonErr(400, "invalid_json");
  if (body.direction !== "outbound" && body.direction !== "return") {
    return jsonErr(400, "invalid_direction");
  }
  if (!body.departure_datetime) return jsonErr(400, "departure_required");
  if (body.space_comfort && !["tight","comfortable","spacious"].includes(body.space_comfort)) {
    return jsonErr(400, "invalid_space_comfort");
  }

  const svc = createServiceClient();

  // Default seats_total from driver's vehicle_capacity if available.
  let seatsTotal: number | null = body.seats_total ?? null;
  if (seatsTotal == null && body.driver_respondent_id) {
    const { data: arr } = await svc
      .from("travel_arrangements")
      .select("vehicle_capacity")
      .eq("respondent_id", body.driver_respondent_id)
      .maybeSingle();
    if (typeof arr?.vehicle_capacity === "number") {
      seatsTotal = arr.vehicle_capacity;
    }
  }

  const { data, error } = await svc
    .from("travel_groupings")
    .insert({
      trip_id,
      direction: body.direction,
      departure_datetime: body.departure_datetime,
      driver_respondent_id: body.driver_respondent_id ?? null,
      notes: body.notes?.trim().slice(0, 500) ?? null,
      seats_total: seatsTotal,
      space_comfort: body.space_comfort ?? null,
      ride_notes: body.ride_notes?.trim().slice(0, 500) ?? null,
    })
    .select("*")
    .single();
  if (error) return jsonErr(500, "grouping_insert_failed", error.message);
  return jsonOk(data);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: trip_id } = await ctx.params;
  const r = await resolveTripParticipant(trip_id);
  if (!r.ok) return jsonErr(r.status, r.status === 401 ? "unauthenticated" : "forbidden");

  const body = (await req.json().catch(() => null)) as { grouping_id?: string } | null;
  if (!body?.grouping_id) return jsonErr(400, "grouping_id_required");

  const svc = createServiceClient();
  const { error } = await svc
    .from("travel_groupings")
    .delete()
    .eq("id", body.grouping_id)
    .eq("trip_id", trip_id);
  if (error) return jsonErr(500, "delete_failed", error.message);
  return jsonOk({ deleted: true });
}
