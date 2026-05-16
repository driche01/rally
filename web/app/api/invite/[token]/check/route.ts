/**
 * GET /api/invite/[token]/check?phone=+1...
 *
 * Anon-accessible (share token is the gate). Looks up:
 *   - The trip referenced by share_token
 *   - Whether the caller already has a traveler_profile (keyed by phone)
 *   - Whether the caller is already a respondent on this trip
 *
 * Used by the RSVP flow to decide:
 *   - Show profile capture vs one-tap confirm
 *   - Auto-create a respondent or update an existing one
 *
 * Uses service-role for traveler_profiles + respondents look-ups
 * because anon SELECT on traveler_profiles requires a planner
 * relationship (per existing RLS). Returns the caller's own profile
 * back to them — Phase A alpha accepts the minor enumeration risk;
 * v2 will gate this behind OTP verification.
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { jsonErr, jsonOk } from "@/lib/http";
import type { TravelerProfile, Trip, Respondent } from "@shared/types";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const url = new URL(req.url);
  const rawPhone = url.searchParams.get("phone") ?? "";
  const phone = normalizePhone(rawPhone);
  if (!phone) return jsonErr(400, "invalid_phone");

  // 1. Trip via share token (anon SELECT policy permits this).
  const anon = await createClient();
  const { data: tripRow, error: tripErr } = await anon
    .from("trips")
    .select("id, name, destination, start_date, end_date, theme, share_token")
    .eq("share_token", token)
    .maybeSingle();
  if (tripErr) return jsonErr(500, "trip_read_failed", tripErr.message);
  if (!tripRow) return jsonErr(404, "trip_not_found");
  const trip = tripRow as Partial<Trip> & { id: string };

  // 2. Lookup traveler_profile + respondent via service-role.
  const svc = createServiceClient();
  const [profileRes, respondentRes] = await Promise.all([
    svc
      .from("traveler_profiles")
      .select(
        "phone, first_name, last_name, home_airport, vibe_beach_or_mountain, vibe_spa_or_hike, vibe_foodie_or_casual, vibe_social_or_chill, vibe_culture_or_relaxation, budget_comfort, dietary_restrictions, vibe_captured_at",
      )
      .eq("phone", phone)
      .maybeSingle(),
    svc
      .from("respondents")
      .select("id, name, first_name, last_name, phone, rsvp_status, session_token, note")
      .eq("trip_id", trip.id)
      .eq("phone", phone)
      .maybeSingle(),
  ]);

  if (profileRes.error)
    return jsonErr(500, "profile_lookup_failed", profileRes.error.message);
  if (respondentRes.error)
    return jsonErr(500, "respondent_lookup_failed", respondentRes.error.message);

  return jsonOk({
    trip,
    profile: profileRes.data as Partial<TravelerProfile> | null,
    respondent: respondentRes.data as Partial<Respondent> | null,
    needs_capture: !profileRes.data?.vibe_captured_at,
  });
}
