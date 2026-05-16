/**
 * PATCH /api/trips/[id]/travel/groupings/[groupingId]
 *
 * Driver-of-the-ride OR planner/cohost edits ride metadata:
 *   seats_total, space_comfort, ride_notes, departure_datetime, notes
 *
 * Per Q32 (RESOLVED 2026-05-14): driver of a grouping gains edit
 * rights on their own ride alongside the planner.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

const ALLOWED_FIELDS = new Set([
  "seats_total",
  "space_comfort",
  "ride_notes",
  "departure_datetime",
  "notes",
  "driver_respondent_id",
]);

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; groupingId: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id, groupingId } = await ctx.params;

  const body = (await req.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body) return jsonErr(400, "invalid_json");

  const svc = createServiceClient();

  // Authorize: planner / cohost OR driver of this grouping.
  const { data: trip } = await svc.from("trips")
    .select("id, created_by").eq("id", trip_id).maybeSingle();
  if (!trip) return jsonErr(404, "trip_not_found");

  const { data: grouping } = await svc.from("travel_groupings")
    .select("id, trip_id, driver_respondent_id")
    .eq("id", groupingId).maybeSingle();
  if (!grouping || grouping.trip_id !== trip_id) {
    return jsonErr(404, "grouping_not_found");
  }

  let allowed = trip.created_by === r.authUid;
  if (!allowed) {
    const { data: cohost } = await svc.from("trip_cohosts")
      .select("trip_id").eq("trip_id", trip_id).eq("user_id", r.authUid).maybeSingle();
    if (cohost) allowed = true;
  }
  if (!allowed && grouping.driver_respondent_id) {
    const { data: userRow } = await svc.from("users")
      .select("id").eq("auth_user_id", r.authUid).maybeSingle();
    const userId = userRow?.id as string | undefined;
    if (userId) {
      const { data: caller } = await svc.from("respondents")
        .select("id").eq("trip_id", trip_id).eq("user_id", userId).maybeSingle();
      if (caller?.id === grouping.driver_respondent_id) allowed = true;
    }
  }
  if (!allowed) return jsonErr(403, "forbidden");

  // Filter body to allowed fields + sanity-check each.
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED_FIELDS.has(k)) continue;

    if (k === "space_comfort") {
      if (v !== null && !["tight","comfortable","spacious"].includes(v as string)) {
        return jsonErr(400, "invalid_space_comfort");
      }
      patch[k] = v;
    } else if (k === "seats_total") {
      if (v == null) { patch[k] = null; continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 99) return jsonErr(400, "invalid_seats_total");
      patch[k] = Math.floor(n);
    } else if (k === "ride_notes" || k === "notes") {
      if (v == null) { patch[k] = null; continue; }
      const s = String(v).trim().slice(0, 500);
      patch[k] = s.length === 0 ? null : s;
    } else if (k === "departure_datetime") {
      if (!v) return jsonErr(400, "departure_required");
      patch[k] = v;
    } else if (k === "driver_respondent_id") {
      patch[k] = v ?? null;
    }
  }

  if (Object.keys(patch).length === 0) return jsonErr(400, "no_fields_to_update");

  const { data, error } = await svc
    .from("travel_groupings")
    .update(patch)
    .eq("id", groupingId)
    .select("*")
    .single();
  if (error) return jsonErr(500, "update_failed", error.message);
  return jsonOk(data);
}
