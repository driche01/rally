/**
 * /api/users/me/profile
 *   GET — fetch the caller's traveler_profile (or 404 if none)
 *   PUT — upsert. Sets vibe_captured_at = now() if any vibe field
 *         is present (i.e. the Phase A capture flow completed).
 *
 * Profile is keyed by phone (PK on traveler_profiles). We resolve
 * the caller's phone via users.auth_user_id → users.phone.
 *
 * Skipping `default_travel_profile_id` per BUILD_QUESTIONS Q2 —
 * one profile per phone, no "default" concept.
 */

import { requireRallyUserId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";
import type {
  TravelerProfile,
  ProfileCaptureInput,
  VibeBeachOrMountain, VibeSpaOrHike, VibeFoodieOrCasual,
  VibeSocialOrChill, VibeCultureOrRelax, BudgetComfort,
} from "@shared/types";

const VIBE_BM   = new Set<VibeBeachOrMountain>(["beach","mountain","both"]);
const VIBE_SH   = new Set<VibeSpaOrHike>(["spa","hike","both"]);
const VIBE_FC   = new Set<VibeFoodieOrCasual>(["foodie","casual","both"]);
const VIBE_SC   = new Set<VibeSocialOrChill>(["social","chill","both"]);
const VIBE_CR   = new Set<VibeCultureOrRelax>(["culture","relaxation","both"]);
const BUDGET    = new Set<BudgetComfort>(["budget","mid","premium","luxury"]);

export async function GET() {
  const r = await requireRallyUserId();
  if (!r.ok) return jsonErr(r.status, r.status === 404 ? "rally_user_not_found" : "unauthenticated");

  // Get the caller's phone, then their profile row. Service-role on
  // the traveler_profiles read for the same reason the PUT uses it
  // (anon SELECT on that table is planner-side-only). The auth gate
  // above guarantees we're only returning the caller's own row.
  const { data: u, error: uErr } = await r.supabase
    .from("users")
    .select("phone")
    .eq("id", r.rallyUserId)
    .maybeSingle();
  if (uErr) return jsonErr(500, "user_lookup_failed", uErr.message);
  if (!u?.phone) return jsonErr(404, "no_phone_on_record");

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("traveler_profiles")
    .select("*")
    .eq("phone", u.phone)
    .maybeSingle();
  if (error) return jsonErr(500, "profile_read_failed", error.message);
  if (!data)  return jsonErr(404, "profile_not_found");
  return jsonOk(data as TravelerProfile);
}

export async function PUT(req: Request) {
  const r = await requireRallyUserId();
  if (!r.ok) return jsonErr(r.status, r.status === 404 ? "rally_user_not_found" : "unauthenticated");

  const body = await safeJson(req);
  if (!body) return jsonErr(400, "invalid_json");

  // Validate every present vibe field.
  if (body.vibe_beach_or_mountain    != null && !VIBE_BM.has(body.vibe_beach_or_mountain as VibeBeachOrMountain)) return jsonErr(400, "invalid_vibe_beach_or_mountain");
  if (body.vibe_spa_or_hike          != null && !VIBE_SH.has(body.vibe_spa_or_hike as VibeSpaOrHike))             return jsonErr(400, "invalid_vibe_spa_or_hike");
  if (body.vibe_foodie_or_casual     != null && !VIBE_FC.has(body.vibe_foodie_or_casual as VibeFoodieOrCasual))   return jsonErr(400, "invalid_vibe_foodie_or_casual");
  if (body.vibe_social_or_chill      != null && !VIBE_SC.has(body.vibe_social_or_chill as VibeSocialOrChill))     return jsonErr(400, "invalid_vibe_social_or_chill");
  if (body.vibe_culture_or_relaxation!= null && !VIBE_CR.has(body.vibe_culture_or_relaxation as VibeCultureOrRelax)) return jsonErr(400, "invalid_vibe_culture_or_relaxation");
  if (body.budget_comfort            != null && !BUDGET.has(body.budget_comfort as BudgetComfort))                return jsonErr(400, "invalid_budget_comfort");

  // Pull the caller's phone — that's the upsert key.
  const { data: u, error: uErr } = await r.supabase
    .from("users")
    .select("phone")
    .eq("id", r.rallyUserId)
    .maybeSingle();
  if (uErr) return jsonErr(500, "user_lookup_failed", uErr.message);
  if (!u?.phone) return jsonErr(409, "no_phone_on_record",
    "User has no phone — Phase A profile capture requires a phone-keyed identity.");

  const anyVibe =
    body.vibe_beach_or_mountain != null ||
    body.vibe_spa_or_hike != null ||
    body.vibe_foodie_or_casual != null ||
    body.vibe_social_or_chill != null ||
    body.vibe_culture_or_relaxation != null;

  const upsert: Partial<TravelerProfile> & { phone: string; user_id: string } = {
    phone:   u.phone,
    user_id: r.rallyUserId,
    home_airport:               strOrNull(body.home_airport),
    dietary_restrictions:       asStringArray(body.dietary_restrictions) ?? [],
    vibe_beach_or_mountain:     (body.vibe_beach_or_mountain as VibeBeachOrMountain) ?? null,
    vibe_spa_or_hike:           (body.vibe_spa_or_hike as VibeSpaOrHike) ?? null,
    vibe_foodie_or_casual:      (body.vibe_foodie_or_casual as VibeFoodieOrCasual) ?? null,
    vibe_social_or_chill:       (body.vibe_social_or_chill as VibeSocialOrChill) ?? null,
    vibe_culture_or_relaxation: (body.vibe_culture_or_relaxation as VibeCultureOrRelax) ?? null,
    budget_comfort:             (body.budget_comfort as BudgetComfort) ?? null,
    vibe_captured_at:           anyVibe ? new Date().toISOString() : null,
  };

  // Service-role for the write: traveler_profiles RLS doesn't permit
  // a phone-keyed owner upsert under the user JWT (the policy is
  // planner-side-only — Phase A's RSVP route already used service-
  // role for the same reason). We've already gated on the caller's
  // identity via requireRallyUserId + the phone derived from their
  // users row, so this stays safe.
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("traveler_profiles")
    .upsert(upsert, { onConflict: "phone" })
    .select("*")
    .single();
  if (error) return jsonErr(500, "profile_upsert_failed", error.message);
  return jsonOk(data as TravelerProfile);
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}
function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) if (typeof x === "string") out.push(x);
  return out;
}
function _types(_: ProfileCaptureInput): void {
  // Compile-time anchor so the shared type stays in sync with this
  // endpoint's input shape. Strip if it becomes annoying.
}
async function safeJson(req: Request): Promise<Record<string, unknown> | null> {
  try { return (await req.json()) as Record<string, unknown>; }
  catch { return null; }
}
