/**
 * tripDates — single source of truth for "what calendar dates does this
 * trip actually have locked?"
 *
 * The naive answer — read trips.start_date / trips.end_date — is wrong
 * whenever a planner enters seed dates at trip-create time AND a dates
 * poll is still open: the seed values sit on the trip row but the group
 * hasn't actually decided yet. Reading them directly makes the hero
 * card, hub tabs, lodging suggestions, etc. all act as if dates were
 * locked when they aren't.
 *
 * Truth table for the locked dates:
 *   1. A *decided* date-range dates-poll exists →
 *      use trips.start_date/end_date (the approve RPC writes them);
 *      fall back to parsing the decided option label if the row is
 *      still null (legacy approve path that wrote only trip_duration).
 *   2. A *live* (not-yet-decided) date-range dates-poll exists →
 *      return null; trips.start_date/end_date is a stale seed.
 *   3. No date-range dates-poll exists at all →
 *      use trips.start_date/end_date directly. The planner skipped
 *      polling and entered dates manually.
 *
 * Duration-only dates polls (option labels like "5 nights" / "1 week"
 * that don't parse as a calendar range) don't claim the calendar slot,
 * so they're ignored here.
 */
import { parseDateRangeLabel } from './pollFormUtils';
import type { Trip } from '@/types/database';

interface TripDates {
  startDate: string | null;
  endDate: string | null;
}

/**
 * Structural shape of a poll for date-locking purposes. Compatible with
 * both `PollWithOptions` (planner-side, `poll_options`) and the public
 * /results /summary API shape (`options`). Either field name works — the
 * helper picks whichever is non-null.
 */
export interface DatePollLike {
  type: string;
  status: string;
  decided_option_id?: string | null;
  poll_options?: { id: string; label: string }[];
  options?: { id: string; label: string }[];
}

function pollOptions(p: DatePollLike): { id: string; label: string }[] {
  return p.poll_options ?? p.options ?? [];
}

function pad2(n: number): string { return n.toString().padStart(2, '0'); }

/** Local-date → 'YYYY-MM-DD'. Mirrors the trips-table format so derived
 *  dates use the same string shape as canonical trip.start_date. */
function toIsoDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function getEffectiveTripDates(
  trip: Pick<Trip, 'start_date' | 'end_date'> | null | undefined,
  polls: DatePollLike[],
): TripDates {
  // Find a date-range dates-poll (any status). Multiple dates polls can
  // exist (date-range + duration); we only care about the calendar one.
  const dateRangePolls = polls.filter(
    (p) => p.type === 'dates' && pollOptions(p).some((o) => parseDateRangeLabel(o.label) !== null),
  );
  const decided = dateRangePolls.find((p) => p.status === 'decided' && p.decided_option_id);

  if (decided) {
    // Decided → trips.start_date/end_date is authoritative when set
    // (approve_poll_recommendation_with_dates writes it). Fall back to
    // parsing the option label for legacy approve paths.
    if (trip?.start_date && trip?.end_date) {
      return { startDate: trip.start_date, endDate: trip.end_date };
    }
    const opt = pollOptions(decided).find((o) => o.id === decided.decided_option_id);
    const range = opt ? parseDateRangeLabel(opt.label) : null;
    return range
      ? { startDate: toIsoDay(range.start), endDate: toIsoDay(range.end) }
      : { startDate: trip?.start_date ?? null, endDate: trip?.end_date ?? null };
  }

  const live = dateRangePolls.find((p) => p.status !== 'decided');
  if (live) {
    // Vote still open → seed values on the trip row are stale, don't
    // expose them as locked.
    return { startDate: null, endDate: null };
  }

  // No date-range poll → trip row is the planner's direct pick.
  return {
    startDate: trip?.start_date ?? null,
    endDate:   trip?.end_date   ?? null,
  };
}

/** Convenience: returns true iff both dates are locked. */
export function hasEffectiveTripDates(
  trip: Pick<Trip, 'start_date' | 'end_date'> | null | undefined,
  polls: DatePollLike[],
): boolean {
  const { startDate, endDate } = getEffectiveTripDates(trip, polls);
  return Boolean(startDate && endDate);
}
