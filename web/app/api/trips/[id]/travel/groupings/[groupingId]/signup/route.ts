/**
 * POST /api/trips/[id]/travel/groupings/[groupingId]/signup
 *
 * Member self-adds to a ride share. Q30 RESOLVED: going OR maybe
 * respondents can claim a seat. The grouping must have an open seat
 * (current member count < seats_total, when seats_total is set).
 *
 * Body: { respondent_id?, session_token? }
 *   - respondent_id is preferred when the caller is authed and has
 *     a respondents row on the trip.
 *   - session_token allows anon respondents (RSVPed via share link
 *     but never signed up for Rally) to claim a seat too — same
 *     auth model as Phase B votes.
 *
 * Always sets pre_assigned=false (distinguishes self-signups from
 * driver-vouched pre-assignments).
 *
 * DELETE supported as self-leave — covered by the sibling /members
 * route's DELETE which allows self-remove regardless of perms.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; groupingId: string }> },
) {
  const { id: trip_id, groupingId } = await ctx.params;

  const body = (await req.json().catch(() => null)) as
    | { respondent_id?: string; session_token?: string }
    | null;

  const svc = createServiceClient();

  // Validate grouping + trip.
  const { data: grouping } = await svc
    .from("travel_groupings")
    .select("id, trip_id, seats_total")
    .eq("id", groupingId)
    .maybeSingle();
  if (!grouping || grouping.trip_id !== trip_id) {
    return jsonErr(404, "grouping_not_found");
  }

  // Resolve the calling respondent — auth path OR session_token path.
  let callerRespondentId: string | null = null;

  if (body?.session_token) {
    const { data: resp } = await svc
      .from("respondents")
      .select("id, rsvp_status, trip_id")
      .eq("trip_id", trip_id)
      .eq("session_token", body.session_token)
      .maybeSingle();
    if (resp) callerRespondentId = resp.id as string;
  }

  if (!callerRespondentId) {
    const r = await requireAuthUid();
    if (r.ok) {
      const { data: userRow } = await svc
        .from("users").select("id").eq("auth_user_id", r.authUid).maybeSingle();
      const userId = userRow?.id as string | undefined;
      if (userId) {
        const { data: caller } = await svc
          .from("respondents").select("id")
          .eq("trip_id", trip_id).eq("user_id", userId).maybeSingle();
        callerRespondentId = caller?.id ?? null;
      }
    }
  }

  if (!callerRespondentId) {
    return jsonErr(401, "not_on_this_trip");
  }

  // The body.respondent_id field — if present and different from
  // the auth-resolved caller — is ignored. This route is strictly
  // for self-signup; planners use the /members route for adding
  // others.
  void body?.respondent_id;

  // Confirm caller is going or maybe (Q30).
  const { data: callerResp } = await svc
    .from("respondents").select("rsvp_status")
    .eq("id", callerRespondentId).maybeSingle();
  const status = callerResp?.rsvp_status as string | null;
  if (status !== "going" && status !== "maybe") {
    return jsonErr(403, "rsvp_required", "RSVP yes or maybe before joining a ride");
  }

  // Seat-availability check.
  const { count: currentCount } = await svc
    .from("travel_grouping_members")
    .select("respondent_id", { count: "exact", head: true })
    .eq("grouping_id", groupingId);
  const seatsTotal = grouping.seats_total as number | null;
  if (seatsTotal != null && (currentCount ?? 0) >= seatsTotal) {
    return jsonErr(409, "ride_full");
  }

  // Self-signup: pre_assigned=false, added_by=self.
  const { error } = await svc
    .from("travel_grouping_members")
    .upsert(
      {
        grouping_id: groupingId,
        respondent_id: callerRespondentId,
        pre_assigned: false,
        added_by_respondent_id: callerRespondentId,
      },
      { onConflict: "grouping_id,respondent_id" },
    );
  if (error) return jsonErr(500, "signup_failed", error.message);
  return jsonOk({ joined: true });
}
