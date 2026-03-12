import { supabase } from '../supabase';

/**
 * Returns vote counts per option, grouped by poll.
 * Shape: { [pollId]: { [optionId]: count } }
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

  // Fetch all responses for those polls in one query
  const { data: responses, error } = await supabase
    .from('poll_responses')
    .select('poll_id, option_id')
    .in('poll_id', pollIds);
  if (error) throw error;

  const counts: Record<string, Record<string, number>> = {};
  for (const row of responses ?? []) {
    if (!counts[row.poll_id]) counts[row.poll_id] = {};
    counts[row.poll_id][row.option_id] = (counts[row.poll_id][row.option_id] ?? 0) + 1;
  }
  return counts;
}
