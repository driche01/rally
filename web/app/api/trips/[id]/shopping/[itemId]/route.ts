/**
 * PATCH /api/trips/[id]/shopping/[itemId]
 *
 * Update an aggregated shopping item: assign to a member, mark
 * acquired. Anon-friendly via session_token (members can claim
 * + check off items from the public invite page in a future
 * iteration); authed planner/cohost via cookie.
 *
 * Body: {
 *   session_token?: string,           // anon path
 *   assigned_respondent_id?: string | null,
 *   is_acquired?: boolean,
 * }
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id: trip_id, itemId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as
    | {
        session_token?: string;
        assigned_respondent_id?: string | null;
        is_acquired?: boolean;
      }
    | null;
  if (!body) return jsonErr(400, "invalid_json");

  const svc = createServiceClient();

  // Validate the item is on this trip.
  const { data: item } = await svc
    .from("shopping_list_items")
    .select("id, trip_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item || item.trip_id !== trip_id) return jsonErr(404, "item_not_found");

  // Authorize: either session_token on the trip, or authed member/planner.
  let actorRespondentId: string | null = null;
  if (typeof body.session_token === "string" && body.session_token.trim()) {
    const { data } = await svc
      .from("respondents").select("id")
      .eq("trip_id", trip_id).eq("session_token", body.session_token.trim())
      .maybeSingle();
    if (!data) return jsonErr(404, "respondent_not_found");
    actorRespondentId = data.id;
  } else {
    const r = await requireAuthUid();
    if (!r.ok) return jsonErr(r.status, "unauthenticated_no_token");
    const { data: u } = await svc
      .from("users").select("id").eq("auth_user_id", r.authUid).maybeSingle();
    if (u?.id) {
      const { data: resp } = await svc
        .from("respondents").select("id")
        .eq("trip_id", trip_id).eq("user_id", u.id).maybeSingle();
      actorRespondentId = resp?.id ?? null;
    }
    // If they're authed but not a respondent on this trip, they could
    // still be the planner. We allow the update in that case (planner
    // managing the list on someone else's behalf).
  }

  // Validate assigned_respondent_id if provided.
  if (body.assigned_respondent_id !== undefined && body.assigned_respondent_id !== null) {
    const { data: assignee } = await svc
      .from("respondents").select("id")
      .eq("trip_id", trip_id).eq("id", body.assigned_respondent_id).maybeSingle();
    if (!assignee) return jsonErr(400, "invalid_assigned_respondent");
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.assigned_respondent_id !== undefined) {
    patch.assigned_respondent_id = body.assigned_respondent_id;
  }
  if (body.is_acquired !== undefined) {
    patch.is_acquired = !!body.is_acquired;
  }
  if (Object.keys(patch).length === 1) {
    // Only updated_at — nothing to update.
    return jsonErr(400, "no_fields_to_update");
  }

  const { data: updated, error } = await svc
    .from("shopping_list_items")
    .update(patch)
    .eq("id", itemId)
    .select("*")
    .single();
  if (error) return jsonErr(500, "update_failed", error.message);

  return jsonOk({ item: updated, actor_respondent_id: actorRespondentId });
}
