/**
 * POST   /api/trips/[id]/travel/groupings/[groupingId]/members
 *   Body: { respondent_id, pre_assigned? }
 *   Any trip participant adds a member to this grouping.
 *   `pre_assigned` defaults to true — i.e., someone is vouching for
 *   the rider. Self-signup uses the sibling /signup route which sets
 *   pre_assigned=false.
 *
 * DELETE /api/trips/[id]/travel/groupings/[groupingId]/members
 *   Body: { respondent_id }
 *   Any trip participant can remove anyone from a grouping.
 *
 * Auth (alpha, 2026-05-19): any trip participant — planner, cohost,
 * or respondent — can add/remove anyone. Q32's driver-only carve-out
 * is subsumed by the broader participant-edit rule.
 */

import { resolveTripParticipant } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; groupingId: string }> },
) {
  const { id: trip_id, groupingId } = await ctx.params;
  const r = await resolveTripParticipant(trip_id);
  if (!r.ok) return jsonErr(r.status, r.status === 401 ? "unauthenticated" : "forbidden");

  const body = (await req.json().catch(() => null)) as
    | { respondent_id?: string; pre_assigned?: boolean }
    | null;
  if (!body?.respondent_id) return jsonErr(400, "respondent_id_required");

  const svc = createServiceClient();

  // Validate grouping is on this trip.
  const { data: grouping } = await svc.from("travel_groupings")
    .select("id, trip_id, seats_total").eq("id", groupingId).maybeSingle();
  if (!grouping || grouping.trip_id !== trip_id) {
    return jsonErr(404, "grouping_not_found");
  }

  // Capacity check (only enforced on add).
  if (grouping.seats_total != null) {
    const { count } = await svc.from("travel_grouping_members")
      .select("respondent_id", { count: "exact", head: true })
      .eq("grouping_id", groupingId);
    if ((count ?? 0) >= grouping.seats_total) {
      return jsonErr(409, "ride_full");
    }
  }

  const { error } = await svc
    .from("travel_grouping_members")
    .upsert(
      {
        grouping_id: groupingId,
        respondent_id: body.respondent_id,
        pre_assigned: body.pre_assigned ?? true,
        added_by_respondent_id: r.participant.respondentId,
      },
      { onConflict: "grouping_id,respondent_id" },
    );
  if (error) return jsonErr(500, "add_failed", error.message);
  return jsonOk({ added: true });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; groupingId: string }> },
) {
  const { id: trip_id, groupingId } = await ctx.params;
  const r = await resolveTripParticipant(trip_id);
  if (!r.ok) return jsonErr(r.status, r.status === 401 ? "unauthenticated" : "forbidden");

  const body = (await req.json().catch(() => null)) as
    | { respondent_id?: string }
    | null;
  if (!body?.respondent_id) return jsonErr(400, "respondent_id_required");

  const svc = createServiceClient();

  // Validate grouping is on this trip.
  const { data: grouping } = await svc.from("travel_groupings")
    .select("id, trip_id").eq("id", groupingId).maybeSingle();
  if (!grouping || grouping.trip_id !== trip_id) {
    return jsonErr(404, "grouping_not_found");
  }

  const { error } = await svc
    .from("travel_grouping_members")
    .delete()
    .eq("grouping_id", groupingId)
    .eq("respondent_id", body.respondent_id);
  if (error) return jsonErr(500, "remove_failed", error.message);
  return jsonOk({ removed: true });
}
