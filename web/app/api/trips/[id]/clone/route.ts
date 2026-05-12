/**
 * POST /api/trips/[id]/clone
 *
 * Authed planner/cohost duplicates a trip's metadata + cohosts.
 * Does NOT copy memberships, itinerary, lodging, travel, meals,
 * or shopping — the clone is a clean planning slate. The new
 * trip's name gets " (copy)" appended; theme, description, dates,
 * budget, destination, cover image, group_size_bucket are all
 * carried over.
 *
 * Per BUILD_QUESTIONS Q? (build guide §5 Step 9 — cheap-or-cut):
 * we keep this strictly cheap. If anyone asks for "duplicate the
 * itinerary too" later, that's a separate feature.
 *
 * Returns { trip: <new trip row> } so the client can redirect.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";
import { randomBytes } from "node:crypto";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: source_id } = await ctx.params;

  // Authorize. Only the planner OR a cohost can clone.
  const { data: source } = await r.supabase
    .from("trips")
    .select("*")
    .eq("id", source_id)
    .maybeSingle();
  if (!source) return jsonErr(404, "trip_not_found");
  if (source.created_by !== r.authUid) {
    const { data: cohost } = await r.supabase
      .from("trip_cohosts").select("trip_id")
      .eq("trip_id", source_id).eq("user_id", r.authUid).maybeSingle();
    if (!cohost) return jsonErr(403, "forbidden");
  }

  const svc = createServiceClient();

  // 1. Build the new row.
  const newShareToken = randomBytes(12).toString("hex");
  const insertRow: Record<string, unknown> = {
    created_by: r.authUid,         // cohost-cloned trips become the cohost's trip
    name: appendCopySuffix(source.name as string),
    group_size_bucket: source.group_size_bucket,
    group_size_precise: source.group_size_precise,
    destination: source.destination,
    destination_address: source.destination_address,
    description: source.description,
    cover_image_url: source.cover_image_url,
    theme: source.theme,
    budget_min: source.budget_min,
    budget_max: source.budget_max,
    budget_per_person: source.budget_per_person,
    trip_type: source.trip_type,
    is_public: false,              // cloned trips start private
    status: "draft",               // cloned trips start as draft
    share_token: newShareToken,
    // Explicit nulls for time-sensitive fields — fresh trip.
    start_date: null,
    end_date: null,
    book_by_date: null,
    responses_due_date: null,
    finalize_prompt_sent_at: null,
    stuck_alert_sent_at: null,
    estimated_flight_cost_per_person: null,
    cached_lodging_suggestions: null,
    cached_lodging_suggestions_signature: null,
    cached_lodging_suggestions_updated_at: null,
    cached_travel_suggestions: null,
    cached_travel_suggestions_signature: null,
    cached_travel_suggestions_updated_at: null,
    form_draft: null,
  };

  const { data: newTrip, error: insErr } = await svc
    .from("trips")
    .insert(insertRow)
    .select("*")
    .single();
  if (insErr) return jsonErr(500, "clone_failed", insErr.message);

  // 2. Carry forward cohosts (cohost user_id, original planner stays
  //    the new trip's planner only if THEY are the caller; otherwise
  //    the cohost who cloned it owns the new trip + the original
  //    planner becomes a cohost on the clone).
  const { data: sourceCohosts } = await svc
    .from("trip_cohosts").select("user_id")
    .eq("trip_id", source_id);
  const cohostRows: { trip_id: string; user_id: string; invited_by: string }[] = [];
  const newPlannerId = r.authUid;
  const cohostIds = new Set<string>();
  for (const c of (sourceCohosts ?? []) as { user_id: string }[]) {
    if (c.user_id && c.user_id !== newPlannerId) cohostIds.add(c.user_id);
  }
  if (source.created_by && source.created_by !== newPlannerId) {
    cohostIds.add(source.created_by as string);
  }
  for (const uid of cohostIds) {
    cohostRows.push({ trip_id: newTrip.id as string, user_id: uid, invited_by: newPlannerId });
  }
  if (cohostRows.length > 0) {
    await svc.from("trip_cohosts").insert(cohostRows);
  }

  return jsonOk({ trip: newTrip });
}

function appendCopySuffix(name: string): string {
  const m = name.match(/^(.*?)( \(copy(?: (\d+))?\))?$/);
  if (!m) return `${name} (copy)`.slice(0, 60);
  const base = m[1]!;
  const had = m[2];
  const num = m[3];
  if (!had) return `${base} (copy)`.slice(0, 60);
  const next = num ? parseInt(num, 10) + 1 : 2;
  return `${base} (copy ${next})`.slice(0, 60);
}
