import { Platform } from 'react-native';
import { supabase } from '../supabase';
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
 * Falls back to the global token for users who responded before this update.
 */
export async function getOrCreateRespondent(
  tripId: string,
  name: string,
  email?: string | null,
  phone?: string | null,
): Promise<Respondent> {
  // 1. Check per-trip token first
  const tripToken = await getTripSessionToken(tripId);
  if (tripToken) {
    const { data: existing } = await supabase
      .from('respondents')
      .select('*')
      .eq('trip_id', tripId)
      .eq('session_token', tripToken)
      .single();

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (existing.name !== name) updates.name = name;
      if (email != null && existing.email !== email) updates.email = email.trim() || null;
      if (phone != null && existing.phone !== phone) updates.phone = phone.trim() || null;
      if (Object.keys(updates).length > 0) {
        await supabase.from('respondents').update(updates).eq('id', existing.id);
      }
      return { ...existing, name, ...(email != null ? { email: email.trim() || null } : {}), ...(phone != null ? { phone: phone.trim() || null } : {}) };
    }
    // Trip token present but no matching row — fall through to create
  }

  // 2. Backward compat: check global token
  if (!tripToken) {
    const globalToken = await getGlobalSessionToken();
    const { data: existing } = await supabase
      .from('respondents')
      .select('*')
      .eq('trip_id', tripId)
      .eq('session_token', globalToken)
      .single();

    if (existing) {
      // Migrate to per-trip storage so future visits use it
      await setTripSessionToken(tripId, globalToken);
      const updates: Record<string, unknown> = {};
      if (existing.name !== name) updates.name = name;
      if (email != null && existing.email !== email) updates.email = email.trim() || null;
      if (phone != null && existing.phone !== phone) updates.phone = phone.trim() || null;
      if (Object.keys(updates).length > 0) {
        await supabase.from('respondents').update(updates).eq('id', existing.id);
      }
      return { ...existing, name, ...(email != null ? { email: email.trim() || null } : {}), ...(phone != null ? { phone: phone.trim() || null } : {}) };
    }
  }

  // 3. No existing respondent — create a new one with a fresh per-trip token
  const newToken = generateToken();
  await setTripSessionToken(tripId, newToken);

  const { data, error } = await supabase
    .from('respondents')
    .insert({
      trip_id: tripId,
      name,
      session_token: newToken,
      ...(email ? { email: email.trim() || null } : {}),
      ...(phone ? { phone: phone.trim() || null } : {}),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
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
