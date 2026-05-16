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

import { createClient } from "@/lib/supabase/server";

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
