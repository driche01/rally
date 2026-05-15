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

import { cookies } from "next/headers";
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

const SESSION_COOKIE_NAME  = "rally_session_token";
const SESSION_COOKIE_MAX_S = 60 * 60 * 24 * 365; // 1y

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
        // Either supply first+last as separate fields (preferred) OR
        // the legacy `name` field. We backfill the missing side.
        first_name?: string;
        last_name?: string;
        name?: string;
        rsvp_status?: RsvpStatus;
        note?: string;
        profile?: CapturePayload;
      }
    | null;
  if (!body) return jsonErr(400, "invalid_json");

  const phone = normalizePhone(body.phone ?? "");
  const first_name = (body.first_name ?? "").trim();
  const last_name  = (body.last_name  ?? "").trim();
  // Legacy fallback: if only `name` is sent, split on the first
  // whitespace run so older clients still work.
  let name = (body.name ?? "").trim();
  if (!name && first_name) {
    name = last_name ? `${first_name} ${last_name}` : first_name;
  }
  const rsvp_status = body.rsvp_status;
  const note = (body.note ?? "").trim() || null;

  if (!phone)                       return jsonErr(400, "invalid_phone");
  if (!name)                        return jsonErr(400, "name_required");
  if (first_name.length > 30)       return jsonErr(400, "first_name_too_long");
  if (last_name.length > 30)        return jsonErr(400, "last_name_too_long");
  if (name.length > 61)             return jsonErr(400, "name_too_long");
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
      // Persist split-name into the cross-trip cache so future RSVPs
      // pre-fill correctly.
      first_name: first_name || null,
      last_name:  last_name  || null,
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

  // 1b. Find or create the phone-keyed `users` row that represents
  // this person's Rally identity. They don't have an auth.users
  // session yet (that requires SMS OTP via /login), but having a
  // users row means any later sign-in via the same phone will
  // resurface every trip, mutual, and profile they've touched.
  // Errors are non-fatal — RSVP must still complete even if this
  // bookkeeping write trips on a race.
  const displayName = [first_name, last_name].filter(Boolean).join(" ") || name;
  let rallyUserId: string | null = null;
  {
    const { data: existingUser } = await svc
      .from("users")
      .select("id, display_name")
      .eq("phone", phone)
      .maybeSingle();
    if (existingUser) {
      rallyUserId = existingUser.id;
      // Fill in display_name if it's still blank.
      if (!existingUser.display_name && displayName) {
        await svc.from("users").update({ display_name: displayName }).eq("id", existingUser.id);
      }
    } else {
      const { data: createdUser } = await svc
        .from("users")
        .insert({ phone, display_name: displayName || null, rally_account: false })
        .select("id")
        .single();
      rallyUserId = createdUser?.id ?? null;
    }
  }

  // 2. Find or create respondent for this trip+phone.
  const { data: existing } = await svc
    .from("respondents")
    .select("id, session_token, name, user_id")
    .eq("trip_id", trip_id)
    .eq("phone", phone)
    .maybeSingle();

  let respondentId: string;
  let sessionToken: string;
  if (existing) {
    respondentId = existing.id;
    sessionToken = existing.session_token;
  } else {
    sessionToken = randomBytes(16).toString("hex");
    const { data: inserted, error: insErr } = await svc
      .from("respondents")
      .insert({
        trip_id,
        phone,
        name,
        first_name: first_name || null,
        last_name:  last_name  || null,
        session_token: sessionToken,
        is_planner: false,
        user_id: rallyUserId,
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
  // First/last are newer columns — backfill whenever the user
  // explicitly typed them so even a respondent the planner pre-seeded
  // (name='Sam', phone) gets their split-name populated.
  if (first_name) updatePatch.first_name = first_name;
  if (last_name)  updatePatch.last_name  = last_name;
  // Backfill user_id if the planner pre-seeded this row without one.
  if (existing && !existing.user_id && rallyUserId) {
    updatePatch.user_id = rallyUserId;
  }

  const { data: updated, error: updErr } = await svc
    .from("respondents")
    .update(updatePatch)
    .eq("id", respondentId)
    .select("*")
    .single();
  if (updErr) return jsonErr(500, "rsvp_update_failed", updErr.message);

  // 3a. Drop a long-lived cookie tying this browser to the respondent's
  // session_token. The invite page reads it to render "You're going ✓"
  // state on return visits without a full login; lower-friction than
  // re-asking for phone every time. Real auth (for "Create your own
  // trip") still requires SMS OTP — see /api/account/start.
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   SESSION_COOKIE_MAX_S,
  });

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
