/**
 * Badge computation. Rendered on the profile page (Sprint 4 of the
 * alpha+ scope expansion).
 *
 * Computed on-demand from existing tables — no `user_badges` table
 * needed. Each badge is a small achievement the user has unlocked
 * via their activity on Rally. Keep the badge set small + meaningful
 * for v1+; expand once we see what alpha users actually do.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Badge {
  id:    string;
  label: string;
  emoji: string;
  hint:  string;
}

export interface BadgeStats {
  trips_planned:        number;
  trips_attended:       number;
  distinct_destinations: number;
  mutuals_count:        number;
}

const BADGE_DEFS: Array<{
  id: string;
  label: string;
  emoji: string;
  hint: string;
  predicate: (s: BadgeStats) => boolean;
}> = [
  {
    id:    "first_trip_planned",
    label: "First trip planned",
    emoji: "🚀",
    hint:  "Hosted their first trip on Rally",
    predicate: (s) => s.trips_planned >= 1,
  },
  {
    id:    "trip_planner",
    label: "Trip planner",
    emoji: "📋",
    hint:  "Hosted 3+ trips",
    predicate: (s) => s.trips_planned >= 3,
  },
  {
    id:    "super_planner",
    label: "Super planner",
    emoji: "🎯",
    hint:  "Hosted 10+ trips",
    predicate: (s) => s.trips_planned >= 10,
  },
  {
    id:    "frequent_flier",
    label: "Frequent flier",
    emoji: "✈️",
    hint:  "Said going to 5+ trips",
    predicate: (s) => s.trips_attended >= 5,
  },
  {
    id:    "globe_trotter",
    label: "Globe-trotter",
    emoji: "🌍",
    hint:  "Visited 5+ different destinations on Rally",
    predicate: (s) => s.distinct_destinations >= 5,
  },
  {
    id:    "well_connected",
    label: "Well connected",
    emoji: "🤝",
    hint:  "Traveled with 5+ different people",
    predicate: (s) => s.mutuals_count >= 5,
  },
  {
    id:    "crew_of_ten",
    label: "Crew of 10",
    emoji: "🎉",
    hint:  "Traveled with 10+ different people",
    predicate: (s) => s.mutuals_count >= 10,
  },
];

/**
 * Pull stats + compute which badges apply.
 */
export async function computeBadges(
  admin: SupabaseClient,
  userId: string,
): Promise<{ stats: BadgeStats; badges: Badge[] }> {
  // Run all four counts in parallel.
  const [plannedRes, attendedRes, destinationsRes, mutualsRes] = await Promise.all([
    // trips_planned: trips created_by → profiles.id → users.auth_user_id ↔ users.id
    // Cleanest direct path: trips where created_by maps to this user. created_by
    // FKs profiles(id) per Q1, and profiles.id = auth.users.id = users.auth_user_id.
    // We resolve via users.auth_user_id.
    admin.from("users")
      .select("auth_user_id")
      .eq("id", userId)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!data?.auth_user_id) return { count: 0 };
        return await admin.from("trips")
          .select("id", { count: "exact", head: true })
          .eq("created_by", data.auth_user_id)
          .is("cancelled_at", null);
      }),
    // trips_attended: respondents where user_id = X AND rsvp_status = 'going'
    // and the trip isn't cancelled (joined manually below).
    admin.from("respondents")
      .select("trip_id, trips!inner(id, destination, cancelled_at)")
      .eq("user_id", userId)
      .eq("rsvp_status", "going"),
    // We'll derive distinct_destinations from the same query result.
    Promise.resolve(null),
    // mutuals_count
    admin.from("mutuals")
      .select("mutual_user_id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  const trips_planned = plannedRes.count ?? 0;

  const attendedRows = (attendedRes.data ?? []) as Array<{
    trip_id: string;
    trips: { id: string; destination: string | null; cancelled_at: string | null } | { id: string; destination: string | null; cancelled_at: string | null }[] | null;
  }>;
  const liveAttended = attendedRows
    .map((r) => Array.isArray(r.trips) ? r.trips[0] ?? null : r.trips)
    .filter((t): t is { id: string; destination: string | null; cancelled_at: string | null } => !!t && !t.cancelled_at);
  const trips_attended = liveAttended.length;
  const distinct_destinations = new Set(
    liveAttended.map((t) => (t.destination ?? "").trim().toLowerCase()).filter(Boolean),
  ).size;

  const mutuals_count = mutualsRes.count ?? 0;

  void destinationsRes; // satisfy lint — we computed inline.

  const stats: BadgeStats = {
    trips_planned, trips_attended, distinct_destinations, mutuals_count,
  };

  const badges = BADGE_DEFS
    .filter((d) => d.predicate(stats))
    .map(({ id, label, emoji, hint }) => ({ id, label, emoji, hint }));

  return { stats, badges };
}
