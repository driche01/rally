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
  reason: "feed_silent_14d" | "headcount_soft_pre_booking" | "booking_imminent";
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
   * taps "Send a nudge". Per Q34, the alpha+ reframe defaults all
   * three signals to "unresponded" (invited + maybe) — the people
   * the planner actually needs commitments from.
   */
  defaultSegment: "going" | "maybe" | "invited" | "all" | "unresponded";
}

export async function detectStallForBanner(
  admin: SupabaseClient,
  tripId: string,
  startDate: string | null,
  bookByDate: string | null,
  cancelledAt: string | null,
  now: Date = new Date(),
): Promise<StallSignal | null> {
  if (cancelledAt) return null;

  // Re-key on book_by_date (Q35). For legacy trips with no
  // book_by_date set, fall back to start_date - 30d.
  const effectiveBookBy = bookByDate
    ? new Date(`${bookByDate}T00:00:00`)
    : startDate
      ? new Date(new Date(`${startDate}T00:00:00`).getTime() - 30 * 86_400_000)
      : null;
  if (!effectiveBookBy) return null;
  const daysUntilBookBy = (effectiveBookBy.getTime() - now.getTime()) / 86_400_000;

  // Helper: count unresponded (invited + maybe) on this trip.
  async function countUnresponded(): Promise<{ unresponded: number; total: number }> {
    const { data } = await admin
      .from("respondents")
      .select("rsvp_status")
      .eq("trip_id", tripId);
    const rows = (data ?? []) as { rsvp_status: string | null }[];
    let unresponded = 0;
    for (const r of rows) {
      if (r.rsvp_status === "invited" || r.rsvp_status === "maybe") unresponded++;
    }
    return { unresponded, total: rows.length };
  }

  // Signal A1: feed silent 14d AND book_by > 21d out.
  if (daysUntilBookBy > 21) {
    const cutoff = new Date(now.getTime() - 14 * 86_400_000).toISOString();
    const { data } = await admin
      .from("activity_feed_entries").select("id")
      .eq("trip_id", tripId).gt("created_at", cutoff).limit(1);
    if ((data?.length ?? 0) === 0) {
      return {
        reason: "feed_silent_14d",
        headline: "Things have been quiet.",
        detail:   "Nothing's hit the feed in 2 weeks. A check-in would help confirm who's still in.",
        cta:      "hey [Name] — circling back on the trip. quick check: you still in? a yes/no helps me lock things down on my end →",
        defaultSegment: "unresponded",
      };
    }
  }

  // Signal A2: book_by ≤ 21d out AND >25% of respondents still unresponded.
  // Disjoint from A1 (which fires when book_by > 21d) and A3
  // (which fires when book_by ≤ 14d). Each banner owns a clean
  // window with no overlap.
  if (daysUntilBookBy <= 21 && daysUntilBookBy > 14) {
    const { unresponded, total } = await countUnresponded();
    if (total > 0 && unresponded / total > 0.25) {
      return {
        reason: "headcount_soft_pre_booking",
        headline: "Headcount still soft.",
        detail:   "About 3 weeks until booking lodging + travel. Worth confirming who's actually in so you can start locking final details.",
        cta:      "hey [Name] — booking lodging + travel soon. quick yes/no so we can lock final headcount →",
        defaultSegment: "unresponded",
      };
    }
  }

  // Signal A3: book_by ≤ 14d out AND any unresponded at all.
  if (daysUntilBookBy <= 14 && daysUntilBookBy > 0) {
    const { unresponded } = await countUnresponded();
    if (unresponded > 0) {
      return {
        reason: "booking_imminent",
        headline: "Booking's 2 weeks out.",
        detail:   "Confirm the final RSVPs so you can lock in headcount for bookings.",
        cta:      "hey [Name] — booking in 2 weeks. need a final yes/no from you so we can lock headcount →",
        defaultSegment: "unresponded",
      };
    }
  }

  return null;
}
