/**
 * /api/mutuals
 *   GET — fetch the caller's mutuals list (past trip-mates), sorted
 *         by shared_trip_count desc.
 *
 * The mutuals job that populates this table runs separately (Step
 * 10 of build guide §6). Until then, this route returns whatever
 * the job has written so far — which may be an empty array.
 *
 * For Phase A's "minimal" mutuals (build guide §6 Step 6), the
 * invite UI's "past trip-mates" tab calls this endpoint.
 */

import { requireRallyUserId } from "@/lib/auth";
import { jsonErr, jsonOk } from "@/lib/http";
import type { Mutual } from "@shared/types";

export async function GET() {
  const r = await requireRallyUserId();
  if (!r.ok) return jsonErr(r.status, r.status === 404 ? "rally_user_not_found" : "unauthenticated");

  const { data, error } = await r.supabase
    .from("mutuals")
    .select("*")
    .eq("user_id", r.rallyUserId)
    .order("shared_trip_count", { ascending: false })
    .limit(50);

  if (error) return jsonErr(500, "mutuals_read_failed", error.message);
  return jsonOk((data ?? []) as Mutual[]);
}
