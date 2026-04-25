import { supabase } from '../supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Add an email to the closed-beta waitlist.
 * Idempotent — duplicate emails are silently ignored (unique index on
 * lower(email)). Returns `true` if it was likely a new signup, `false`
 * if it was a duplicate. We don't fail the UX on duplicates: from the
 * user's perspective "I'm on the list" is the desired outcome either way.
 *
 * `tripId` is optional and only persisted if it's a valid UUID — that
 * keeps the signup succeeding even if the incoming query string is
 * malformed (e.g. a preview/demo link).
 */
export async function joinBetaList(opts: {
  email: string;
  source?: string;
  tripId?: string | null;
}): Promise<boolean> {
  const trimmed = opts.email.trim().toLowerCase();
  const tripId = opts.tripId && UUID_RE.test(opts.tripId) ? opts.tripId : null;
  const { error } = await supabase.from('beta_signups').insert({
    email: trimmed,
    source: opts.source ?? null,
    trip_id: tripId,
  });
  if (!error) return true;
  // 23505 = unique_violation — already on the list
  if ((error as unknown as { code?: string }).code === '23505') return false;
  throw error;
}
