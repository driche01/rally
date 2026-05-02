/**
 * Traveler-profile API.
 *
 * Two access patterns:
 *   1. Anon respondent — read/write own profile via SECURITY DEFINER
 *      RPCs that gate on (share_token + phone). The respondent doesn't
 *      have an auth identity — they prove access by knowing both the
 *      share_token (from their SMS link) and the phone they entered
 *      into the survey.
 *   2. Authenticated planner — read profiles of trip participants via
 *      direct table SELECT. RLS gates the access.
 */
import { supabase } from '@/lib/supabase';
import type { LodgingPref, SleepPref, TravelerProfile, TravelerProfileDraft } from '@/types/profile';

/**
 * Fetch the respondent's own profile via the share_token + phone
 * authorization gate. Returns null if no profile exists yet (first
 * time) or if the phone isn't on a session for that share_token.
 */
export async function getProfileByToken(
  shareToken: string,
  phone: string,
): Promise<TravelerProfile | null> {
  const { data, error } = await supabase.rpc('get_traveler_profile_by_token', {
    p_share_token: shareToken,
    p_phone: phone,
  });
  if (error) {
    console.warn('[traveler-profile] read failed:', error.message);
    return null;
  }
  return (data as TravelerProfile | null) ?? null;
}

/**
 * Save the respondent's profile via the share_token + phone gate.
 * Performs a full upsert — every field in the draft replaces the
 * existing column, so the form always sends the complete state it has
 * captured (the form holds the current row in memory and edits it).
 */
export async function upsertProfileByToken(
  shareToken: string,
  draft: TravelerProfileDraft,
): Promise<{ ok: boolean; profile?: TravelerProfile; reason?: string }> {
  const payload = {
    home_airport: draft.home_airport,
    travel_pref: draft.travel_pref,
    flight_dealbreakers: draft.flight_dealbreakers ?? [],
    sleep_pref: draft.sleep_pref,
    lodging_pref: draft.lodging_pref,
    dietary_restrictions: draft.dietary_restrictions ?? [],
    dietary_specifics: draft.dietary_specifics,
    meal_pref: draft.meal_pref,
    drinking_pref: draft.drinking_pref,
    physical_limitations: draft.physical_limitations ?? [],
    physical_specifics: draft.physical_specifics,
    trip_pace: draft.trip_pace,
    activity_types: draft.activity_types ?? [],
    budget_posture: draft.budget_posture,
    notes: draft.notes,
  };

  const { data, error } = await supabase.rpc('upsert_traveler_profile_by_token', {
    p_share_token: shareToken,
    p_phone: draft.phone,
    p_profile: payload,
  });
  if (error) return { ok: false, reason: error.message };
  const result = data as { ok: boolean; reason?: string; profile?: TravelerProfile };
  return result;
}

/**
 * Authenticated user — fetch the current user's own profile via the
 * SECURITY DEFINER `get_my_traveler_profile` RPC (resolves
 * auth.uid() → users.phone → traveler_profiles row).
 *
 * Returns null when the user has no phone on their account or no
 * profile saved yet (first-time signup).
 */
export async function getMyTravelerProfile(): Promise<TravelerProfile | null> {
  const { data, error } = await supabase.rpc('get_my_traveler_profile');
  if (error) {
    console.warn('[traveler-profile] get_my_traveler_profile failed:', error.message);
    return null;
  }
  return (data as TravelerProfile | null) ?? null;
}

/**
 * Authenticated user — upsert the current user's own profile via the
 * SECURITY DEFINER `upsert_my_traveler_profile` RPC. The RPC resolves
 * the row's phone from auth.uid() so the client doesn't need to pass
 * it (and can't spoof another user's phone).
 *
 * Returns `{ ok: false, reason: 'no_phone_on_account' }` when the
 * user's `users` row has no phone — caller should prompt them to
 * link a phone via the claim flow first.
 */
export async function upsertMyTravelerProfile(
  draft: TravelerProfileDraft,
): Promise<{ ok: boolean; profile?: TravelerProfile; reason?: string }> {
  const payload = {
    home_airport: draft.home_airport,
    travel_pref: draft.travel_pref,
    flight_dealbreakers: draft.flight_dealbreakers ?? [],
    sleep_pref: draft.sleep_pref,
    lodging_pref: draft.lodging_pref,
    dietary_restrictions: draft.dietary_restrictions ?? [],
    dietary_specifics: draft.dietary_specifics,
    meal_pref: draft.meal_pref,
    drinking_pref: draft.drinking_pref,
    physical_limitations: draft.physical_limitations ?? [],
    physical_specifics: draft.physical_specifics,
    trip_pace: draft.trip_pace,
    activity_types: draft.activity_types ?? [],
    budget_posture: draft.budget_posture,
    notes: draft.notes,
  };
  const { data, error } = await supabase.rpc('upsert_my_traveler_profile', {
    p_profile: payload,
  });
  if (error) return { ok: false, reason: error.message };
  return data as { ok: boolean; profile?: TravelerProfile; reason?: string };
}

/**
 * Planner read — direct SELECT, RLS gates on planner = trip member of
 * any trip the phone is on. Returns null if the planner isn't
 * authorized or the profile doesn't exist.
 */
export async function getProfileForPhonePlannerSide(
  phone: string,
): Promise<TravelerProfile | null> {
  if (!phone) return null;
  const { data, error } = await supabase
    .from('traveler_profiles')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();
  if (error) {
    console.warn('[traveler-profile] planner read failed:', error.message);
    return null;
  }
  return (data as TravelerProfile | null) ?? null;
}

/**
 * Per-participant traveler-profile snapshot for a trip session.
 *
 * Backed by the SECURITY DEFINER RPC `get_traveler_profiles_for_trip_session`
 * (migration 064). The RPC verifies the caller is a `trip_members` row
 * for the trip the session belongs to, then joins
 * `trip_session_participants` to `traveler_profiles` and returns one
 * row per active participant. `profile` is null for participants who
 * haven't filled out their profile yet.
 *
 * RLS-bypass via SECURITY DEFINER is intentional — earlier RLS-based
 * gating filtered out legitimate profiles even when the participant
 * phone matched the saved row.
 */
export interface ParticipantWithProfile {
  participant_id: string;
  phone: string;
  display_name: string | null;
  profile: TravelerProfile | null;
}

/**
 * Lightweight summary of the trip's traveler-profile lodging preferences.
 * Used as a query-key dependency for the lodging-suggestions query so that
 * suggestions auto-refetch when a respondent updates their lodging_pref.
 *
 * Returns counts per option plus the latest `updated_at` across the
 * matched profiles — that timestamp is the change-detection signal.
 */
export interface GroupLodgingPrefSummary {
  total: number;
  counts: Record<LodgingPref, number>;
  /** Sleep-pref answers across the group's traveler profiles — drives bedroom-count heuristics. */
  sleepCounts: Record<SleepPref, number>;
  lastUpdatedAt: string | null;
}

export async function getGroupLodgingPrefSummary(
  tripId: string,
): Promise<GroupLodgingPrefSummary> {
  const empty: GroupLodgingPrefSummary = {
    total: 0,
    counts: { hotel: 0, rental: 0, either: 0 },
    sleepCounts: { own_room: 0, own_bed: 0, share_bed: 0, flexible: 0 },
    lastUpdatedAt: null,
  };
  if (!tripId) return empty;

  const { data: respondents, error: respErr } = await supabase
    .from('respondents')
    .select('phone')
    .eq('trip_id', tripId);
  if (respErr) {
    console.warn('[traveler-profile] respondent phones fetch failed:', respErr.message);
    return empty;
  }
  const phones = (respondents ?? [])
    .map((r: { phone: string | null }) => r.phone)
    .filter((p): p is string => !!p);
  if (phones.length === 0) return empty;

  const { data: profiles, error: profErr } = await supabase
    .from('traveler_profiles')
    .select('lodging_pref, sleep_pref, updated_at')
    .in('phone', phones);
  if (profErr) {
    console.warn('[traveler-profile] summary fetch failed:', profErr.message);
    return empty;
  }

  const counts: Record<LodgingPref, number> = { hotel: 0, rental: 0, either: 0 };
  const sleepCounts: Record<SleepPref, number> = { own_room: 0, own_bed: 0, share_bed: 0, flexible: 0 };
  let lastUpdatedAt: string | null = null;
  for (const p of (profiles ?? []) as Array<{ lodging_pref: LodgingPref | null; sleep_pref: SleepPref | null; updated_at: string }>) {
    if (p.lodging_pref) counts[p.lodging_pref]++;
    if (p.sleep_pref) sleepCounts[p.sleep_pref]++;
    if (!lastUpdatedAt || p.updated_at > lastUpdatedAt) lastUpdatedAt = p.updated_at;
  }
  return { total: profiles?.length ?? 0, counts, sleepCounts, lastUpdatedAt };
}

export async function getProfilesForTripSession(
  sessionId: string,
): Promise<ParticipantWithProfile[]> {
  if (!sessionId) return [];

  const { data, error } = await supabase.rpc('get_traveler_profiles_for_trip_session', {
    p_session_id: sessionId,
  });

  if (error) {
    console.warn('[traveler-profile] session profiles RPC failed:', error.message);
    return [];
  }

  type Row = {
    participant_id: string;
    phone: string;
    display_name: string | null;
    profile: TravelerProfile | null;
  };

  return ((data ?? []) as Row[]).map((r) => ({
    participant_id: r.participant_id,
    phone: r.phone,
    display_name: r.display_name,
    profile: r.profile,
  }));
}
