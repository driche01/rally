/**
 * POST   /api/trips/[id]/travel/groupings/[groupingId]/members
 *   Body: { respondent_id }
 *   Planner/cohost adds a member to a grouping.
 *
 * DELETE /api/trips/[id]/travel/groupings/[groupingId]/members
 *   Body: { respondent_id }
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; groupingId: string }> },
) {
  return mutate(req, ctx, "add");
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; groupingId: string }> },
) {
  return mutate(req, ctx, "remove");
}

async function mutate(
  req: Request,
  ctx: { params: Promise<{ id: string; groupingId: string }> },
  op: "add" | "remove",
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id, groupingId } = await ctx.params;

  // Authorize: planner or cohost.
  const { data: trip } = await r.supabase
    .from("trips").select("id, created_by").eq("id", trip_id).maybeSingle();
  if (!trip) return jsonErr(404, "trip_not_found");
  if (trip.created_by !== r.authUid) {
    const { data: cohost } = await r.supabase
      .from("trip_cohosts").select("trip_id")
      .eq("trip_id", trip_id).eq("user_id", r.authUid).maybeSingle();
    if (!cohost) return jsonErr(403, "forbidden");
  }

  const body = (await req.json().catch(() => null)) as
    | { respondent_id?: string }
    | null;
  if (!body?.respondent_id) return jsonErr(400, "respondent_id_required");

  const svc = createServiceClient();

  // Validate the grouping is on this trip.
  const { data: grouping } = await svc
    .from("travel_groupings").select("id, trip_id")
    .eq("id", groupingId).maybeSingle();
  if (!grouping || grouping.trip_id !== trip_id) {
    return jsonErr(404, "grouping_not_found");
  }

  if (op === "add") {
    const { error } = await svc
      .from("travel_grouping_members")
      .upsert(
        { grouping_id: groupingId, respondent_id: body.respondent_id },
        { onConflict: "grouping_id,respondent_id" },
      );
    if (error) return jsonErr(500, "add_failed", error.message);
    return jsonOk({ added: true });
  } else {
    const { error } = await svc
      .from("travel_grouping_members")
      .delete()
      .eq("grouping_id", groupingId)
      .eq("respondent_id", body.respondent_id);
    if (error) return jsonErr(500, "remove_failed", error.message);
    return jsonOk({ removed: true });
  }
}
