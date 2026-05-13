/**
 * POST /api/invite/[token]/rsvp
 *
 * Anon-accessible RSVP finalize endpoint. Does the whole flow in
 * one shot:
 *   1. Validate trip via share token
 *   2. Upsert traveler_profile (if capture payload supplied)
 *   3. Find or create the respondent for this trip + phone
 *   4. Update rsvp_status + rsvp_status_updated_at + note
 *   5. Auto-post an rsvp_update entry to the activity feed
 *
 * Service-role for the writes (so RLS doesn't block respondents
 * we need to insert / profile rows the caller doesn't own).
 * Auth is via the share token (the URL itself is the credential).
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { jsonErr, jsonOk } from "@/lib/http";
import type {
  Respondent,
  RsvpStatus,
  VibeBeachOrMountain, VibeSpaOrHike, VibeFoodieOrCasual,
  VibeSocialOrChill, VibeCultureOrRelax, BudgetComfort,
} from "@shared/types";
import { randomBytes } from "node:crypto";

const VALID_STATUSES: ReadonlySet<RsvpStatus> = new Set([
  "going", "maybe", "cant_go",
]);
const VIBE_BM = new Set<VibeBeachOrMountain>(["beach","mountain","both"]);
const VIBE_SH = new Set<VibeSpaOrHike>(["spa","hike","both"]);
const VIBE_FC = new Set<VibeFoodieOrCasual>(["foodie","casual","both"]);
const VIBE_SC = new Set<VibeSocialOrChill>(["social","chill","both"]);
const VIBE_CR = new Set<VibeCultureOrRelax>(["culture","relaxation","both"]);
const BUDGET = new Set<BudgetComfort>(["budget","mid","premium","luxury"]);

interface CapturePayload {
  vibe_beach_or_mountain?: VibeBeachOrMountain;
  vibe_spa_or_hike?: VibeSpaOrHike;
  vibe_foodie_or_casual?: VibeFoodieOrCasual;
  vibe_social_or_chill?: VibeSocialOrChill;
  vibe_culture_or_relaxation?: VibeCultureOrRelax;
  budget_comfort?: BudgetComfort;
  home_airport?: string | null;
  dietary_restrictions?: string[];
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const body = (await req.json().catch(() => null)) as
    | {
        phone?: string;
        name?: string;
        rsvp_status?: RsvpStatus;
        note?: string;
        profile?: CapturePayload;
      }
    | null;
  if (!body) return jsonErr(400, "invalid_json");

  const phone = normalizePhone(body.phone ?? "");
  const name = (body.name ?? "").trim();
  const rsvp_status = body.rsvp_status;
  const note = (body.note ?? "").trim() || null;

  if (!phone)                       return jsonErr(400, "invalid_phone");
  if (!name)                        return jsonErr(400, "name_required");
  if (name.length > 30)             return jsonErr(400, "name_too_long");
  if (!rsvp_status || !VALID_STATUSES.has(rsvp_status))
    return jsonErr(400, "invalid_rsvp_status");
  if (note != null && note.length > 280)
    return jsonErr(400, "note_too_long");

  // Validate the profile shape if supplied.
  if (body.profile) {
    const p = body.profile;
    if (p.vibe_beach_or_mountain     && !VIBE_BM.has(p.vibe_beach_or_mountain))   return jsonErr(400, "invalid_vibe_beach_or_mountain");
    if (p.vibe_spa_or_hike           && !VIBE_SH.has(p.vibe_spa_or_hike))         return jsonErr(400, "invalid_vibe_spa_or_hike");
    if (p.vibe_foodie_or_casual      && !VIBE_FC.has(p.vibe_foodie_or_casual))    return jsonErr(400, "invalid_vibe_foodie_or_casual");
    if (p.vibe_social_or_chill       && !VIBE_SC.has(p.vibe_social_or_chill))     return jsonErr(400, "invalid_vibe_social_or_chill");
    if (p.vibe_culture_or_relaxation && !VIBE_CR.has(p.vibe_culture_or_relaxation)) return jsonErr(400, "invalid_vibe_culture_or_relaxation");
    if (p.budget_comfort             && !BUDGET.has(p.budget_comfort))            return jsonErr(400, "invalid_budget_comfort");
  }

  // Resolve trip via share token (anon-allowed).
  const anon = await createClient();
  const { data: tripRow, error: tripErr } = await anon
    .from("trips")
    .select("id, cancelled_at")
    .eq("share_token", token)
    .maybeSingle();
  if (tripErr)  return jsonErr(500, "trip_read_failed", tripErr.message);
  if (!tripRow) return jsonErr(404, "trip_not_found");
  if (tripRow.cancelled_at) return jsonErr(410, "trip_cancelled");
  const trip_id = tripRow.id as string;

  const svc = createServiceClient();

  // 1. Upsert traveler_profile if capture payload provided.
  if (body.profile) {
    const p = body.profile;
    const anyVibe =
      !!(p.vibe_beach_or_mountain ||
         p.vibe_spa_or_hike ||
         p.vibe_foodie_or_casual ||
         p.vibe_social_or_chill ||
         p.vibe_culture_or_relaxation);
    const profileRow = {
      phone,
      vibe_beach_or_mountain:     p.vibe_beach_or_mountain ?? null,
      vibe_spa_or_hike:           p.vibe_spa_or_hike ?? null,
      vibe_foodie_or_casual:      p.vibe_foodie_or_casual ?? null,
      vibe_social_or_chill:       p.vibe_social_or_chill ?? null,
      vibe_culture_or_relaxation: p.vibe_culture_or_relaxation ?? null,
      budget_comfort:             p.budget_comfort ?? null,
      home_airport:               p.home_airport ?? null,
      dietary_restrictions:       p.dietary_restrictions ?? [],
      vibe_captured_at:           anyVibe ? new Date().toISOString() : null,
    };
    const { error: upsertErr } = await svc
      .from("traveler_profiles")
      .upsert(profileRow, { onConflict: "phone" });
    if (upsertErr) return jsonErr(500, "profile_upsert_failed", upsertErr.message);
  }

  // 2. Find or create respondent for this trip+phone.
  const { data: existing } = await svc
    .from("respondents")
    .select("id, session_token, name")
    .eq("trip_id", trip_id)
    .eq("phone", phone)
    .maybeSingle();

  let respondentId: string;
  if (existing) {
    respondentId = existing.id;
  } else {
    const session_token = randomBytes(16).toString("hex");
    const { data: inserted, error: insErr } = await svc
      .from("respondents")
      .insert({
        trip_id,
        phone,
        name,
        session_token,
        is_planner: false,
        invited_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insErr) return jsonErr(500, "respondent_insert_failed", insErr.message);
    respondentId = inserted.id;
  }

  // 3. Update the RSVP fields.
  const updatePatch: Record<string, unknown> = {
    rsvp_status,
    rsvp_status_updated_at: new Date().toISOString(),
  };
  if (note !== null) updatePatch.note = note;
  // Keep name fresh if the user re-typed it; we only overwrite if the
  // existing name was empty or differs by trim — avoid trampling a
  // planner-supplied name with a casual self-entered one.
  if (!existing || !existing.name || existing.name.trim() === "") {
    updatePatch.name = name;
  }

  const { data: updated, error: updErr } = await svc
    .from("respondents")
    .update(updatePatch)
    .eq("id", respondentId)
    .select("*")
    .single();
  if (updErr) return jsonErr(500, "rsvp_update_failed", updErr.message);

  // 4. Auto-post an rsvp_update activity entry. Service-role bypasses
  //    the policy that restricts INSERT entry_types — for the
  //    rsvp_update type, only triggers should normally write, but we
  //    haven't built that trigger yet (Phase A scope cap).
  await svc.from("activity_feed_entries").insert({
    trip_id,
    user_id: null, // anon RSVP; planner-side has a users.id, but
                   // invitee-side may not, and the FK is nullable
    entry_type: "rsvp_update",
    content: {
      name: name,
      status: rsvp_status,
    },
  });

  return jsonOk(updated as Respondent);
}
