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
