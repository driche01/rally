import { Platform } from 'react-native';
import { supabase } from '../supabase';
import { normalizePhone } from '../phone';
import type { PollResponse, Respondent } from '../../types/database';

// ─── Global session token (legacy / backward compat) ──────────────────────────
// Originally one token per device used across all trips.
const SESSION_KEY = 'rally_session_token';

function generateToken(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

async function getGlobalSessionToken(): Promise<string> {
  if (Platform.OS === 'web') {
    let token = localStorage.getItem(SESSION_KEY);
    if (!token) {
      token = generateToken();
      localStorage.setItem(SESSION_KEY, token);
    }
    return token;
  }
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  let token = await AsyncStorage.getItem(SESSION_KEY);
  if (!token) {
    token = generateToken();
    await AsyncStorage.setItem(SESSION_KEY, token);
  }
  return token;
}

// ─── Per-trip session token ────────────────────────────────────────────────────
// Each trip stores its own session token so multiple people can respond from
// the same device (e.g. passing a phone around). Clearing a trip's token
// allows a new person to respond independently.
const TRIP_SESSION_PREFIX = 'rally_trip_session_';

async function getTripSessionToken(tripId: string): Promise<string | null> {
  const key = `${TRIP_SESSION_PREFIX}${tripId}`;
  if (Platform.OS === 'web') return localStorage.getItem(key);
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  return AsyncStorage.getItem(key);
}

async function setTripSessionToken(tripId: string, token: string): Promise<void> {
  const key = `${TRIP_SESSION_PREFIX}${tripId}`;
  if (Platform.OS === 'web') { localStorage.setItem(key, token); return; }
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem(key, token);
}

/** Clear the stored session for a trip so the next name entry creates a new respondent. */
export async function clearTripSession(tripId: string): Promise<void> {
  const key = `${TRIP_SESSION_PREFIX}${tripId}`;
  if (Platform.OS === 'web') { localStorage.removeItem(key); return; }
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.removeItem(key);
}

// ─── Respondent lookup/creation ────────────────────────────────────────────────

/**
 * Read-only: returns the existing respondent for this device+trip if one exists.
 * Does NOT create a new row — safe to call during screen load.
 */
export async function getExistingRespondentForTrip(tripId: string): Promise<Respondent | null> {
  // 1. Prefer per-trip token (new approach)
  const tripToken = await getTripSessionToken(tripId);
  if (tripToken) {
    const { data } = await supabase
      .from('respondents')
      .select('*')
      .eq('trip_id', tripId)
      .eq('session_token', tripToken)
      .single();
    if (data) return data;
  }

  // 2. Fall back to global session token (backward compat for existing users)
  const globalToken = await getGlobalSessionToken();
  const { data } = await supabase
    .from('respondents')
    .select('*')
    .eq('trip_id', tripId)
    .eq('session_token', globalToken)
    .single();
  return data ?? null;
}

/**
 * Find or create a respondent for this trip using per-trip session storage.
 *
 * Deduplication order:
 *   1. Per-trip session token   — same device/browser returning
 *   2. Email or phone match     — same person on a different device / fresh browser
 *   3. Legacy global token      — backward compat for pre-per-trip-token users
 *   4. Create new               — genuinely new respondent
 *
 * When a contact-based match is found the existing row is updated with the
 * latest name/email/phone and this device adopts that row's session token,
 * so the person is never double-counted.
 */
export async function getOrCreateRespondent(
  tripId: string,
  name: string,
  email?: string | null,
  phone?: string | null,
): Promise<Respondent> {
  const trimmedEmail = email?.trim() || null;
  // Normalize phone to E.164 so dedup across SMS/survey/app keys on the same
  // canonical string. Falls back to trimmed raw if un-normalizable — the value
  // still persists and the phone-level validation on the caller rejects the
  // malformed case before we get here.
  const trimmedPhone = phone?.trim() || null;
  const normalizedPhone = trimmedPhone ? normalizePhone(trimmedPhone) : null;
  const storedPhone = normalizedPhone ?? trimmedPhone;
  const contactPatch = {
    ...(trimmedEmail != null ? { email: trimmedEmail } : {}),
    ...(storedPhone != null ? { phone: storedPhone } : {}),
  };

  // Helper: update a matched row with the latest details and adopt its token
  async function adoptExisting(existing: Respondent): Promise<Respondent> {
    await setTripSessionToken(tripId, existing.session_token);
    const patch = {
      ...(existing.name !== name ? { name } : {}),
      ...contactPatch,
    };
    if (Object.keys(patch).length > 0) {
      await supabase.from('respondents').update(patch).eq('id', existing.id);
    }
    return { ...existing, name, ...contactPatch };
  }

  // 1. Per-trip session token — same device returning
  const tripToken = await getTripSessionToken(tripId);
  if (tripToken) {
    const { data: existing } = await supabase
      .from('respondents')
      .select('*')
      .eq('trip_id', tripId)
      .eq('session_token', tripToken)
      .maybeSingle();
    if (existing) {
      // Phase 2: backfill `users` link for returning respondents who now
      // (or already) have a phone. Token-match path bypasses the RPC for
      // adoption logic but still routes through it for the user link.
      if (normalizedPhone) {
        await supabase.rpc('ensure_respondent_user', {
          p_trip_id: tripId,
          p_phone: normalizedPhone,
          p_name: name,
          p_email: trimmedEmail,
          p_session_token: existing.session_token,
          p_existing_respondent_id: existing.id,
        });
      }
      return adoptExisting(existing);
    }
    // Token present but row gone — fall through
  }

  // 2. Contact-based deduplication — same person, different device/browser.
  // Match on the normalized phone so legacy rows stored in different formats
  // still coalesce (legacy raw-format rows will miss; that's acceptable —
  // once they update via `adoptExisting` we persist the normalized value).
  if (trimmedEmail || storedPhone) {
    const orParts: string[] = [];
    if (trimmedEmail) orParts.push(`email.eq.${trimmedEmail}`);
    if (storedPhone) orParts.push(`phone.eq.${storedPhone}`);

    const { data: contactMatch } = await supabase
      .from('respondents')
      .select('*')
      .eq('trip_id', tripId)
      .or(orParts.join(','))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (contactMatch) return adoptExisting(contactMatch);
  }

  // 3. Backward compat: legacy global token
  if (!tripToken) {
    const globalToken = await getGlobalSessionToken();
    const { data: existing } = await supabase
      .from('respondents')
      .select('*')
      .eq('trip_id', tripId)
      .eq('session_token', globalToken)
      .maybeSingle();

    if (existing) return adoptExisting(existing);
  }

  // 4. Genuinely new respondent.
  //
  // Phase 2: when a phone is supplied, route through the
  // `ensure_respondent_user` RPC. It runs SECURITY DEFINER so it can
  // create/link a `users` row for the phone identity (which anon users
  // can't touch directly under RLS) — this makes survey-only respondents
  // discoverable by the future Phase 3 claim flow.
  const newToken = generateToken();
  await setTripSessionToken(tripId, newToken);

  if (normalizedPhone) {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('ensure_respondent_user', {
      p_trip_id: tripId,
      p_phone: normalizedPhone,
      p_name: name,
      p_email: trimmedEmail,
      p_session_token: newToken,
    });
    if (rpcError) throw rpcError;
    const result = rpcResult as { respondent_id: string; session_token: string; user_id: string };
    // RPC may have adopted an existing (trip_id, phone) row — adopt its
    // session_token client-side so subsequent visits dedupe.
    if (result.session_token && result.session_token !== newToken) {
      await setTripSessionToken(tripId, result.session_token);
    }
    return {
      id:            result.respondent_id,
      trip_id:       tripId,
      name,
      session_token: result.session_token ?? newToken,
      email:         trimmedEmail ?? null,
      phone:         normalizedPhone,
      is_planner:    false,
      rsvp:          null,
      preferences:   null,
      created_at:    new Date().toISOString(),
    };
  }

  // No phone — keep the legacy client-side insert path. (We can't link
  // a `users` row without a phone identity, so the RPC has nothing to
  // do anyway.) Generate the ID client-side so we can skip INSERT...
  // RETURNING SELECT — respondents SELECT RLS only allows planners to
  // read rows, so anon users would get PGRST116 on the RETURNING clause.
  const newId: string = crypto.randomUUID();
  const { error } = await supabase
    .from('respondents')
    .insert({ id: newId, trip_id: tripId, name, session_token: newToken, ...contactPatch });
  if (error) throw error;

  return {
    id: newId,
    trip_id: tripId,
    name,
    session_token: newToken,
    email: trimmedEmail ?? null,
    phone: storedPhone ?? null,
    is_planner: false,
    rsvp: null,
    preferences: null,
    created_at: new Date().toISOString(),
  };
}

export async function getRespondentForTrip(): Promise<{
  sessionToken: string;
  respondentId?: string;
} | null> {
  try {
    const sessionToken = await getGlobalSessionToken();
    return { sessionToken };
  } catch {
    return null;
  }
}

export async function getRespondentsForTrip(tripId: string): Promise<Respondent[]> {
  const { data, error } = await supabase
    .from('respondents')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createRespondentManually(
  tripId: string,
  name: string,
  email: string,
  phone: string
): Promise<Respondent> {
  // Generate a unique session token so the not-null constraint is satisfied
  const sessionToken = `manual_${Math.random().toString(36).substring(2)}${Date.now().toString(36)}`;
  const { data, error } = await supabase
    .from('respondents')
    .insert({
      trip_id: tripId,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      session_token: sessionToken,
      rsvp: 'in',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRespondent(respondentId: string): Promise<void> {
  const { error } = await supabase
    .from('respondents')
    .delete()
    .eq('id', respondentId);
  if (error) throw error;
}

// ─── Poll responses ────────────────────────────────────────────────────────────

export async function submitPollResponses(
  pollId: string,
  respondentId: string,
  optionIds: string[]
): Promise<void> {
  // Clear existing responses for this poll + respondent
  await supabase
    .from('poll_responses')
    .delete()
    .eq('poll_id', pollId)
    .eq('respondent_id', respondentId);

  if (optionIds.length === 0) return;

  const { error } = await supabase.from('poll_responses').insert(
    optionIds.map((option_id) => ({ poll_id: pollId, respondent_id: respondentId, option_id }))
  );
  if (error) throw error;
}

export async function getResponsesForPoll(pollId: string): Promise<PollResponse[]> {
  const { data, error } = await supabase
    .from('poll_responses')
    .select('*')
    .eq('poll_id', pollId);
  if (error) throw error;
  return data ?? [];
}

export async function getExistingResponses(
  tripId: string,
  respondentId: string
): Promise<Record<string, string[]>> {
  const { data, error } = await supabase
    .from('poll_responses')
    .select('poll_id, option_id')
    .eq('respondent_id', respondentId);
  if (error) throw error;

  const map: Record<string, string[]> = {};
  for (const row of data ?? []) {
    if (!map[row.poll_id]) map[row.poll_id] = [];
    map[row.poll_id].push(row.option_id);
  }
  return map;
}

// ─── RSVP + preferences ────────────────────────────────────────────────────────

export async function saveRespondentRsvpAndPreferences(
  respondentId: string,
  rsvp: 'in' | 'out',
  preferences?: { needs: string[]; energy: 'relaxing' | 'adventurous' | null; vibes: string[]; pace: string | null }
): Promise<void> {
  const { error } = await supabase
    .from('respondents')
    .update({ rsvp, preferences: preferences ?? null })
    .eq('id', respondentId);
  if (error) throw error;
}

// ─── Planner designation ──────────────────────────────────────────────────────

/**
 * Promote or demote a respondent to/from planner status.
 * Only the trip owner (authenticated) can call this.
 */
export async function setRespondentPlanner(
  respondentId: string,
  isPlanner: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('respondents')
    .update({ is_planner: isPlanner })
    .eq('id', respondentId);
  if (error) throw error;
}
