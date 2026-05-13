/**
 * Server-side stall detection for the Overview-tab re-engagement
 * banner (Phase C Step 7). Mirrors the scheduler's `detectStallForTrip`
 * (which fires the SMS); this version produces a UI-friendly string.
 *
 * Returns null if the trip isn't stalled. Otherwise returns a short
 * label suitable for a banner ("Nothing on the feed in 2 weeks", etc.).
 *
 * Cheap to call — at most three lightweight count queries.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface StallSignal {
  reason: "feed_silent_14d" | "majority_lodging_unassigned" | "no_itinerary";
  headline: string;          // shown in the banner ("Things have been quiet.")
  detail:   string;          // shown under headline
  /**
   * Pre-fill body for the blast composer. Contains [Name] for the
   * blast pipeline's per-recipient personalization. The trip's
   * invite URL is appended at the dashboard layer (the detector
   * doesn't know about request hosts).
   */
  cta:      string;
  /**
   * Default segment to select in the composer when the planner
   * taps "Send a nudge". Tailored per signal — `going` for the
   * lodging + itinerary nudges (those affect committed members),
   * `all` for feed-silence (re-engage everyone who's still on the
   * fence).
   */
  defaultSegment: "going" | "maybe" | "invited" | "all";
}

export async function detectStallForBanner(
  admin: SupabaseClient,
  tripId: string,
  startDate: string | null,
  cancelledAt: string | null,
  now: Date = new Date(),
): Promise<StallSignal | null> {
  if (cancelledAt || !startDate) return null;
  const daysUntilStart = (new Date(startDate).getTime() - now.getTime()) / 86_400_000;

  // Signal 1: feed silent 14d AND start > 21d out.
  if (daysUntilStart > 21) {
    const cutoff = new Date(now.getTime() - 14 * 86_400_000).toISOString();
    const { data } = await admin
      .from("activity_feed_entries").select("id")
      .eq("trip_id", tripId).gt("created_at", cutoff).limit(1);
    if ((data?.length ?? 0) === 0) {
      return {
        reason: "feed_silent_14d",
        headline: "Things have been quiet.",
        detail:   "Nothing's hit the feed in 2 weeks. A nudge from you would jump-start it.",
        cta:      "hey [Name] — circling back on our trip. quick check in: open the page, drop a comment, lock anything in →",
        defaultSegment: "all",
      };
    }
  }

  // Signal 2: >50% going without lodging AND start < 30d.
  if (daysUntilStart < 30 && daysUntilStart > 0) {
    const { data: going } = await admin
      .from("respondents").select("id")
      .eq("trip_id", tripId).eq("rsvp_status", "going");
    const goingIds = (going ?? []).map((r) => r.id);
    if (goingIds.length > 0) {
      const { data: assigned } = await admin
        .from("lodging_room_assignments").select("respondent_id")
        .in("respondent_id", goingIds);
      if ((assigned?.length ?? 0) / goingIds.length < 0.5) {
        return {
          reason: "majority_lodging_unassigned",
          headline: "Most of the group doesn't have a room yet.",
          detail:   "Trip's less than a month out. Worth a heads-up to the holdouts.",
          cta:      "hey [Name] — trip is coming up + we still need to lock in lodging. take 30 sec and claim a room →",
          defaultSegment: "going",
        };
      }
    }
  }

  // Signal 3: no itinerary AND start < 21d.
  if (daysUntilStart < 21 && daysUntilStart > 0) {
    const { data: items } = await admin
      .from("itinerary_blocks").select("id").eq("trip_id", tripId).limit(1);
    if ((items?.length ?? 0) === 0) {
      return {
        reason: "no_itinerary",
        headline: "No itinerary yet.",
        detail:   "Trip is 3 weeks out and there's nothing planned. Want to generate a draft?",
        cta:      "hey [Name] — pinging the group on the trip — what do we actually want to do? tap to weigh in →",
        defaultSegment: "going",
      };
    }
  }

  return null;
}
