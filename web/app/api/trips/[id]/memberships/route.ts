/**
 * /api/trips/[id]/memberships
 *   POST  — invitee updates their own RSVP (anon allowed via
 *           session_token in body).
 *   PATCH — planner/cohost overrides an RSVP on someone's behalf.
 *
 * Backed by the `respondents` table per BUILD_QUESTIONS Q3.
 * rsvp_status uses the {invited, going, maybe, cant_go} lifecycle
 * (distinct from the legacy `rsvp` column used by the Expo poll).
 */

import { requireAuthUid } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";
import { assertTripWritable } from "@/lib/trip-state";
import type { Respondent, RsvpStatus } from "@shared/types";

const VALID_STATUSES: ReadonlySet<RsvpStatus> = new Set([
  "invited", "going", "maybe", "cant_go",
]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: trip_id } = await ctx.params;
  const body = await safeJson(req);
  if (!body) return jsonErr(400, "invalid_json");

  const session_token = strOrNull(body.session_token);
  const rsvp_status   = strOrNull(body.rsvp_status) as RsvpStatus | null;
  const note          = strOrNull(body.note);

  if (!session_token) return jsonErr(400, "session_token_required");
  if (!rsvp_status || !VALID_STATUSES.has(rsvp_status)) {
    return jsonErr(400, "invalid_rsvp_status");
  }
  if (note != null && note.length > 280) {
    return jsonErr(400, "note_too_long");
  }

  // Phase C: writes to cancelled trips return 410.
  const writability = await assertTripWritable(createServiceClient(), trip_id);
  if (!writability.ok) return jsonErr(writability.status, writability.code, writability.detail);

  // Anon-allowed read+update. RLS policies on respondents already
  // gate "Session owner can update their respondent row" on the
  // session token at the row level.
  const supabase = await createClient();
  const patch: Record<string, unknown> = {
    rsvp_status,
    rsvp_status_updated_at: new Date().toISOString(),
  };
  if (note != null) patch.note = note;

  const { data, error } = await supabase
    .from("respondents")
    .update(patch)
    .eq("trip_id", trip_id)
    .eq("session_token", session_token)
    .select("*")
    .maybeSingle();

  if (error) return jsonErr(500, "rsvp_update_failed", error.message);
  if (!data)  return jsonErr(404, "respondent_not_found");
  return jsonOk(data as Respondent);
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id } = await ctx.params;

  const body = await safeJson(req);
  if (!body) return jsonErr(400, "invalid_json");

  const respondent_id = strOrNull(body.respondent_id);
  const rsvp_status   = strOrNull(body.rsvp_status) as RsvpStatus | null;
  if (!respondent_id) return jsonErr(400, "respondent_id_required");
  if (!rsvp_status || !VALID_STATUSES.has(rsvp_status)) {
    return jsonErr(400, "invalid_rsvp_status");
  }

  // Phase C: writes to cancelled trips return 410.
  const writability = await assertTripWritable(createServiceClient(), trip_id);
  if (!writability.ok) return jsonErr(writability.status, writability.code, writability.detail);

  // RLS gates this on planner/cohost. We additionally pin
  // trip_id so the planner can't sneak edits onto someone else's
  // respondents row by guessing a uuid.
  const { data, error } = await r.supabase
    .from("respondents")
    .update({
      rsvp_status,
      rsvp_status_updated_at: new Date().toISOString(),
    })
    .eq("id", respondent_id)
    .eq("trip_id", trip_id)
    .select("*")
    .maybeSingle();

  if (error) return jsonErr(500, "rsvp_override_failed", error.message);
  if (!data)  return jsonErr(404, "respondent_not_found");
  return jsonOk(data as Respondent);
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}
async function safeJson(req: Request): Promise<Record<string, unknown> | null> {
  try { return (await req.json()) as Record<string, unknown>; }
  catch { return null; }
}
