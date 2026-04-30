import { supabase } from '../supabase';

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
