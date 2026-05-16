/**
 * Profile-page visibility gate (Q29).
 *
 * A user can view another user's full profile iff they've ever
 * shared a `respondents` row on the same trip — currently invited
 * to the same trip OR went on a past trip together OR have any
 * trip-level overlap of any kind.
 *
 * The Q24 self-respondent auto-create means planners always have
 * a respondents row on their own trips, so this rule cleanly covers
 * "the planner of a trip viewing an invitee" without a special-case.
 *
 * Non-visible profiles render a graceful locked state (NOT 404),
 * showing only first name + initial-letter avatar + an explanation
 * + an easy back-nav. See web/app/user/[id]/page.tsx.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function canViewUserProfile(
  admin: SupabaseClient,
  viewerUserId: string,
  targetUserId: string,
): Promise<boolean> {
  if (viewerUserId === targetUserId) return true;

  // "Any shared respondents row, ever." Single query against
  // respondents — no mutuals or current-trip union needed because
  // both cases manifest as a shared row on the same trip_id.
  const { data, error } = await admin
    .from("respondents")
    .select("trip_id, user_id")
    .in("user_id", [viewerUserId, targetUserId]);

  if (error || !data) return false;

  const tripsByUser = new Map<string, Set<string>>();
  for (const row of data) {
    const u = row.user_id as string | null;
    if (!u) continue;
    const set = tripsByUser.get(u) ?? new Set<string>();
    set.add(row.trip_id as string);
    tripsByUser.set(u, set);
  }
  const viewerTrips = tripsByUser.get(viewerUserId);
  const targetTrips = tripsByUser.get(targetUserId);
  if (!viewerTrips || !targetTrips) return false;

  for (const t of viewerTrips) {
    if (targetTrips.has(t)) return true;
  }
  return false;
}
