import { supabase } from '../supabase';
import type { Poll, PollOption, PollStatus, PollType, PollWithOptions, PollWithResults } from '../../types/database';
import { parseDateRangeLabel } from '../pollFormUtils';

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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Decide + sync trip fields ────────────────────────────────────────────────

/**
 * Marks a poll as decided and auto-fills the corresponding trip fields:
 *   dates  → trip.start_date + trip.end_date
 *   budget → trip.budget_per_person
 *   destination / custom → no trip field; displayed from poll directly
 */
export async function decidePollAndSync(pollId: string, optionId: string): Promise<void> {
  // Fetch the poll type, trip ID, and all options in one round-trip
  const { data: poll, error } = await supabase
    .from('polls')
    .select('type, trip_id, poll_options!poll_options_poll_id_fkey(id, label)')
    .eq('id', pollId)
    .single();
  if (error) throw error;

  // Decide the poll
  await updatePoll(pollId, { status: 'decided', decided_option_id: optionId });

  // Find the winning label
  const winningLabel = (poll.poll_options as { id: string; label: string }[])
    .find((o) => o.id === optionId)?.label;
  if (!winningLabel) return;

  if (poll.type === 'dates') {
    const range = parseDateRangeLabel(winningLabel);
    if (range) {
      await supabase
        .from('trips')
        .update({ start_date: toISODate(range.start), end_date: toISODate(range.end) })
        .eq('id', poll.trip_id);
    }
  } else if (poll.type === 'budget') {
    await supabase
      .from('trips')
      .update({ budget_per_person: winningLabel })
      .eq('id', poll.trip_id);
  } else if (poll.type === 'destination') {
    // Only write to trip.destination if planner hasn't already set one manually
    const { data: trip } = await supabase
      .from('trips')
      .select('destination')
      .eq('id', poll.trip_id)
      .single();
    if (!trip?.destination) {
      await supabase
        .from('trips')
        .update({ destination: winningLabel })
        .eq('id', poll.trip_id);
    }
  }
  // 'custom' — no trip field
}

/**
 * Reverts a poll to live and clears the trip fields that were auto-filled
 * when it was decided.
 */
export async function undecidePollAndClear(pollId: string): Promise<void> {
  // Fetch type + trip_id before undeciding
  const { data: poll, error } = await supabase
    .from('polls')
    .select('type, trip_id')
    .eq('id', pollId)
    .single();
  if (error) throw error;

  // Revert the poll
  await updatePoll(pollId, { status: 'live', decided_option_id: null });

  // Clear the corresponding trip fields
  if (poll.type === 'dates') {
    await supabase
      .from('trips')
      .update({ start_date: null, end_date: null })
      .eq('id', poll.trip_id);
  } else if (poll.type === 'budget') {
    await supabase
      .from('trips')
      .update({ budget_per_person: null })
      .eq('id', poll.trip_id);
  }
}

// ─── Sync trip fields → decided polls ────────────────────────────────────────

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function isoRangeToLabel(start: string, end: string | null): string {
  const s = new Date(start + 'T12:00:00');
  const sm = MONTH_ABBR[s.getMonth()];
  const sd = s.getDate();
  if (!end) return `${sm} ${sd}`;
  const e = new Date(end + 'T12:00:00');
  const em = MONTH_ABBR[e.getMonth()];
  const ed = e.getDate();
  return sm === em ? `${sm} ${sd}–${ed}` : `${sm} ${sd} – ${em} ${ed}`;
}

/**
 * For any of destination / dates / budget that are set on the trip and do NOT
 * already have a poll of that type, creates a decided poll so the decision
 * shows up in the polls list automatically.
 *
 * Idempotent: if a poll of that type already exists (regardless of status),
 * it is left untouched to avoid overriding an active group vote.
 */
export async function syncTripFieldsToPolls(
  tripId: string,
  fields: {
    destination?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    budget_per_person?: string | null;
  },
): Promise<void> {
  const { data: existing } = await supabase
    .from('polls')
    .select('type')
    .eq('trip_id', tripId);

  const existingTypes = new Set((existing ?? []).map((p: { type: string }) => p.type));
  const existingCount = existing?.length ?? 0;

  async function createDecidedPoll(
    type: PollType,
    title: string,
    optionLabel: string,
    positionOffset: number,
  ): Promise<void> {
    const { data: poll, error: pollErr } = await supabase
      .from('polls')
      .insert({
        trip_id: tripId,
        type,
        title,
        status: 'decided',
        allow_multi_select: false,
        position: existingCount + positionOffset,
      })
      .select()
      .single();
    if (pollErr) throw pollErr;

    const { data: option, error: optErr } = await supabase
      .from('poll_options')
      .insert({ poll_id: poll.id, label: optionLabel, position: 0 })
      .select()
      .single();
    if (optErr) throw optErr;

    await supabase
      .from('polls')
      .update({ decided_option_id: option.id })
      .eq('id', poll.id);
  }

  const tasks: Promise<void>[] = [];
  let offset = 0;

  if (fields.destination && !existingTypes.has('destination')) {
    tasks.push(createDecidedPoll('destination', 'Where are we going?', fields.destination, offset++));
  }
  if (fields.start_date && !existingTypes.has('dates')) {
    const label = isoRangeToLabel(fields.start_date, fields.end_date ?? null);
    tasks.push(createDecidedPoll('dates', 'When are we going?', label, offset++));
  }
  if (fields.budget_per_person && !existingTypes.has('budget')) {
    tasks.push(createDecidedPoll('budget', "What's our budget?", fields.budget_per_person, offset++));
  }

  await Promise.all(tasks);
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
