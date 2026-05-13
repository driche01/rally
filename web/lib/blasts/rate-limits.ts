/**
 * Planner-blast rate limit math (Phase C, build guide §5).
 *
 * Three concurrent limits that all must pass before a blast sends:
 *   - 3 blasts per rolling 7-day window per trip
 *   - 10 blasts total per trip lifetime
 *   - 2 outbound SMS per 24h per recipient (across ALL sources —
 *     reminders + blasts)
 *
 * The first two are per-trip queries on `planner_blasts`. The third
 * is per-recipient on `thread_messages`. All three are app-layer —
 * no schema changes (existing indexes on `idx_planner_blasts_trip_created`
 * + `thread_messages.sender_phone` + `created_at` cover the hot paths).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface TripBlastLimits {
  weekly_used:    number;
  weekly_limit:   number;
  lifetime_used:  number;
  lifetime_limit: number;
  weekly_remaining:   number;  // weekly_limit − weekly_used (≥ 0)
  lifetime_remaining: number;
  can_send: boolean;            // both remaining > 0
}

const WEEKLY_LIMIT   = 3;
const LIFETIME_LIMIT = 10;

export async function getTripBlastLimits(
  admin: SupabaseClient,
  tripId: string,
  now: Date = new Date(),
): Promise<TripBlastLimits> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [weeklyRes, lifetimeRes] = await Promise.all([
    admin.from("planner_blasts")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", tripId)
      .gte("created_at", weekAgo),
    admin.from("planner_blasts")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", tripId),
  ]);

  const weeklyUsed   = weeklyRes.count   ?? 0;
  const lifetimeUsed = lifetimeRes.count ?? 0;
  const weeklyRemaining   = Math.max(0, WEEKLY_LIMIT   - weeklyUsed);
  const lifetimeRemaining = Math.max(0, LIFETIME_LIMIT - lifetimeUsed);

  return {
    weekly_used: weeklyUsed,
    weekly_limit: WEEKLY_LIMIT,
    lifetime_used: lifetimeUsed,
    lifetime_limit: LIFETIME_LIMIT,
    weekly_remaining: weeklyRemaining,
    lifetime_remaining: lifetimeRemaining,
    can_send: weeklyRemaining > 0 && lifetimeRemaining > 0,
  };
}

/**
 * Per-recipient 2/24h check. Returns the subset of phone numbers
 * that are NOT over the limit. Use to filter the recipient list at
 * compose time so we don't blow rate limits per recipient.
 */
export async function filterRecipientsBy24hLimit(
  admin: SupabaseClient,
  phones: string[],
  now: Date = new Date(),
): Promise<{ allowed: string[]; suppressed: string[] }> {
  if (phones.length === 0) return { allowed: [], suppressed: [] };
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // sender_phone on thread_messages logs the recipient (see twilio.ts).
  const { data } = await admin
    .from("thread_messages")
    .select("sender_phone")
    .in("sender_phone", phones)
    .eq("direction", "outbound")
    .gte("created_at", cutoff);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const p = row.sender_phone as string;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const allowed: string[] = [];
  const suppressed: string[] = [];
  for (const p of phones) {
    if ((counts.get(p) ?? 0) >= 2) suppressed.push(p);
    else                            allowed.push(p);
  }
  return { allowed, suppressed };
}
