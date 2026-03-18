import { supabase } from '../supabase';
import type { GroupSizeBucket, Trip, TripWithPolls } from '../../types/database';
import { addPlannerMember } from './members';

export interface TripWithRespondentCount extends Trip {
  respondentCount: number;
  memberCount: number;
}

export interface CreateTripInput {
  name: string;
  group_size_bucket: GroupSizeBucket;
  /** Exact head-count; null clears a previously-stored value. */
  group_size_precise?: number | null;
  travel_window?: string;
  start_date?: string | null;
  end_date?: string | null;
  trip_type?: string | null;
  budget_per_person?: string | null;
  destination?: string | null;
  destination_address?: string | null;
}

export async function createTrip(input: CreateTripInput): Promise<Trip> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('trips')
    .insert({ ...input, created_by: user.id })
    .select()
    .single();
  if (error) throw error;

  // Auto-enroll the creator as the planner member
  await addPlannerMember(data.id, user.id);

  return data;
}

export async function getTrips(): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getTripsWithRespondentCounts(): Promise<TripWithRespondentCount[]> {
  // Supabase PostgREST returns embedded relations as { count: number } when only
  // the aggregate alias is selected.
  const { data, error } = await supabase
    .from('trips')
    .select('*, respondents(count), trip_members(count)')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw error;

  type CountShape = { count: number } | { count: number }[] | null;
  function extractCount(raw: CountShape): number {
    return Array.isArray(raw) ? (raw[0]?.count ?? 0) : (raw?.count ?? 0);
  }

  type TripRow = Trip & { respondents: CountShape; trip_members: CountShape };
  return (data ?? []).map((row: TripRow) => {
    const respondentCount = extractCount(row.respondents);
    const memberCount = extractCount(row.trip_members);
    const { respondents: _r, trip_members: _m, ...tripData } = row;
    return { ...tripData, respondentCount, memberCount } satisfies TripWithRespondentCount;
  });
}

export async function getTripById(id: string): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function getTripByShareToken(token: string): Promise<TripWithPolls> {
  const { data, error } = await supabase
    .from('trips')
    .select(`
      *,
      polls (
        *,
        poll_options!poll_options_poll_id_fkey (*)
      )
    `)
    .eq('share_token', token)
    .eq('status', 'active')
    .in('polls.status', ['live'])
    .single();
  if (error) throw error;
  // Sort polls and options by position
  data.polls = (data.polls ?? []).sort((a: { position: number }, b: { position: number }) => a.position - b.position);
  data.polls.forEach((p: { poll_options: { position: number }[] }) => {
    p.poll_options.sort((a, b) => a.position - b.position);
  });
  return data;
}

export async function updateTrip(id: string, input: Partial<CreateTripInput>): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTripStatus(id: string, status: Trip['status']): Promise<void> {
  const { error } = await supabase.from('trips').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase.from('trips').delete().eq('id', id);
  if (error) throw error;
}

export function getShareUrl(shareToken: string): string {
  const base = process.env.EXPO_PUBLIC_APP_URL ?? 'https://rallyapp.io';
  return `${base}/respond/${shareToken}`;
}
