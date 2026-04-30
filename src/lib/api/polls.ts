import { supabase } from '../supabase';
import type { PollOption, PollType, PollWithOptions } from '../../types/database';

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
    tasks.push(createDecidedPoll('destination', 'Where do you want to go?', fields.destination, offset++));
  }
  if (fields.start_date && !existingTypes.has('dates')) {
    const label = isoRangeToLabel(fields.start_date, fields.end_date ?? null);
    tasks.push(createDecidedPoll('dates', 'When are you free?', label, offset++));
  }
  if (fields.budget_per_person && !existingTypes.has('budget')) {
    tasks.push(createDecidedPoll('budget', "What's your budget? (travel + lodging only)", fields.budget_per_person, offset++));
  }

  await Promise.all(tasks);
}
