/**
 * POST   /api/trips/[id]/travel/groupings/[groupingId]/members
 *   Body: { respondent_id, pre_assigned? }
 *   Planner/cohost OR the driver of this grouping (Q32) adds a member.
 *   `pre_assigned` defaults to true when added by driver/planner —
 *   i.e., the driver is vouching for the rider. Self-signup uses
 *   the sibling /signup route which sets pre_assigned=false.
 *
 * DELETE /api/trips/[id]/travel/groupings/[groupingId]/members
 *   Body: { respondent_id }
 *   Planner/cohost OR driver can remove anyone; respondents can remove
 *   themselves regardless.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; groupingId: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id, groupingId } = await ctx.params;

  const body = (await req.json().catch(() => null)) as
    | { respondent_id?: string; pre_assigned?: boolean }
    | null;
  if (!body?.respondent_id) return jsonErr(400, "respondent_id_required");

  const svc = createServiceClient();

  // Validate trip + grouping + permission. Permission = planner OR
  // cohost OR driver of THIS grouping.
  const auth = await authorizeManageGrouping(svc, r.authUid, trip_id, groupingId);
  if (!auth.ok) return jsonErr(auth.status, auth.code);

  // Capacity check (only enforced on add).
  const seatCheck = await seatsAvailable(svc, groupingId);
  if (!seatCheck.ok) return jsonErr(seatCheck.status, seatCheck.code);
  if (seatCheck.seats_total != null && seatCheck.current >= seatCheck.seats_total) {
    // Allow over-capacity if the caller is the driver/planner and
    // they want to override — but for now hard-cap. Easier to relax
    // later than tighten.
    return jsonErr(409, "ride_full");
  }

  const { error } = await svc
    .from("travel_grouping_members")
    .upsert(
      {
        grouping_id: groupingId,
        respondent_id: body.respondent_id,
        pre_assigned: body.pre_assigned ?? true,
        added_by_respondent_id: auth.callerRespondentId,
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
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id, groupingId } = await ctx.params;

  const body = (await req.json().catch(() => null)) as
    | { respondent_id?: string }
    | null;
  if (!body?.respondent_id) return jsonErr(400, "respondent_id_required");

  const svc = createServiceClient();

  const auth = await authorizeManageGrouping(svc, r.authUid, trip_id, groupingId);

  // Self-remove allowed even without manage perms.
  if (!auth.ok && auth.callerRespondentId !== body.respondent_id) {
    return jsonErr(auth.status, auth.code);
  }

  const { error } = await svc
    .from("travel_grouping_members")
    .delete()
    .eq("grouping_id", groupingId)
    .eq("respondent_id", body.respondent_id);
  if (error) return jsonErr(500, "remove_failed", error.message);
  return jsonOk({ removed: true });
}

// ─── shared helpers ─────────────────────────────────────────────

interface AuthOk  { ok: true;  callerRespondentId: string | null }
interface AuthFail { ok: false; status: number; code: string; callerRespondentId: string | null }

async function authorizeManageGrouping(
  svc: ReturnType<typeof createServiceClient>,
  authUid: string,
  tripId: string,
  groupingId: string,
): Promise<AuthOk | AuthFail> {
  const { data: trip } = await svc.from("trips")
    .select("id, created_by").eq("id", tripId).maybeSingle();
  if (!trip) return { ok: false, status: 404, code: "trip_not_found", callerRespondentId: null };

  // Resolve caller's respondent row on this trip (for driver check
  // + audit trail).
  const { data: userRow } = await svc.from("users")
    .select("id").eq("auth_user_id", authUid).maybeSingle();
  const callerUserId = userRow?.id as string | undefined;
  let callerRespondentId: string | null = null;
  if (callerUserId) {
    const { data: caller } = await svc.from("respondents")
      .select("id").eq("trip_id", tripId).eq("user_id", callerUserId).maybeSingle();
    callerRespondentId = caller?.id ?? null;
  }

  // Validate grouping is on this trip + grab driver_respondent_id.
  const { data: grouping } = await svc.from("travel_groupings")
    .select("id, trip_id, driver_respondent_id").eq("id", groupingId).maybeSingle();
  if (!grouping || grouping.trip_id !== tripId) {
    return { ok: false, status: 404, code: "grouping_not_found", callerRespondentId };
  }

  // Planner?
  if (trip.created_by === authUid) return { ok: true, callerRespondentId };
  // Cohost?
  const { data: cohost } = await svc.from("trip_cohosts")
    .select("trip_id").eq("trip_id", tripId).eq("user_id", authUid).maybeSingle();
  if (cohost) return { ok: true, callerRespondentId };
  // Driver of this grouping?
  if (grouping.driver_respondent_id && grouping.driver_respondent_id === callerRespondentId) {
    return { ok: true, callerRespondentId };
  }

  return { ok: false, status: 403, code: "forbidden", callerRespondentId };
}

interface SeatsOk { ok: true; seats_total: number | null; current: number }
interface SeatsFail { ok: false; status: number; code: string }

async function seatsAvailable(
  svc: ReturnType<typeof createServiceClient>,
  groupingId: string,
): Promise<SeatsOk | SeatsFail> {
  const { data: grouping } = await svc.from("travel_groupings")
    .select("seats_total, driver_respondent_id").eq("id", groupingId).maybeSingle();
  if (!grouping) return { ok: false, status: 404, code: "grouping_not_found" };

  const { count } = await svc.from("travel_grouping_members")
    .select("respondent_id", { count: "exact", head: true })
    .eq("grouping_id", groupingId);

  return {
    ok: true,
    seats_total: grouping.seats_total as number | null,
    current: count ?? 0,
  };
}
