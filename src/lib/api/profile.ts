import { supabase } from '../supabase';
import type { Profile } from '../../types/database';

/** Fetch any profile by user ID (requires the caller to be a trip member of that user's trip). */
export async function getProfileById(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  return data ?? null;
}

/** Fetch the currently authenticated user's own profile. */
export async function getMyProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  return data ?? null;
}
