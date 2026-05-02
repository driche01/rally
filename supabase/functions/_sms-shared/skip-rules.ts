/**
 * Pure decision helpers for the nudge scheduler's fire-time skip logic.
 *
 * Each helper answers a single yes/no question that determines whether a
 * pending `nudge_sends` row should be skipped instead of fired. The DB
 * lookups that produce the inputs live in `sms-nudge-scheduler/index.ts`
 * — extracting only the pure decisions keeps them unit-testable without
 * Deno DB-mocking infrastructure.
 *
 * The corresponding `skip_reason` strings are the constants exported here
 * so the scheduler call sites and the tests stay in lockstep.
 */

export const SKIP_REASON_TRIP_STARTED = 'trip_started';
export const SKIP_REASON_TRIP_LOCKED = 'trip_locked';

/**
 * "Has the trip already started as of `todayIso`?"
 *
 * Once start_date is reached, poll-completion nudges are stale by
 * definition (the trip is happening or already over). Inputs are ISO
 * date strings (YYYY-MM-DD). Lexicographic compare is correct for that
 * format. A null start_date short-circuits to false — no start date
 * means we don't know when (or if) the trip happens, so don't suppress.
 */
export function isTripStartedAsOf(
  startDate: string | null | undefined,
  todayIso: string,
): boolean {
  if (!startDate) return false;
  return startDate <= todayIso;
}

/**
 * "Are all polls on this trip decided?"
 *
 * A trip with zero polls is NOT considered fully locked — there's
 * nothing to lock, and pending nudges (if any seeded for some other
 * reason) shouldn't be suppressed on that basis. Returns true only when
 * the trip has at least one poll AND none remain undecided.
 *
 * `totalPollCount` and `undecidedPollCount` are computed by the caller
 * with two cheap COUNT queries on `polls`.
 */
export function isTripFullyLocked(
  totalPollCount: number,
  undecidedPollCount: number,
): boolean {
  if (totalPollCount <= 0) return false;
  return undecidedPollCount === 0;
}
