import { supabase } from '../supabase';
import type { Poll, PollOption, PollStatus, PollType, PollWithOptions, PollWithResults } from '../../types/database';

export interface CreatePollInput {
  trip_id: string;
  type: PollType;
  title: string;
  status?: 'draft' | 'live';
  allow_multi_select?: boolean;
  position?: number;
  options: { label: string; position: number }[];
}

export async function createPoll(input: CreatePollInput): Promise<PollWithOptions> {
  const { options, status = 'draft', ...pollData } = input;

  const { data: poll, error: pollError } = await supabase
    .from('polls')
    .insert({ ...pollData, status })
    .select()
    .single();
  if (pollError) throw pollError;

  const { data: optionRows, error: optError } = await supabase
    .from('poll_options')
    .insert(options.map((o) => ({ ...o, poll_id: poll.id })))
    .select();
  if (optError) throw optError;

  return { ...poll, poll_options: optionRows ?? [] };
}

export async function getPollsForTrip(tripId: string): Promise<PollWithOptions[]> {
  const { data, error } = await supabase
    .from('polls')
    .select('*, poll_options!poll_options_poll_id_fkey(*)')
    .eq('trip_id', tripId)
    .order('position', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((p) => ({
    ...p,
    poll_options: (p.poll_options ?? []).sort(
      (a: PollOption, b: PollOption) => a.position - b.position
    ),
  }));
}

export async function getPollWithResults(pollId: string): Promise<PollWithResults> {
  const { data, error } = await supabase
    .from('polls')
    .select(`
      *,
      poll_options!poll_options_poll_id_fkey (*),
      poll_responses (
        *,
        respondents (name)
      )
    `)
    .eq('id', pollId)
    .single();
  if (error) throw error;
  return data;
}

export async function updatePoll(
  pollId: string,
  updates: Partial<Pick<Poll, 'title' | 'allow_multi_select' | 'status' | 'decided_option_id' | 'position'>>
): Promise<void> {
  const { error } = await supabase.from('polls').update(updates).eq('id', pollId);
  if (error) throw error;
}

export async function updatePollStatus(pollId: string, status: PollStatus): Promise<void> {
  await updatePoll(pollId, { status });
}

export async function decidePoll(pollId: string, optionId: string): Promise<void> {
  await updatePoll(pollId, { status: 'decided', decided_option_id: optionId });
}

export async function undecidePoll(pollId: string): Promise<void> {
  await updatePoll(pollId, { status: 'live', decided_option_id: null });
}

export async function updatePollOptions(
  pollId: string,
  options: { id?: string; label: string; position: number }[]
): Promise<PollOption[]> {
  // Delete existing options and re-insert
  await supabase.from('poll_options').delete().eq('poll_id', pollId);
  const { data, error } = await supabase
    .from('poll_options')
    .insert(options.map((o) => ({ poll_id: pollId, label: o.label, position: o.position })))
    .select();
  if (error) throw error;
  return data ?? [];
}

export async function deletePoll(pollId: string): Promise<void> {
  const { error } = await supabase.from('polls').delete().eq('id', pollId);
  if (error) throw error;
}

export async function duplicatePoll(pollId: string): Promise<PollWithOptions> {
  // Fetch the original poll with its options
  const { data: original, error: fetchError } = await supabase
    .from('polls')
    .select('*, poll_options!poll_options_poll_id_fkey(*)')
    .eq('id', pollId)
    .single();
  if (fetchError) throw fetchError;

  // Insert new poll as draft (reset status, decided_option_id)
  const { data: newPoll, error: pollError } = await supabase
    .from('polls')
    .insert({
      trip_id: original.trip_id,
      type: original.type,
      title: original.title,
      allow_multi_select: original.allow_multi_select,
      position: original.position,
      status: 'draft',
    })
    .select()
    .single();
  if (pollError) throw pollError;

  // Insert a copy of each option
  const optionRows = (original.poll_options ?? []).map((o: { label: string; position: number }) => ({
    poll_id: newPoll.id,
    label: o.label,
    position: o.position,
  }));
  const { data: newOptions, error: optError } = await supabase
    .from('poll_options')
    .insert(optionRows)
    .select();
  if (optError) throw optError;

  return { ...newPoll, poll_options: newOptions ?? [] };
}
