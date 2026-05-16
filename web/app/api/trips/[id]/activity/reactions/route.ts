/**
 * GET /api/trips/[id]/activity/reactions
 *
 * Returns every reaction on every entry in this trip. The activity
 * feed UI groups them per-entry client-side. Anon-readable — the
 * underlying activity_feed_entries are reachable via share token,
 * and reactions don't carry any PII beyond the user_id.
 *
 * Toggling a reaction goes through
 * /api/trips/[id]/activity/[entryId]/reactions (POST).
 */

import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: trip_id } = await ctx.params;

  const svc = createServiceClient();
  // Two-step: pull the trip's entry IDs, then the reactions on those.
  // Saves a join + keeps the query plain.
  const { data: entries, error: entriesErr } = await svc
    .from("activity_feed_entries")
    .select("id")
    .eq("trip_id", trip_id);
  if (entriesErr) return jsonErr(500, "entry_list_failed", entriesErr.message);

  const ids = (entries ?? []).map((e) => e.id);
  if (ids.length === 0) return jsonOk([]);

  const { data, error } = await svc
    .from("activity_reactions")
    .select("*")
    .in("entry_id", ids);
  if (error) return jsonErr(500, "reactions_read_failed", error.message);

  return jsonOk(data ?? []);
}
