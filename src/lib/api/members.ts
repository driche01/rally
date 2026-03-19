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

/** Get the member count for a trip. */
export async function getTripMemberCount(tripId: string): Promise<number> {
  const { count, error } = await supabase
    .from('trip_members')
    .select('*', { count: 'exact', head: true })
    .eq('trip_id', tripId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Called after a group member submits their first poll response.
 * 1. Creates a Supabase auth account for them (silently — they'll get a
 *    confirmation email if email-confirm is enabled in the project).
 * 2. Calls the enroll_respondent_as_member RPC to update their profile and
 *    add them to trip_members with the 'member' role.
 */
export async function enrollRespondentAsMember(
  tripId: string,
  email: string,
  firstName: string,
  lastName: string,
  phone: string,
): Promise<void> {
  // Generate a random password — the user will set their own via "forgot password"
  const password =
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36);

  // signUp is idempotent-ish: if the email already exists Supabase handles it
  // gracefully (sends a "already registered" email rather than erroring out).
  await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: { name: firstName.trim(), last_name: lastName.trim() },
    },
  });

  // Update profile + insert trip_members via SECURITY DEFINER function
  const { error } = await supabase.rpc('enroll_respondent_as_member', {
    p_trip_id: tripId,
    p_email: email.trim().toLowerCase(),
    p_first_name: firstName.trim(),
    p_last_name: lastName.trim(),
    p_phone: phone.trim(),
  });
  if (error) throw error;
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
