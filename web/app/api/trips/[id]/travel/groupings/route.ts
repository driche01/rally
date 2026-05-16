/**
 * POST /api/trips/[id]/travel/groupings
 *   Planner/cohost OR a respondent creating their own driver ride
 *   creates a car/shuttle grouping.
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
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id } = await ctx.params;

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

  // Permission: planner / cohost, OR the respondent_id being named as
  // driver matches the caller (a driver creating their own ride).
  const isManager = await canManage(r, trip_id);
  let isDriverCreatingOwn = false;
  if (!isManager && body.driver_respondent_id) {
    const { data: userRow } = await svc.from("users")
      .select("id").eq("auth_user_id", r.authUid).maybeSingle();
    const userId = userRow?.id as string | undefined;
    if (userId) {
      const { data: caller } = await svc.from("respondents")
        .select("id").eq("trip_id", trip_id).eq("user_id", userId).maybeSingle();
      isDriverCreatingOwn = caller?.id === body.driver_respondent_id;
    }
  }
  if (!isManager && !isDriverCreatingOwn) return jsonErr(403, "forbidden");

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
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id } = await ctx.params;
  if (!(await canManage(r, trip_id))) return jsonErr(403, "forbidden");

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

async function canManage(
  r: { authUid: string; supabase: { from: (t: string) => any } },
  trip_id: string,
): Promise<boolean> {
  const { data: trip } = await r.supabase
    .from("trips").select("id, created_by").eq("id", trip_id).maybeSingle();
  if (!trip) return false;
  if (trip.created_by === r.authUid) return true;
  const { data: cohost } = await r.supabase
    .from("trip_cohosts").select("trip_id")
    .eq("trip_id", trip_id).eq("user_id", r.authUid).maybeSingle();
  return !!cohost;
}
