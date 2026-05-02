import { Platform } from 'react-native';
import { supabase } from '../supabase';
import { normalizePhone } from '../phone';
import type { PollResponse, Respondent } from '../../types/database';

// ─── Survey confirmation SMS ──────────────────────────────────────────────────

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SURVEY_CONFIRMATION_URL = `${SUPABASE_URL}/functions/v1/sms-survey-confirmation`;

/**
 * Fire the post-submit confirmation SMS. Best-effort, never throws — the
 * survey submit succeeds even if the SMS fails. Server-side guards
 * dedupe (per trip+phone+day) and skip opted-out users.
 */
export async function sendSurveyConfirmationSms(
  tripId: string,
  phone: string | null,
  rsvp: 'in' | 'out',
): Promise<void> {
  if (!phone) return;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    await fetch(SURVEY_CONFIRMATION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ trip_id: tripId, phone, rsvp }),
    });
  } catch {
    /* non-fatal — confirmation is informational */
  }
}

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

/**
 * Compact respondent list joined with each member's `home_airport` from
 * `traveler_profiles`. Used by the per-member travel suggestions section so
 * the planner can see at a glance who has an airport saved (eligible for
 * "Suggest route") and who hasn't filled in their profile yet.
 */
export interface RespondentWithTravelInfo {
  id: string;
  name: string;
  phone: string | null;
  home_airport: string | null;
}

export async function getRespondentsWithTravelInfo(
  tripId: string,
): Promise<RespondentWithTravelInfo[]> {
  const { data: respondents, error } = await supabase
    .from('respondents')
    .select('id, name, phone')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const phones = (respondents ?? [])
    .map((r) => r.phone)
    .filter((p): p is string => !!p);
  if (phones.length === 0) {
    return (respondents ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      home_airport: null,
    }));
  }

  const { data: profiles } = await supabase
    .from('traveler_profiles')
    .select('phone, home_airport')
    .in('phone', phones);

  const airportByPhone = new Map<string, string | null>();
  for (const p of (profiles ?? []) as Array<{ phone: string; home_airport: string | null }>) {
    airportByPhone.set(p.phone, p.home_airport);
  }

  return (respondents ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    home_airport: r.phone ? airportByPhone.get(r.phone) ?? null : null,
  }));
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
  optionIds: string[],
  numericValue?: number | null
): Promise<void> {
  // Clear existing responses for this poll + respondent (covers both
  // option-based and numeric prior submissions).
  await supabase
    .from('poll_responses')
    .delete()
    .eq('poll_id', pollId)
    .eq('respondent_id', respondentId);

  // Free-form numeric response (e.g. duration poll's "how many nights")
  if (numericValue != null) {
    const { error } = await supabase
      .from('poll_responses')
      .insert({
        poll_id: pollId,
        respondent_id: respondentId,
        option_id: null,
        numeric_value: numericValue,
      });
    if (error) throw error;
    return;
  }

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
    .eq('respondent_id', respondentId)
    .not('option_id', 'is', null);
  if (error) throw error;

  const map: Record<string, string[]> = {};
  for (const row of data ?? []) {
    if (!row.option_id) continue;
    if (!map[row.poll_id]) map[row.poll_id] = [];
    map[row.poll_id].push(row.option_id);
  }
  return map;
}

/**
 * Returns the numeric_value (e.g. duration poll's free-form answer) keyed
 * by poll_id for a given respondent. Only populated for polls where the
 * respondent submitted a numeric_value response.
 */
export async function getExistingNumericResponses(
  tripId: string,
  respondentId: string
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('poll_responses')
    .select('poll_id, numeric_value')
    .eq('respondent_id', respondentId)
    .not('numeric_value', 'is', null);
  if (error) throw error;

  const map: Record<string, number> = {};
  for (const row of data ?? []) {
    if (row.numeric_value == null) continue;
    map[row.poll_id] = row.numeric_value;
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

/**
 * Mark a respondent as opted-out (rsvp='out') and fire the post-submit
 * confirmation SMS — used by the survey screen when someone answers "no"
 * to the "can you make this trip?" question. Does NOT submit poll
 * responses (the no-path skips polls entirely).
 *
 * Server-side, the survey-confirmation edge function flips
 * `trip_session_participants.is_attending = false` for the matching phone,
 * which excludes them from synthesis broadcasts, lock-broadcasts, and
 * the seeded nudge cadence — without globally opting them out (STOP-style).
 *
 * Best-effort on the SMS — survey state is the source of truth.
 */
export async function optOutFromTrip(
  respondentId: string,
  tripId: string,
  phone: string | null,
): Promise<void> {
  await saveRespondentRsvpAndPreferences(respondentId, 'out');
  await sendSurveyConfirmationSms(tripId, phone, 'out');
}

// ─── Planner designation ──────────────────────────────────────────────────────

export type SetPlannerReason =
  | 'invalid_phone'
  | 'forbidden'
  | 'phone_not_on_trip'
  | 'cannot_demote_creator'
  | 'trip_not_found'
  | 'not_authenticated'
  | 'unknown';

export type SetPlannerResult =
  | { ok: true; respondentUpdated: boolean; participantUpdated: boolean }
  | { ok: false; reason: SetPlannerReason };

/**
 * Promote or demote a trip member to/from planner status by phone.
 *
 * Wraps the `set_planner_for_phone` SECURITY DEFINER RPC (migration 094)
 * which flips is_planner on BOTH respondents and trip_session_participants
 * in one transaction. Phone is the canonical identity on a trip — same
 * value used by member-add/member-remove — so the toggle works whether or
 * not the target has filled out the survey yet.
 */
export async function setPlannerForPhone(
  tripId: string,
  phone: string,
  isPlanner: boolean,
): Promise<SetPlannerResult> {
  const { data, error } = await supabase.rpc('set_planner_for_phone', {
    p_trip_id: tripId,
    p_phone: phone,
    p_is_planner: isPlanner,
  });
  if (error) throw error;
  const row = data as
    | { ok: true; respondent_updated: boolean; participant_updated: boolean }
    | { ok: false; reason: string }
    | null;
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.ok) {
    return {
      ok: true,
      respondentUpdated: row.respondent_updated,
      participantUpdated: row.participant_updated,
    };
  }
  return { ok: false, reason: (row.reason as SetPlannerReason) || 'unknown' };
}
