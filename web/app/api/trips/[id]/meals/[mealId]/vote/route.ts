/**
 * POST /api/trips/[id]/meals/[mealId]/vote
 *
 * Yes/no/maybe vote on a meal. Anon-friendly via session_token,
 * authed via cookie. Same pattern as itinerary + lodging votes.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

const VALID = new Set(["yes", "no", "maybe"]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; mealId: string }> },
) {
  const { id: trip_id, mealId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as
    | { vote?: string; session_token?: string }
    | null;
  if (!body) return jsonErr(400, "invalid_json");
  const vote = body.vote ?? "";
  if (!VALID.has(vote)) return jsonErr(400, "invalid_vote");

  const svc = createServiceClient();
  let respondent_id: string | null = null;

  if (typeof body.session_token === "string" && body.session_token.trim()) {
    const { data } = await svc
      .from("respondents").select("id")
      .eq("trip_id", trip_id).eq("session_token", body.session_token.trim())
      .maybeSingle();
    if (!data) return jsonErr(404, "respondent_not_found");
    respondent_id = data.id;
  } else {
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

  const { data: meal } = await svc
    .from("meals").select("id, trip_id")
    .eq("id", mealId).maybeSingle();
  if (!meal || meal.trip_id !== trip_id) return jsonErr(404, "meal_not_found");

  const { error } = await svc
    .from("meal_votes")
    .upsert(
      { meal_id: mealId, respondent_id, vote, voted_at: new Date().toISOString() },
      { onConflict: "meal_id,respondent_id" },
    );
  if (error) return jsonErr(500, "vote_upsert_failed", error.message);

  return jsonOk({ respondent_id, vote });
}
