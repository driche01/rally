import { supabase } from '../supabase';
import type { TravelLeg, TravelLegWithRespondent, TransportMode } from '../../types/database';

export type { TravelLeg, TravelLegWithRespondent, TransportMode };

export interface CreateTravelLegInput {
  trip_id: string;
  respondent_id?: string | null;
  mode: TransportMode;
  label: string;
  departure_date?: string | null;
  departure_time?: string | null;
  arrival_date?: string | null;
  arrival_time?: string | null;
  booking_ref?: string | null;
  notes?: string | null;
  shared_with_group?: boolean;
}

export async function getTravelLegsForTrip(tripId: string): Promise<TravelLeg[]> {
  const { data, error } = await supabase
    .from('trip_travel_legs')
    .select('*')
    .eq('trip_id', tripId)
    .is('respondent_id', null)   // planner's own legs
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getSharedMemberLegs(tripId: string): Promise<TravelLegWithRespondent[]> {
  const { data, error } = await supabase
    .from('trip_travel_legs')
    .select('*, respondents!trip_travel_legs_respondent_id_fkey(name)')
    .eq('trip_id', tripId)
    .eq('shared_with_group', true)
    .not('respondent_id', 'is', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: TravelLeg & { respondents?: { name: string } | null }) => ({
    ...row,
    respondent_name: (row.respondents as { name: string } | null)?.name ?? 'Member',
    respondents: undefined,
  }));
}

export async function createTravelLeg(input: CreateTravelLegInput): Promise<TravelLeg> {
  const { data, error } = await supabase
    .from('trip_travel_legs')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTravelLeg(
  id: string,
  updates: Partial<Omit<TravelLeg, 'id' | 'trip_id' | 'respondent_id' | 'created_at'>>,
): Promise<void> {
  const { error } = await supabase.from('trip_travel_legs').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteTravelLeg(id: string): Promise<void> {
  const { error } = await supabase.from('trip_travel_legs').delete().eq('id', id);
  if (error) throw error;
}
