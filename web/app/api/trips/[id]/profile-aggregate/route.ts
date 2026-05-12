/**
 * GET /api/trips/[id]/profile-aggregate
 *
 * Phase B prerequisite — every AI generation downstream consumes
 * this. Returns the structured aggregate described in build guide §4.
 *
 * Auth: gated to the trip's planner OR a cohost. The aggregate
 * surfaces individual-level signals (dietary restrictions, budget
 * tier) that shouldn't leak to anon under a share token.
 *
 * Cache: in-memory Map keyed on trip_id with a 5-minute TTL.
 * Invalidation events (RSVP change, profile edit) aren't wired yet
 * — for Phase B Step 2 the TTL is the only invalidator. The cache
 * is per-server-process (Next.js runtime), not distributed; that's
 * fine for the alpha.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { aggregateTripProfiles } from "@/lib/ai/aggregate";
import { jsonErr, jsonOk } from "@/lib/http";
import type { Respondent, TravelerProfile, TripProfileAggregate } from "@shared/types";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { aggregate: TripProfileAggregate; expiresAt: number }>();

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id } = await ctx.params;

  // Authorize: planner or cohost.
  const { data: trip, error: tripErr } = await r.supabase
    .from("trips")
    .select("id, created_by")
    .eq("id", trip_id)
    .maybeSingle();
  if (tripErr)  return jsonErr(500, "trip_read_failed", tripErr.message);
  if (!trip)    return jsonErr(404, "trip_not_found");

  const isPlanner = trip.created_by === r.authUid;
  if (!isPlanner) {
    const { data: cohost } = await r.supabase
      .from("trip_cohosts")
      .select("trip_id")
      .eq("trip_id", trip_id)
      .eq("user_id", r.authUid)
      .maybeSingle();
    if (!cohost) return jsonErr(403, "forbidden");
  }

  // Cache hit?
  const cached = cache.get(trip_id);
  if (cached && cached.expiresAt > Date.now()) {
    return jsonOk(cached.aggregate);
  }

  // Pull going respondents + their profiles via service-role.
  const svc = createServiceClient();
  const { data: respondents, error: respErr } = await svc
    .from("respondents")
    .select("id, phone, name")
    .eq("trip_id", trip_id)
    .eq("rsvp_status", "going");
  if (respErr) return jsonErr(500, "respondents_read_failed", respErr.message);

  const goingRespondents = (respondents ?? []) as Pick<Respondent, "id" | "phone" | "name">[];
  const phones = goingRespondents
    .map((r) => r.phone)
    .filter((p): p is string => !!p);

  type ProfileSlice = Pick<TravelerProfile,
    | "vibe_beach_or_mountain"
    | "vibe_spa_or_hike"
    | "vibe_foodie_or_casual"
    | "vibe_social_or_chill"
    | "vibe_culture_or_relaxation"
    | "budget_comfort"
    | "home_airport"
    | "dietary_restrictions"
    | "vibe_captured_at"
  >;
  const profilesByPhone = new Map<string, ProfileSlice>();

  if (phones.length > 0) {
    const { data: profiles, error: profErr } = await svc
      .from("traveler_profiles")
      .select(
        "phone, vibe_beach_or_mountain, vibe_spa_or_hike, vibe_foodie_or_casual, vibe_social_or_chill, vibe_culture_or_relaxation, budget_comfort, home_airport, dietary_restrictions, vibe_captured_at",
      )
      .in("phone", phones);
    if (profErr) return jsonErr(500, "profiles_read_failed", profErr.message);
    for (const p of (profiles ?? []) as (ProfileSlice & { phone: string })[]) {
      profilesByPhone.set(p.phone, p);
    }
  }

  const aggregate = aggregateTripProfiles({
    tripId: trip_id,
    goingRespondents,
    profilesByPhone,
  });

  cache.set(trip_id, { aggregate, expiresAt: Date.now() + CACHE_TTL_MS });
  return jsonOk(aggregate);
}
