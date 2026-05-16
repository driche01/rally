/**
 * POST /api/trips/[id]/itinerary/[itemId]/vote
 *
 * Yes/no/maybe vote on a single itinerary item. Anon-friendly:
 *   - With { session_token }: looks up the respondent on this trip
 *     by session_token, upserts the vote. Works for invitees who
 *     haven't created a Rally account.
 *   - Without session_token: requires auth. Resolves respondents.id
 *     via auth.uid() → users.id → respondents.user_id on this trip.
 *
 * Body: { vote: 'yes'|'no'|'maybe', session_token?: string }
 *
 * Per BUILD_QUESTIONS Q13: per-member FKs use respondents(id).
 */

import { requireAuthUid } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

const VALID_VOTES = new Set(["yes", "no", "maybe"]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id: trip_id, itemId: itinerary_block_id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as
    | { vote?: string; session_token?: string }
    | null;
  if (!body) return jsonErr(400, "invalid_json");

  const vote = body.vote ?? "";
  if (!VALID_VOTES.has(vote)) return jsonErr(400, "invalid_vote");

  // Resolve respondent_id by either path.
  let respondent_id: string | null = null;
  const svc = createServiceClient();

  if (typeof body.session_token === "string" && body.session_token.trim()) {
    const { data, error } = await svc
      .from("respondents")
      .select("id")
      .eq("trip_id", trip_id)
      .eq("session_token", body.session_token.trim())
      .maybeSingle();
    if (error)  return jsonErr(500, "respondent_lookup_failed", error.message);
    if (!data)  return jsonErr(404, "respondent_not_found");
    respondent_id = data.id;
  } else {
    const r = await requireAuthUid();
    if (!r.ok) return jsonErr(r.status, "unauthenticated_no_token");
    // auth.uid() = profiles.id; we need respondents.user_id which lives on
    // the Rally users table. Lookup users.id by auth_user_id, then
    // respondents.id by trip+user_id.
    const { data: u } = await svc
      .from("users")
      .select("id")
      .eq("auth_user_id", r.authUid)
      .maybeSingle();
    if (!u?.id) return jsonErr(404, "rally_user_not_found");
    const { data: respondent } = await svc
      .from("respondents")
      .select("id")
      .eq("trip_id", trip_id)
      .eq("user_id", u.id)
      .maybeSingle();
    if (!respondent?.id) return jsonErr(404, "respondent_not_found_for_authed_user");
    respondent_id = respondent.id;
  }

  // Verify the itinerary block exists on this trip.
  const { data: block, error: blockErr } = await svc
    .from("itinerary_blocks")
    .select("id, trip_id")
    .eq("id", itinerary_block_id)
    .maybeSingle();
  if (blockErr)               return jsonErr(500, "block_lookup_failed", blockErr.message);
  if (!block || block.trip_id !== trip_id) return jsonErr(404, "block_not_found");

  // Upsert the vote (PK = itinerary_block_id + respondent_id).
  const { error: upErr } = await svc
    .from("itinerary_item_votes")
    .upsert({
      itinerary_block_id,
      respondent_id,
      vote,
      voted_at: new Date().toISOString(),
    }, { onConflict: "itinerary_block_id,respondent_id" });
  if (upErr) return jsonErr(500, "vote_upsert_failed", upErr.message);

  return jsonOk({ respondent_id, vote });
}
