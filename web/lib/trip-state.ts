/**
 * Trip-state guards — Phase C.
 *
 * Every write route that mutates trip-scoped data should call
 * `assertTripWritable()` before doing anything. It returns 410 if
 * the trip has been cancelled (per the build guide §8 lock state).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface WritabilityFail {
  ok: false;
  status: number;
  code: string;
  detail: string;
}
export interface WritabilityOk {
  ok: true;
  trip: { id: string; cancelled_at: string | null };
}
export type WritabilityResult = WritabilityOk | WritabilityFail;

export async function assertTripWritable(
  admin: SupabaseClient,
  tripId: string,
): Promise<WritabilityResult> {
  const { data: trip, error } = await admin
    .from("trips")
    .select("id, cancelled_at")
    .eq("id", tripId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, code: "trip_lookup_failed", detail: error.message };
  if (!trip)  return { ok: false, status: 404, code: "trip_not_found", detail: "" };
  if (trip.cancelled_at) {
    return { ok: false, status: 410, code: "trip_cancelled", detail: trip.cancelled_at };
  }
  return { ok: true, trip: { id: trip.id, cancelled_at: trip.cancelled_at } };
}
