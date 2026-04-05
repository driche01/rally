/**
 * Component 11: TripWebView — token generation and validation
 *
 * Generates short-lived access tokens for the trip web view.
 * The actual web UI is served by the Expo web app at /trip/[id].
 * This module handles the auth layer.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Generate a fresh access token for a participant to view a trip.
 * Token expires in 7 days.
 */
export async function generateTripAccessToken(
  admin: SupabaseClient,
  tripSessionId: string,
  userId: string,
): Promise<string> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('trip_access_tokens')
    .insert({
      trip_session_id: tripSessionId,
      user_id: userId,
      expires_at: expiresAt,
    })
    .select('token')
    .single();

  if (error) throw new Error(`Failed to generate access token: ${error.message}`);
  return data!.token;
}

/**
 * Validate a trip access token.
 * Returns the associated trip_session_id and user_id, or null if invalid/expired.
 */
export async function validateTripAccessToken(
  admin: SupabaseClient,
  token: string,
): Promise<{ tripSessionId: string; userId: string } | null> {
  const { data } = await admin
    .from('trip_access_tokens')
    .select('trip_session_id, user_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();

  if (!data) return null;

  // Check expiry
  if (new Date(data.expires_at) < new Date()) return null;

  // Mark as used on first access
  if (!data.used_at) {
    await admin
      .from('trip_access_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token);
  }

  return {
    tripSessionId: data.trip_session_id,
    userId: data.user_id,
  };
}

/**
 * Build the trip web view URL for a participant.
 */
export function buildTripUrl(
  baseUrl: string,
  tripSessionId: string,
  token: string,
): string {
  return `${baseUrl}/trip/${tripSessionId}?token=${token}`;
}
