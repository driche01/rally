/**
 * POST /api/trips/[id]/meals/[mealId]/cooks
 *
 * Planner/cohost sets the cook assignment for a meal. Body:
 *   { cook_respondent_ids: string[] }
 * Replaces the existing array wholesale.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; mealId: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id, mealId } = await ctx.params;

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
    | { cook_respondent_ids?: string[] }
    | null;
  if (!body || !Array.isArray(body.cook_respondent_ids)) {
    return jsonErr(400, "cook_respondent_ids_required");
  }
  const ids = body.cook_respondent_ids.filter((v) => typeof v === "string" && v.trim());

  const svc = createServiceClient();

  // Validate every id belongs to a respondent on this trip.
  if (ids.length > 0) {
    const { data: resps } = await svc
      .from("respondents").select("id")
      .eq("trip_id", trip_id)
      .in("id", ids);
    const valid = new Set((resps ?? []).map((r) => r.id as string));
    if (valid.size !== ids.length) return jsonErr(400, "invalid_respondent_ids");
  }

  const { data: updated, error } = await svc
    .from("meals")
    .update({
      assigned_cook_respondent_ids: ids,
      updated_at: new Date().toISOString(),
    })
    .eq("id", mealId)
    .eq("trip_id", trip_id)
    .select("*")
    .single();
  if (error) return jsonErr(500, "cooks_update_failed", error.message);

  return jsonOk(updated);
}
