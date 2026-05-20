/**
 * Auth helpers for route handlers.
 *
 * Rally's identity has two layers:
 *   - auth.uid()       — Supabase Auth id (also = profiles.id)
 *   - users.id         — Rally id, looked up via users.auth_user_id
 *
 * Planner-side endpoints want auth.uid() (matches trips.created_by,
 * trip_cohosts.user_id). Invitee/SMS-side endpoints want users.id
 * (matches respondents.user_id, mutuals.user_id).
 */

import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/** Resolves the current session's profiles.id (= auth.uid()). 401-style result. */
export async function requireAuthUid(): Promise<
  { ok: true; authUid: string; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; status: 401 }
> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return { ok: false, status: 401 };
  return { ok: true, authUid: data.user.id, supabase };
}

/** Resolves the current session's users.id (via users.auth_user_id). */
export async function requireRallyUserId(): Promise<
  { ok: true; authUid: string; rallyUserId: string; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; status: 401 | 404 }
> {
  const r = await requireAuthUid();
  if (!r.ok) return r;
  const { data, error } = await r.supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", r.authUid)
    .maybeSingle();
  if (error) return { ok: false, status: 401 };
  if (!data) return { ok: false, status: 404 };
  return { ok: true, authUid: r.authUid, rallyUserId: data.id, supabase: r.supabase };
}

/**
 * Trip-participant resolver for tab-content endpoints (travel,
 * itinerary, lodging, meals, shopping).
 *
 * Alpha policy (2026-05-19): every participant on the trip — planner,
 * cohost, OR any respondent with a valid rally_session_token cookie
 * mapped to a respondent row on this trip — is allowed to edit tab
 * content. The role is returned so endpoints can apply finer-grained
 * checks if they need to (e.g., audit logging "edited by <name>").
 *
 * What this does NOT cover: trip-chrome actions that stay planner-
 * only (cancel trip, send blast, edit cover/theme/effect, transfer
 * ownership). Those endpoints should keep using requireAuthUid +
 * their own cohost gate.
 */
export interface TripParticipant {
  /** Supabase auth.uid() if the caller is logged in. */
  authUid: string | null;
  /** respondent row id on this trip — present when role is
   *  "respondent" OR when an authed planner/cohost also has a
   *  respondent row (e.g., the planner self-respondent). */
  respondentId: string | null;
  role: "planner" | "cohost" | "respondent";
}

export async function resolveTripParticipant(
  tripId: string,
): Promise<
  | { ok: true; participant: TripParticipant; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; status: 401 | 403 | 404 }
> {
  const supabase = await createClient();
  const svc = createServiceClient();

  // Trip existence + planner id (service-role; RLS would block on
  // anon callers but the share-token gate happens at the route level).
  const { data: trip } = await svc
    .from("trips")
    .select("id, created_by")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) return { ok: false, status: 404 };

  // 1. Authed-user path — could be planner or cohost.
  const { data: authData } = await supabase.auth.getUser();
  const authUid = authData?.user?.id ?? null;

  if (authUid) {
    if (trip.created_by === authUid) {
      // Match planner to their self-respondent row so endpoints that
      // need a respondent_id (e.g., audit) have one.
      const { data: resp } = await svc
        .from("respondents")
        .select("id")
        .eq("trip_id", tripId)
        .eq("is_planner", true)
        .maybeSingle();
      return {
        ok: true,
        participant: { authUid, respondentId: resp?.id ?? null, role: "planner" },
        supabase,
      };
    }
    const { data: cohost } = await svc
      .from("trip_cohosts")
      .select("user_id")
      .eq("trip_id", tripId)
      .eq("user_id", authUid)
      .maybeSingle();
    if (cohost) {
      // Cohosts may or may not have a respondent row; try to match
      // via user_id so downstream code can use their respondent_id.
      const { data: resp } = await svc
        .from("respondents")
        .select("id")
        .eq("trip_id", tripId)
        .eq("user_id", authUid)
        .maybeSingle();
      return {
        ok: true,
        participant: { authUid, respondentId: resp?.id ?? null, role: "cohost" },
        supabase,
      };
    }
  }

  // 2. Anon respondent path — match rally_session_token cookie to a
  // respondent row on this trip. This is what lets an RSVPed visitor
  // edit tab content without ever creating a Rally account.
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("rally_session_token")?.value ?? null;
  if (sessionToken) {
    const { data: resp } = await svc
      .from("respondents")
      .select("id")
      .eq("trip_id", tripId)
      .eq("session_token", sessionToken)
      .maybeSingle();
    if (resp) {
      return {
        ok: true,
        participant: { authUid, respondentId: resp.id, role: "respondent" },
        supabase,
      };
    }
  }

  // 3. No identity → 401; identity but not on this trip → 403.
  return { ok: false, status: authUid ? 403 : 401 };
}
