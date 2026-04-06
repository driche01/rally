/**
 * Component 2: PhoneUserLinker
 *
 * Maps phone numbers to Rally users. Creates lightweight records for
 * unknown phones. Returns user_id for downstream use.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface SmsUser {
  id: string;
  phone: string;
  display_name: string | null;
  rally_account: boolean;
  trip_count: number;
  opted_out: boolean;
  returning: boolean;
}

/**
 * Find or create a user by phone number.
 * Returns the user record with a `returning` flag.
 */
export async function findOrCreateUser(
  admin: SupabaseClient,
  phone: string,
): Promise<SmsUser> {
  // Look up existing user by phone
  const { data: existing } = await admin
    .from('users')
    .select('id, phone, display_name, rally_account, trip_count, opted_out')
    .eq('phone', phone)
    .maybeSingle();

  if (existing) {
    return {
      ...existing,
      returning: existing.trip_count > 0,
    };
  }

  // Create lightweight record
  const { data: created, error } = await admin
    .from('users')
    .insert({
      phone,
      display_name: null,
      rally_account: false,
      trip_count: 0,
      opted_out: false,
    })
    .select('id, phone, display_name, rally_account, trip_count, opted_out')
    .single();

  if (error) throw new Error(`Failed to create user for ${phone}: ${error.message}`);

  return {
    ...created!,
    returning: false,
  };
}

/**
 * Ensure a respondent row exists for this user on this trip.
 * Uses existing dedup logic: matches by (trip_id, phone) before creating.
 */
export async function ensureRespondent(
  admin: SupabaseClient,
  tripId: string,
  user: SmsUser,
): Promise<string> {
  // Check for existing respondent by phone on this trip
  const { data: existing } = await admin
    .from('respondents')
    .select('id')
    .eq('trip_id', tripId)
    .eq('phone', user.phone)
    .maybeSingle();

  if (existing) {
    // Link user_id if not yet set
    await admin
      .from('respondents')
      .update({ user_id: user.id })
      .eq('id', existing.id)
      .is('user_id', null);
    return existing.id;
  }

  // Create new respondent linked to both the trip and the user
  const { data: created, error } = await admin
    .from('respondents')
    .insert({
      trip_id: tripId,
      name: user.display_name ?? user.phone,
      phone: user.phone,
      user_id: user.id,
      is_planner: false,
      session_token: crypto.randomUUID(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create respondent: ${error.message}`);
  return created!.id;
}
