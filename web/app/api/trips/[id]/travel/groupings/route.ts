/**
 * POST /api/trips/[id]/travel/groupings
 *   Planner/cohost creates a car/shuttle grouping.
 *   Body: { direction: 'outbound'|'return', departure_datetime: ISO,
 *           driver_respondent_id?: string, notes?: string }
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
  if (!(await canManage(r, trip_id))) return jsonErr(403, "forbidden");

  const body = (await req.json().catch(() => null)) as
    | {
        direction?: string;
        departure_datetime?: string;
        driver_respondent_id?: string;
        notes?: string;
      }
    | null;
  if (!body) return jsonErr(400, "invalid_json");
  if (body.direction !== "outbound" && body.direction !== "return") {
    return jsonErr(400, "invalid_direction");
  }
  if (!body.departure_datetime) return jsonErr(400, "departure_required");

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("travel_groupings")
    .insert({
      trip_id,
      direction: body.direction,
      departure_datetime: body.departure_datetime,
      driver_respondent_id: body.driver_respondent_id ?? null,
      notes: body.notes?.trim().slice(0, 500) ?? null,
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
