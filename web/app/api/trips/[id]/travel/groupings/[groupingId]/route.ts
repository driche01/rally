/**
 * PATCH /api/trips/[id]/travel/groupings/[groupingId]
 *
 * Edit ride metadata:
 *   seats_total, space_comfort, ride_notes, departure_datetime, notes,
 *   driver_respondent_id
 *
 * Auth (alpha, 2026-05-19): any trip participant can edit any ride —
 * superseded the prior planner-or-driver gate when the equal-edit
 * policy landed. Q32's driver-edit carve-out is now subsumed by the
 * broader participant-edit rule.
 */

import { resolveTripParticipant } from "@/lib/auth";
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
  const { id: trip_id, groupingId } = await ctx.params;
  const r = await resolveTripParticipant(trip_id);
  if (!r.ok) return jsonErr(r.status, r.status === 401 ? "unauthenticated" : "forbidden");

  const body = (await req.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body) return jsonErr(400, "invalid_json");

  const svc = createServiceClient();

  // Verify the grouping exists + belongs to this trip.
  const { data: grouping } = await svc.from("travel_groupings")
    .select("id, trip_id, driver_respondent_id")
    .eq("id", groupingId).maybeSingle();
  if (!grouping || grouping.trip_id !== trip_id) {
    return jsonErr(404, "grouping_not_found");
  }

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
