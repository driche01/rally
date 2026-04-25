/**
 * Component 3: TripSession
 *
 * State machine + Supabase operations for SMS trip sessions.
 * Manages phase transitions, participant tracking, and session lifecycle.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { SmsUser } from './phone-user-linker.ts';

// ─── Phase machine ───────────────────────────────────────────────────────────

export const PHASES = [
  'INTRO',
  'COLLECTING_DESTINATIONS',
  'DECIDING_DATES',
  'BUDGET_POLL',
  'BUDGET_DISCUSSION',
  'DECIDING_DESTINATION',
  'COLLECTING_ORIGINS',
  'ESTIMATING_COSTS',
  'COMMIT_POLL',
  'CREATING_COMMITTED_THREAD',
  'AWAITING_PLANNER_DECISION',
  'AWAITING_FLIGHTS',
  'DECIDING_LODGING_TYPE',
  'AWAITING_GROUP_BOOKING',
  'AWAITING_INDIVIDUAL_LODGING',
  'AWAITING_INDIVIDUAL_FLIGHTS',
  'FIRST_BOOKING_REACHED',
  'RECOMMENDING',
  'COMPLETE',
] as const;

export type Phase = (typeof PHASES)[number];

export const SESSION_STATUSES = [
  'ACTIVE',
  'PAUSED',
  'SPLIT',
  'CANCELLED',
  'ABANDONED',
  'FIRST_BOOKING_REACHED',
  'RE_ENGAGEMENT_PENDING',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

// Valid phase transitions (from → allowed next phases)
const VALID_TRANSITIONS: Record<string, string[]> = {
  INTRO: ['COLLECTING_DESTINATIONS'],
  COLLECTING_DESTINATIONS: ['DECIDING_DATES'],
  DECIDING_DATES: ['BUDGET_POLL', 'DECIDING_DESTINATION'],
  BUDGET_POLL: ['BUDGET_DISCUSSION', 'DECIDING_DESTINATION'],
  BUDGET_DISCUSSION: ['DECIDING_DESTINATION'],
  DECIDING_DESTINATION: ['COLLECTING_ORIGINS'],
  COLLECTING_ORIGINS: ['ESTIMATING_COSTS'],
  ESTIMATING_COSTS: ['COMMIT_POLL'],
  COMMIT_POLL: ['CREATING_COMMITTED_THREAD', 'AWAITING_PLANNER_DECISION', 'AWAITING_FLIGHTS'],
  CREATING_COMMITTED_THREAD: ['AWAITING_FLIGHTS'],
  AWAITING_PLANNER_DECISION: ['AWAITING_FLIGHTS'],
  AWAITING_FLIGHTS: ['DECIDING_LODGING_TYPE'],
  DECIDING_LODGING_TYPE: ['AWAITING_GROUP_BOOKING', 'AWAITING_INDIVIDUAL_LODGING', 'AWAITING_INDIVIDUAL_FLIGHTS'],
  AWAITING_GROUP_BOOKING: ['FIRST_BOOKING_REACHED'],
  AWAITING_INDIVIDUAL_LODGING: ['FIRST_BOOKING_REACHED'],
  AWAITING_INDIVIDUAL_FLIGHTS: ['FIRST_BOOKING_REACHED'],
  FIRST_BOOKING_REACHED: ['RECOMMENDING'],
  RECOMMENDING: ['COMPLETE'],
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TripSession {
  id: string;
  trip_id: string | null;
  thread_id: string;
  planner_user_id: string | null;
  phase: Phase;
  status: SessionStatus;
  destination: string | null;
  dates: { start: string; end: string; flexible?: boolean; nights?: number } | null;
  budget_median: number | null;
  budget_status: string;
  thread_name: string | null;
  last_message_at: string;
  version: number;
  paused: boolean;
  [key: string]: unknown;
}

export interface TripSessionParticipant {
  id: string;
  trip_session_id: string;
  user_id: string;
  phone: string;
  display_name: string | null;
  status: string;
  committed: boolean;
  flight_status: string;
  is_planner: boolean;
  budget_raw: string | null;
  budget_normalized: number | null;
  phase_confirmation: string | null;
  origin_city: string | null;
  origin_airport: string | null;
  flights_link_response: string | null;
  [key: string]: unknown;
}

// ─── Session operations ──────────────────────────────────────────────────────

/**
 * Find an active session by thread_id.
 */
export async function findSession(
  admin: SupabaseClient,
  threadId: string,
): Promise<TripSession | null> {
  const { data } = await admin
    .from('trip_sessions')
    .select('*')
    .eq('thread_id', threadId)
    .in('status', ['ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING'])
    .maybeSingle();

  return data;
}

/**
 * Create a new trip session and its corresponding trips row.
 * Returns the new session.
 */
export async function createSession(
  admin: SupabaseClient,
  threadId: string,
  plannerUser: SmsUser,
  threadName: string | null,
): Promise<TripSession> {
  // Create a trips row so polls and respondents can reference it
  const { data: trip, error: tripErr } = await admin
    .from('trips')
    .insert({
      name: threadName ?? 'SMS Trip',
      group_size_bucket: '5-8',
      status: 'active',
    })
    .select('id')
    .single();

  if (tripErr) throw new Error(`Failed to create trip: ${tripErr.message}`);

  // Create the trip session
  const { data: session, error: sessionErr } = await admin
    .from('trip_sessions')
    .insert({
      trip_id: trip!.id,
      thread_id: threadId,
      planner_user_id: plannerUser.id,
      phase: 'INTRO',
      status: 'ACTIVE',
      thread_name: threadName,
    })
    .select('*')
    .single();

  if (sessionErr) throw new Error(`Failed to create session: ${sessionErr.message}`);
  return session!;
}

/**
 * Add a participant to a session.
 */
export async function addParticipant(
  admin: SupabaseClient,
  sessionId: string,
  user: SmsUser,
  isPlanner: boolean,
): Promise<TripSessionParticipant> {
  // Upsert by (trip_session_id, phone) to avoid duplicates
  const { data, error } = await admin
    .from('trip_session_participants')
    .upsert(
      {
        trip_session_id: sessionId,
        user_id: user.id,
        phone: user.phone,
        display_name: user.display_name,
        status: 'active',
        is_planner: isPlanner,
      },
      { onConflict: 'trip_session_id,phone' },
    )
    .select('*')
    .single();

  if (error) throw new Error(`Failed to add participant: ${error.message}`);
  return data!;
}

/**
 * Get all participants for a session.
 */
export async function getParticipants(
  admin: SupabaseClient,
  sessionId: string,
): Promise<TripSessionParticipant[]> {
  const { data, error } = await admin
    .from('trip_session_participants')
    .select('*')
    .eq('trip_session_id', sessionId)
    .order('joined_at');

  if (error) throw new Error(`Failed to get participants: ${error.message}`);
  return data ?? [];
}

/**
 * Transition the session to a new phase with optimistic locking.
 * Logs the transition to trip_session_events.
 * Returns true if successful, false if version conflict.
 */
export async function transitionPhase(
  admin: SupabaseClient,
  session: TripSession,
  toPhase: Phase,
  triggeredByUserId?: string,
  triggeringMessageSid?: string,
): Promise<boolean> {
  // Reload current phase + version to handle chained transitions
  const { data: current } = await admin
    .from('trip_sessions')
    .select('phase, version')
    .eq('id', session.id)
    .single();

  if (!current) return false;
  const fromPhase = current.phase;
  const currentVersion = current.version;

  // Validate transition
  const allowed = VALID_TRANSITIONS[fromPhase];
  if (!allowed || !allowed.includes(toPhase)) {
    console.error(`Invalid phase transition: ${fromPhase} → ${toPhase}`);
    return false;
  }

  // Optimistic locking with fresh version
  const { data, error } = await admin
    .from('trip_sessions')
    .update({
      phase: toPhase,
      version: currentVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)
    .eq('version', currentVersion)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    console.error(`Phase transition failed (version conflict?): ${error?.message}`);
    return false;
  }

  // Log the event
  await admin.from('trip_session_events').insert({
    trip_session_id: session.id,
    event_type: 'phase_transition',
    from_phase: fromPhase,
    to_phase: toPhase,
    triggered_by_user_id: triggeredByUserId ?? null,
    triggering_message_sid: triggeringMessageSid ?? null,
  });

  return true;
}

/**
 * Update last_message_at on the session.
 */
export async function touchSession(
  admin: SupabaseClient,
  sessionId: string,
): Promise<void> {
  await admin
    .from('trip_sessions')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', sessionId);
}

// ─── 1:1 pivot helpers (Phase 2) ─────────────────────────────────────────────

const ACTIVE_SESSION_STATUSES = [
  'ACTIVE',
  'PAUSED',
  'RE_ENGAGEMENT_PENDING',
  'FIRST_BOOKING_REACHED',
] as const;

const JOIN_BASE_URL = 'https://rallysurveys.netlify.app/join';
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Crockford-base32, no I/O/0/1

/**
 * Find the most-recently-active trip session where this phone is an
 * active participant. If the phone is in multiple concurrent active
 * sessions (rare V1; documented limitation), returns the one whose
 * session.last_message_at is most recent. Returns null if none.
 *
 * Replaces the comma-parsed group lookup that drove the old MMS routing.
 */
export async function findActiveSessionForPhone(
  admin: SupabaseClient,
  phone: string,
): Promise<{ session: TripSession; participant: TripSessionParticipant } | null> {
  const { data: rows } = await admin
    .from('trip_session_participants')
    .select('*, trip_sessions!inner(*)')
    .eq('phone', phone)
    .eq('status', 'active')
    .in('trip_sessions.status', ACTIVE_SESSION_STATUSES as unknown as string[])
    .order('joined_at', { ascending: false });

  if (!rows || rows.length === 0) return null;

  // Pick the row whose underlying session has the most recent activity.
  let best: { session: TripSession; participant: TripSessionParticipant } | null = null;
  let bestTs = -Infinity;
  for (const row of rows) {
    // deno-lint-ignore no-explicit-any
    const sessionEmbedded = (row as any).trip_sessions as TripSession;
    const ts = sessionEmbedded.last_message_at
      ? new Date(sessionEmbedded.last_message_at).getTime()
      : 0;
    if (ts > bestTs) {
      bestTs = ts;
      // Strip the embedded join from the participant object.
      // deno-lint-ignore no-explicit-any
      const { trip_sessions: _embed, ...participant } = row as any;
      best = {
        session: sessionEmbedded,
        participant: participant as TripSessionParticipant,
      };
    }
  }
  return best;
}

/**
 * Create a fresh planner-led trip session AND mint a join link in one
 * pass. Used by `handleNewPlannerInbound` when a phone with no active
 * session texts Rally with planning intent. Service-role; no auth.uid()
 * gate (the edge function already validated the inbound origin).
 *
 * Mirrors create_join_link from migration 039 for the code generation
 * but lives in TS so the inbound path can react in one round-trip.
 */
export async function createPlannerSessionWithJoinLink(
  admin: SupabaseClient,
  planner: SmsUser,
  hints: {
    destination?: string | null;
    dates?: { start: string; end: string; nights?: number } | null;
    budget?: number | null;
    threadName?: string | null;
  },
): Promise<{
  session: TripSession;
  participant: TripSessionParticipant;
  joinCode: string;
  joinUrl: string;
}> {
  // 1. Create a `trips` row so polls and respondents have something to FK to.
  const { data: trip, error: tripErr } = await admin
    .from('trips')
    .insert({
      name: hints.threadName ?? hints.destination ?? 'SMS Trip',
      destination: hints.destination ?? null,
      group_size_bucket: '5-8',
      status: 'active',
    })
    .select('id')
    .single();
  if (tripErr) throw new Error(`Failed to create trip: ${tripErr.message}`);

  // 2. Create the trip session — thread_id NULL under the 1:1 model.
  const sessionInsert: Record<string, unknown> = {
    trip_id: trip!.id,
    thread_id: null,
    planner_user_id: planner.id,
    phase: 'INTRO',
    status: 'ACTIVE',
    thread_name: hints.threadName ?? null,
    trip_model: '1to1',
  };
  if (hints.destination) sessionInsert.destination = hints.destination;
  if (hints.destination) {
    sessionInsert.destination_candidates = [{ label: hints.destination, votes: 1 }];
  }
  if (hints.dates) sessionInsert.dates = hints.dates;
  if (hints.budget) {
    sessionInsert.budget_median = hints.budget;
    sessionInsert.budget_status = 'ALIGNED';
  }

  const { data: session, error: sessionErr } = await admin
    .from('trip_sessions')
    .insert(sessionInsert)
    .select('*')
    .single();
  if (sessionErr) throw new Error(`Failed to create session: ${sessionErr.message}`);

  // 3. Add the planner as the first participant.
  const participant = await addParticipant(admin, session!.id, planner, true);
  await admin
    .from('trip_session_participants')
    .update({ is_attending: true })
    .eq('id', participant.id);

  // 4. Mint a join link. Retry on (extremely rare) code collision.
  let joinCode = '';
  let attempts = 0;
  while (true) {
    joinCode = generateJoinCode();
    const { error: linkErr } = await admin
      .from('join_links')
      .insert({
        trip_session_id: session!.id,
        code: joinCode,
        created_by_user_id: planner.id,
      });
    if (!linkErr) break;
    if (linkErr.code !== '23505' /* unique_violation */) {
      throw new Error(`Failed to create join_link: ${linkErr.message}`);
    }
    attempts += 1;
    if (attempts >= 5) throw new Error('join_link_code_collision');
  }

  return {
    session: session!,
    participant,
    joinCode,
    joinUrl: `${JOIN_BASE_URL}/${joinCode}`,
  };
}

/**
 * Returns the latest non-revoked, non-expired join_link for a session,
 * minting one if none exists. Used by message-router when softening the
 * "Is that everyone?" prompt to include the share URL.
 */
export async function getOrCreateJoinLinkForSession(
  admin: SupabaseClient,
  sessionId: string,
  createdByUserId: string | null,
): Promise<{ code: string; url: string }> {
  const { data: existing } = await admin
    .from('join_links')
    .select('code, expires_at, revoked_at')
    .eq('trip_session_id', sessionId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.code) {
    return { code: existing.code, url: `${JOIN_BASE_URL}/${existing.code}` };
  }

  let attempts = 0;
  while (true) {
    const code = generateJoinCode();
    const { error } = await admin.from('join_links').insert({
      trip_session_id: sessionId,
      code,
      created_by_user_id: createdByUserId,
    });
    if (!error) return { code, url: `${JOIN_BASE_URL}/${code}` };
    if (error.code !== '23505') throw new Error(`join_link insert failed: ${error.message}`);
    attempts += 1;
    if (attempts >= 5) throw new Error('join_link_code_collision');
  }
}

function generateJoinCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const b of bytes) code += JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length];
  return code;
}
