import { supabase } from '../supabase';
import type { TripMember, TripMemberWithProfile } from '../../types/database';

/** Add the current authenticated user to a trip as a member. */
export async function joinTrip(tripId: string): Promise<TripMember> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('trip_members')
    .insert({ trip_id: tripId, user_id: user.id, role: 'member' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Add a user as planner — called internally when creating a trip. */
export async function addPlannerMember(tripId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('trip_members')
    .insert({ trip_id: tripId, user_id: userId, role: 'planner' });
  if (error) throw error;
}

/** Get the current user's membership record for a trip, or null if not joined. */
export async function getMembershipStatus(tripId: string): Promise<TripMember | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('trip_members')
    .select('*')
    .eq('trip_id', tripId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Get all members of a trip with their profile info. */
export async function getTripMembers(tripId: string): Promise<TripMemberWithProfile[]> {
  const { data, error } = await supabase
    .from('trip_members')
    .select('*, profiles(name, email)')
    .eq('trip_id', tripId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TripMemberWithProfile[];
}

/** Remove the current user from a trip. */
export async function leaveTrip(tripId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('trip_members')
    .delete()
    .eq('trip_id', tripId)
    .eq('user_id', user.id);
  if (error) throw error;
}
