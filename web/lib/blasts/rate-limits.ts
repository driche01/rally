/**
 * Per-recipient 2/24h rate limit for outbound SMS (carrier compliance
 * + ethical: don't hammer any single number across all sources).
 *
 * Phase C v1 deliberately does NOT cap blasts per trip or per planner
 * (the build guide proposed 3/week + 10/lifetime; we dropped those
 * 2026-05-12 per user directive — "if it becomes an expense issue
 * later we can consider it then"). The per-recipient limit stays
 * because it protects individual phones from spam regardless of
 * which planner is composing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

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
