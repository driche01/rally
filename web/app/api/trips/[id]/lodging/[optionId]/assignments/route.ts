/**
 * POST   /api/trips/[id]/lodging/[optionId]/assignments
 *   Body: { respondent_id, room_label, nights?, cost_owed_cents? }
 *   Adds (or updates) a room assignment for one member. Planner/cohost
 *   only — room assignments are a planning action, not a self-service
 *   thing for invitees.
 *
 * DELETE /api/trips/[id]/lodging/[optionId]/assignments
 *   Body: { respondent_id, room_label }
 *   Removes an assignment.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; optionId: string }> },
) {
  return upsert(req, ctx);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; optionId: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id, optionId: lodging_option_id } = await ctx.params;
  if (!(await authorizePlanner(r, trip_id))) return jsonErr(403, "forbidden");

  const body = (await req.json().catch(() => null)) as
    | { respondent_id?: string; room_label?: string }
    | null;
  if (!body?.respondent_id || !body?.room_label) {
    return jsonErr(400, "respondent_id_and_room_label_required");
  }

  const svc = createServiceClient();
  const { error } = await svc
    .from("lodging_room_assignments")
    .delete()
    .eq("lodging_option_id", lodging_option_id)
    .eq("respondent_id", body.respondent_id)
    .eq("room_label", body.room_label);
  if (error) return jsonErr(500, "delete_failed", error.message);

  return jsonOk({ deleted: true });
}

async function upsert(
  req: Request,
  ctx: { params: Promise<{ id: string; optionId: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id, optionId: lodging_option_id } = await ctx.params;
  if (!(await authorizePlanner(r, trip_id))) return jsonErr(403, "forbidden");

  const body = (await req.json().catch(() => null)) as
    | {
        respondent_id?: string;
        room_label?: string;
        nights?: number;
        cost_owed_cents?: number;
        payment_status?: "unpaid" | "pending" | "paid";
      }
    | null;
  if (!body?.respondent_id || !body?.room_label) {
    return jsonErr(400, "respondent_id_and_room_label_required");
  }
  if (body.payment_status && !["unpaid","pending","paid"].includes(body.payment_status)) {
    return jsonErr(400, "invalid_payment_status");
  }

  const svc = createServiceClient();
  const row = {
    lodging_option_id,
    respondent_id: body.respondent_id,
    room_label: body.room_label,
    nights: typeof body.nights === "number" ? Math.max(0, body.nights) : 0,
    cost_owed_cents: typeof body.cost_owed_cents === "number" ? Math.max(0, body.cost_owed_cents) : 0,
    payment_status: body.payment_status ?? "unpaid",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await svc
    .from("lodging_room_assignments")
    .upsert(row, { onConflict: "lodging_option_id,respondent_id,room_label" })
    .select("*")
    .single();
  if (error) return jsonErr(500, "assignment_upsert_failed", error.message);

  return jsonOk(data);
}

async function authorizePlanner(
  r: { authUid: string; supabase: { from: (t: string) => any } },
  trip_id: string,
): Promise<boolean> {
  const { data: trip } = await r.supabase
    .from("trips").select("id, created_by").eq("id", trip_id).maybeSingle();
  if (!trip) return false;
  if (trip.created_by === r.authUid) return true;
  const { data: cohost } = await r.supabase
    .from("trip_cohosts").select("trip_id")
    .eq("trip_id", trip_id).eq("user_id", r.authUid).maybeSingle();
  return !!cohost;
}
