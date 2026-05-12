/**
 * POST /api/trips/[id]/lodging/[optionId]/vote
 *
 * Yes/no/maybe vote on a lodging option. Same anon/authed pattern
 * as the itinerary vote endpoint:
 *   - With { session_token }: anon respondent identified by session
 *   - Without: requires auth, resolves respondent via users.id
 *
 * Upserts lodging_votes (PK = lodging_option_id, respondent_id —
 * via the unique index added in migration 127).
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

const VALID = new Set(["yes", "no", "maybe"]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; optionId: string }> },
) {
  const { id: trip_id, optionId: lodging_option_id } = await ctx.params;
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

  const { data: option } = await svc
    .from("lodging_options").select("id, trip_id")
    .eq("id", lodging_option_id).maybeSingle();
  if (!option || option.trip_id !== trip_id) return jsonErr(404, "option_not_found");

  // The legacy lodging_votes table doesn't have an id PK with the
  // (option,respondent) combo as a constraint — migration 127 added a
  // unique index. We delete-then-insert to handle the upsert cleanly
  // without depending on a named constraint for ON CONFLICT.
  await svc.from("lodging_votes")
    .delete()
    .eq("lodging_option_id", lodging_option_id)
    .eq("respondent_id", respondent_id);

  const { error: insErr } = await svc.from("lodging_votes").insert({
    trip_id,
    lodging_option_id,
    respondent_id,
    vote,
  });
  if (insErr) return jsonErr(500, "vote_insert_failed", insErr.message);

  return jsonOk({ respondent_id, vote });
}
