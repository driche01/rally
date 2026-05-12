/**
 * POST /api/trips/[id]/lodging/[optionId]/select
 *
 * Planner/cohost picks one lodging option as the chosen one for the
 * trip. Sets its status='selected' and demotes any previously-
 * selected option on the same trip back to 'option'.
 *
 * Mutually exclusive selection per trip — exactly zero or one
 * 'selected' row at any time.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; optionId: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id, optionId: lodging_option_id } = await ctx.params;

  // Authorize.
  const { data: trip } = await r.supabase
    .from("trips").select("id, created_by").eq("id", trip_id).maybeSingle();
  if (!trip) return jsonErr(404, "trip_not_found");

  if (trip.created_by !== r.authUid) {
    const { data: cohost } = await r.supabase
      .from("trip_cohosts").select("trip_id")
      .eq("trip_id", trip_id).eq("user_id", r.authUid).maybeSingle();
    if (!cohost) return jsonErr(403, "forbidden");
  }

  const svc = createServiceClient();

  // Validate the option belongs to this trip.
  const { data: option } = await svc
    .from("lodging_options")
    .select("id, trip_id, status")
    .eq("id", lodging_option_id)
    .maybeSingle();
  if (!option || option.trip_id !== trip_id) return jsonErr(404, "option_not_found");

  // Demote any currently-selected option on this trip.
  await svc
    .from("lodging_options")
    .update({ status: "option", updated_at: new Date().toISOString() })
    .eq("trip_id", trip_id)
    .eq("status", "selected");

  // Promote the chosen one.
  const { data: updated, error: upErr } = await svc
    .from("lodging_options")
    .update({ status: "selected", updated_at: new Date().toISOString() })
    .eq("id", lodging_option_id)
    .select("*")
    .single();
  if (upErr) return jsonErr(500, "select_failed", upErr.message);

  // Activity feed.
  await svc.from("activity_feed_entries").insert({
    trip_id,
    user_id: null,
    entry_type: "system",
    content: {
      text: `Locked in lodging: ${updated.title}`,
      kind: "lodging_selected",
      lodging_option_id,
    },
  });

  return jsonOk(updated);
}
