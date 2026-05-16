/**
 * /api/account
 *   GET    — return the caller's account settings (phone, calendar
 *            token + filter prefs, profile id).
 *   PATCH  — partial update of calendar-sync prefs only.
 *
 * Phone-change and account-deletion go through the existing edge
 * functions (request-phone-change-otp / verify-phone-change-otp /
 * delete-account), invoked from the client over the user JWT —
 * they already handle the SMS pipeline + cascade properly.
 *
 * Both branches require an authed session (auth.uid()).
 */

import { requireAuthUid } from "@/lib/auth";
import { jsonErr, jsonOk } from "@/lib/http";

export async function GET() {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");

  const { data, error } = await r.supabase
    .from("profiles")
    .select("id, name, last_name, phone, email, avatar_url, calendar_token, calendar_include_going, calendar_include_maybe, calendar_include_invited")
    .eq("id", r.authUid)
    .maybeSingle();
  if (error) return jsonErr(500, "profile_read_failed", error.message);
  if (!data)  return jsonErr(404, "profile_not_found");

  return jsonOk(data);
}

export async function PATCH(req: Request) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");

  const body = (await req.json().catch(() => null)) as {
    calendar_include_going?:   boolean;
    calendar_include_maybe?:   boolean;
    calendar_include_invited?: boolean;
  } | null;
  if (!body) return jsonErr(400, "invalid_json");

  const patch: Record<string, unknown> = {};
  if (typeof body.calendar_include_going   === "boolean") patch.calendar_include_going   = body.calendar_include_going;
  if (typeof body.calendar_include_maybe   === "boolean") patch.calendar_include_maybe   = body.calendar_include_maybe;
  if (typeof body.calendar_include_invited === "boolean") patch.calendar_include_invited = body.calendar_include_invited;
  if (Object.keys(patch).length === 0) return jsonErr(400, "nothing_to_update");

  const { data, error } = await r.supabase
    .from("profiles")
    .update(patch)
    .eq("id", r.authUid)
    .select("calendar_include_going, calendar_include_maybe, calendar_include_invited")
    .single();
  if (error) return jsonErr(500, "profile_update_failed", error.message);

  return jsonOk(data);
}
