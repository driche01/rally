import { supabase } from '../supabase';
import { parseDateRangeLabel } from '@/lib/pollFormUtils';

/**
 * Returns vote counts per option, grouped by poll.
 * Shape: { [pollId]: { [optionId]: count } }
 *
 * Excludes free-form numeric responses (option_id is null). For numeric
 * counts use {@link getNumericResponseCountsForTrip}.
 */
export async function getResponseCountsForTrip(
  tripId: string
): Promise<Record<string, Record<string, number>>> {
  // Fetch all poll_ids for this trip first
  const { data: polls, error: pollErr } = await supabase
    .from('polls')
    .select('id')
    .eq('trip_id', tripId);
  if (pollErr) throw pollErr;
  if (!polls || polls.length === 0) return {};

  const pollIds = polls.map((p) => p.id);

  // Fetch option-based responses for those polls in one query. Numeric
  // responses (option_id IS NULL) are filtered out — they're aggregated
  // separately in getNumericResponseCountsForTrip.
  const { data: responses, error } = await supabase
    .from('poll_responses')
    .select('poll_id, option_id')
    .in('poll_id', pollIds)
    .not('option_id', 'is', null);
  if (error) throw error;

  const counts: Record<string, Record<string, number>> = {};
  for (const row of responses ?? []) {
    if (!row.option_id) continue;
    if (!counts[row.poll_id]) counts[row.poll_id] = {};
    counts[row.poll_id][row.option_id] = (counts[row.poll_id][row.option_id] ?? 0) + 1;
  }
  return counts;
}

/**
 * Returns histogram of free-form numeric responses, grouped by poll.
 * Shape: { [pollId]: { [numericValue]: count } }
 *
 * Currently used for the duration poll's free-form mode (respondents
 * submit a number of nights instead of picking from preset options).
 */
export async function getNumericResponseCountsForTrip(
  tripId: string
): Promise<Record<string, Record<number, number>>> {
  const { data: polls, error: pollErr } = await supabase
    .from('polls')
    .select('id')
    .eq('trip_id', tripId);
  if (pollErr) throw pollErr;
  if (!polls || polls.length === 0) return {};

  const pollIds = polls.map((p) => p.id);

  const { data: responses, error } = await supabase
    .from('poll_responses')
    .select('poll_id, numeric_value')
    .in('poll_id', pollIds)
    .not('numeric_value', 'is', null);
  if (error) throw error;

  const counts: Record<string, Record<number, number>> = {};
  for (const row of responses ?? []) {
    if (row.numeric_value == null) continue;
    if (!counts[row.poll_id]) counts[row.poll_id] = {};
    counts[row.poll_id][row.numeric_value] =
      (counts[row.poll_id][row.numeric_value] ?? 0) + 1;
  }
  return counts;
}

/**
 * Returns distinct-respondent counts: how many *people* (not votes) have
 * weighed in on each poll, plus the total number of distinct respondents
 * across all polls for the trip.
 *
 * This is the right denominator for the planner-side "X responses" header
 * and per-poll badges — multi-select polls (dates, destination) inflate
 * raw vote counts, but a person who picks 5 days is still 1 respondent.
 *
 * Includes both option-based and numeric (free-form) responses.
 */
export async function getRespondentCountsForTrip(
  tripId: string
): Promise<{ totalRespondents: number; perPoll: Record<string, number> }> {
  const { data: polls, error: pollErr } = await supabase
    .from('polls')
    .select('id')
    .eq('trip_id', tripId);
  if (pollErr) throw pollErr;
  if (!polls || polls.length === 0) return { totalRespondents: 0, perPoll: {} };

  const pollIds = polls.map((p) => p.id);

  const { data: rows, error } = await supabase
    .from('poll_responses')
    .select('poll_id, respondent_id')
    .in('poll_id', pollIds);
  if (error) throw error;

  const perPollSets: Record<string, Set<string>> = {};
  const totalSet = new Set<string>();
  for (const row of rows ?? []) {
    if (!perPollSets[row.poll_id]) perPollSets[row.poll_id] = new Set();
    perPollSets[row.poll_id].add(row.respondent_id);
    totalSet.add(row.respondent_id);
  }

  const perPoll: Record<string, number> = {};
  for (const pid of Object.keys(perPollSets)) {
    perPoll[pid] = perPollSets[pid].size;
  }
  return { totalRespondents: totalSet.size, perPoll };
}

/**
 * For each *decided* poll on the trip, return how many distinct respondents
 * voted for the planner's locked option(s) ("aligned") vs how many voted
 * on the poll at all ("total"). Drives the "X of Y agreed" badge on the
 * planner dashboard's Live results card.
 *
 * Alignment definition:
 *   • destination/duration/budget/custom — voted for decided_option_id.
 *   • dates — voted for *every* option whose date label falls inside
 *     [trips.start_date, trips.end_date]. Anything less than fully-aligned
 *     is not counted (a respondent only free 2 of 3 locked days didn't
 *     "agree" with the picked range).
 */
export async function getAlignedVoteCountsForTrip(
  tripId: string,
): Promise<Record<string, { aligned: number; total: number }>> {
  const { data: polls } = await supabase
    .from('polls')
    .select('id, type, decided_option_id, status, poll_options(id, label)')
    .eq('trip_id', tripId)
    .eq('status', 'decided');
  if (!polls || polls.length === 0) return {};

  const { data: trip } = await supabase
    .from('trips')
    .select('start_date, end_date')
    .eq('id', tripId)
    .maybeSingle();

  const result: Record<string, { aligned: number; total: number }> = {};
  type PollRow = {
    id: string;
    type: string;
    decided_option_id: string | null;
    poll_options: { id: string; label: string }[] | null;
  };

  for (const p of polls as PollRow[]) {
    const decidedSet = new Set<string>();
    if (p.type === 'dates' && trip?.start_date) {
      const startMs = new Date(trip.start_date + 'T00:00:00').getTime();
      const endMs = new Date((trip.end_date ?? trip.start_date) + 'T23:59:59').getTime();
      for (const o of p.poll_options ?? []) {
        const r = parseDateRangeLabel(o.label);
        if (!r) continue;
        const t = r.start.getTime();
        if (t >= startMs && t <= endMs) decidedSet.add(o.id);
      }
    } else if (p.decided_option_id) {
      decidedSet.add(p.decided_option_id);
    }
    if (decidedSet.size === 0) continue;

    const { data: votes } = await supabase
      .from('poll_responses')
      .select('respondent_id, option_id')
      .eq('poll_id', p.id);
    const byRespondent = new Map<string, Set<string>>();
    for (const v of (votes ?? []) as { respondent_id: string; option_id: string | null }[]) {
      if (!byRespondent.has(v.respondent_id)) byRespondent.set(v.respondent_id, new Set());
      if (v.option_id) byRespondent.get(v.respondent_id)!.add(v.option_id);
    }

    let aligned = 0;
    for (const [, voteSet] of byRespondent) {
      let allIn = true;
      for (const dop of decidedSet) {
        if (!voteSet.has(dop)) { allIn = false; break; }
      }
      if (allIn) aligned++;
    }
    result[p.id] = { aligned, total: byRespondent.size };
  }

  return result;
}

/**
 * Set of respondent_ids that have submitted at least one poll response for
 * this trip. Used by the planner roster to mark a member's "Polls" pill as
 * done even when they haven't touched the legacy rsvp/preferences fields.
 */
export async function getRespondedRespondentIds(
  tripId: string
): Promise<Set<string>> {
  const { data: polls, error: pollErr } = await supabase
    .from('polls')
    .select('id')
    .eq('trip_id', tripId);
  if (pollErr) throw pollErr;
  if (!polls || polls.length === 0) return new Set();

  const pollIds = polls.map((p) => p.id);
  const { data: rows, error } = await supabase
    .from('poll_responses')
    .select('respondent_id')
    .in('poll_id', pollIds);
  if (error) throw error;

  const ids = new Set<string>();
  for (const row of rows ?? []) {
    if (row.respondent_id) ids.add(row.respondent_id);
  }
  return ids;
}
