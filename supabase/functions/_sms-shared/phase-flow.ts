/**
 * Phase flow controller — drives the trip through the decision journey.
 *
 * Handles phase transitions and generates phase-appropriate prompts.
 * Called by MessageRouter when the current phase's collection is complete.
 *
 * Flow: INTRO → COLLECTING_DESTINATIONS → DECIDING_DATES → BUDGET_POLL →
 *       DECIDING_DESTINATION → COLLECTING_ORIGINS → ESTIMATING_COSTS →
 *       COMMIT_POLL → AWAITING_FLIGHTS → DECIDING_LODGING_TYPE → ...
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { TripSession, TripSessionParticipant } from './trip-session.ts';
import { transitionPhase, getParticipants } from './trip-session.ts';
import { createPoll, formatPollMessage, formatBudgetPollMessage } from './poll-engine.ts';
import { launchCommitPoll } from './commit-poll-engine.ts';

/**
 * Advance the session to the next phase and return the prompt message.
 * Returns null if no transition is needed.
 */
export async function advancePhase(
  admin: SupabaseClient,
  session: TripSession,
  triggerUserId?: string,
  triggerMessageSid?: string,
): Promise<string | null> {
  const phase = session.phase;
  const participants = await getParticipants(admin, session.id);

  switch (phase) {
    case 'INTRO':
      return advanceFromIntro(admin, session, participants, triggerUserId, triggerMessageSid);

    case 'COLLECTING_DESTINATIONS':
      return advanceFromCollectingDestinations(admin, session, participants, triggerUserId, triggerMessageSid);

    case 'DECIDING_DATES':
      return advanceFromDecidingDates(admin, session, participants, triggerUserId, triggerMessageSid);

    case 'BUDGET_POLL':
      return advanceFromBudgetPoll(admin, session, participants, triggerUserId, triggerMessageSid);

    case 'DECIDING_DESTINATION':
      return advanceFromDecidingDestination(admin, session, participants, triggerUserId, triggerMessageSid);

    case 'COLLECTING_ORIGINS':
      return advanceFromCollectingOrigins(admin, session, participants, triggerUserId, triggerMessageSid);

    case 'ESTIMATING_COSTS':
      return advanceFromEstimatingCosts(admin, session, participants, triggerUserId, triggerMessageSid);

    case 'COMMIT_POLL':
      return advanceFromCommitPoll(admin, session, participants, triggerUserId, triggerMessageSid);

    case 'AWAITING_FLIGHTS':
      return advanceFromAwaitingFlights(admin, session, participants, triggerUserId, triggerMessageSid);

    case 'DECIDING_LODGING_TYPE':
      return advanceFromDecidingLodgingType(admin, session, participants, triggerUserId, triggerMessageSid);

    default:
      return null;
  }
}

// ─── INTRO → COLLECTING_DESTINATIONS ─────────────────────────────────────────

async function advanceFromIntro(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  triggerUserId?: string,
  triggerMessageSid?: string,
): Promise<string | null> {
  // Check if all active participants have provided names
  const named = participants.filter((p) => p.display_name && p.status === 'active');
  const active = participants.filter((p) => p.status === 'active');

  // Need at least 2 participants with names, or planner can force with NEXT
  if (named.length < 2 && named.length < active.length) return null;

  await transitionPhase(admin, session, 'COLLECTING_DESTINATIONS', triggerUserId, triggerMessageSid);

  const candidates = ((session as Record<string, unknown>).destination_candidates as Array<{ label: string }>) ?? [];
  if (candidates.length > 0) {
    const list = candidates.map((c) => c.label).join(', ');
    return `Great \u2014 so far I'm hearing: ${list}. Anyone else have ideas? Drop them now or I'll move to dates in a bit.`;
  }

  return "Where are you thinking? Drop your destination ideas \u2014 we'll vote once everyone's weighed in.";
}

// ─── COLLECTING_DESTINATIONS → DECIDING_DATES ───────────────────────────────

async function advanceFromCollectingDestinations(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  triggerUserId?: string,
  triggerMessageSid?: string,
): Promise<string | null> {
  await transitionPhase(admin, session, 'DECIDING_DATES', triggerUserId, triggerMessageSid);

  return "Destinations locked. When are you thinking? Drop your dates \u2014 exact or rough both work.";
}

// ─── DECIDING_DATES → BUDGET_POLL or DECIDING_DESTINATION ───────────────────

async function advanceFromDecidingDates(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  triggerUserId?: string,
  triggerMessageSid?: string,
): Promise<string | null> {
  // If budget already known (from planner intake), skip to destination vote
  if (session.budget_median || session.budget_status === 'SKIPPED') {
    return advanceToDestinationVote(admin, session, participants, triggerUserId, triggerMessageSid);
  }

  await transitionPhase(admin, session, 'BUDGET_POLL', triggerUserId, triggerMessageSid);
  return formatBudgetPollMessage();
}

// ─── BUDGET_POLL → DECIDING_DESTINATION ──────────────────────────────────────

async function advanceFromBudgetPoll(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  triggerUserId?: string,
  triggerMessageSid?: string,
): Promise<string | null> {
  return advanceToDestinationVote(admin, session, participants, triggerUserId, triggerMessageSid);
}

// ─── Helper: launch destination vote ─────────────────────────────────────────

async function advanceToDestinationVote(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  triggerUserId?: string,
  triggerMessageSid?: string,
): Promise<string | null> {
  const candidates = ((session as Record<string, unknown>).destination_candidates as Array<{ label: string }>) ?? [];

  // If only one candidate, lock it in directly
  if (candidates.length === 1) {
    await admin
      .from('trip_sessions')
      .update({ destination: candidates[0].label })
      .eq('id', session.id);
    await transitionPhase(admin, session, 'COLLECTING_ORIGINS', triggerUserId, triggerMessageSid);
    return `Only one destination on the table \u2014 ${candidates[0].label} it is! Where is everyone flying from? Reply with your city or airport code.`;
  }

  if (candidates.length === 0) {
    return "No destinations suggested yet \u2014 drop your ideas!";
  }

  // Create a vote poll
  await transitionPhase(admin, session, 'DECIDING_DESTINATION', triggerUserId, triggerMessageSid);
  const labels = candidates.map((c) => c.label);
  const { poll } = await createPoll(admin, session, 'destination_vote', 'Where are we going?', labels);

  return formatPollMessage('Time to vote \u2014 where are we going?', labels);
}

// ─── DECIDING_DESTINATION → COLLECTING_ORIGINS ──────────────────────────────

async function advanceFromDecidingDestination(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  triggerUserId?: string,
  triggerMessageSid?: string,
): Promise<string | null> {
  await transitionPhase(admin, session, 'COLLECTING_ORIGINS', triggerUserId, triggerMessageSid);

  return `${session.destination} is locked! Where is everyone flying from? Reply with your city or airport code \u2014 you've got 2 hours.`;
}

// ─── COLLECTING_ORIGINS → ESTIMATING_COSTS ──────────────────────────────────

async function advanceFromCollectingOrigins(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  triggerUserId?: string,
  triggerMessageSid?: string,
): Promise<string | null> {
  await transitionPhase(admin, session, 'ESTIMATING_COSTS', triggerUserId, triggerMessageSid);

  // In a full implementation, CostEstimator runs here async
  // For now, move straight to commit
  return `Got everyone's origins. Pulling cost estimates for ${session.destination ?? 'the trip'}...`;
}

// ─── ESTIMATING_COSTS → COMMIT_POLL ─────────────────────────────────────────

async function advanceFromEstimatingCosts(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  triggerUserId?: string,
  triggerMessageSid?: string,
): Promise<string | null> {
  await transitionPhase(admin, session, 'COMMIT_POLL', triggerUserId, triggerMessageSid);
  return launchCommitPoll(admin, session, participants);
}

// ─── COMMIT_POLL → AWAITING_FLIGHTS ─────────────────────────────────────────

async function advanceFromCommitPoll(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  triggerUserId?: string,
  triggerMessageSid?: string,
): Promise<string | null> {
  // Commit poll resolves itself via CommitPollEngine
  return null;
}

// ─── AWAITING_FLIGHTS → DECIDING_LODGING_TYPE ───────────────────────────────

async function advanceFromAwaitingFlights(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  triggerUserId?: string,
  triggerMessageSid?: string,
): Promise<string | null> {
  // Summarize flight status
  const confirmed = participants.filter((p) => p.flight_status === 'confirmed').length;
  const notYet = participants.filter((p) => p.flight_status === 'not_yet').length;
  const driving = participants.filter((p) => p.flight_status === 'driving').length;

  await transitionPhase(admin, session, 'DECIDING_LODGING_TYPE', triggerUserId, triggerMessageSid);

  let summary = `Flights update: ${confirmed} sorted`;
  if (notYet > 0) summary += `, ${notYet} still working on it`;
  if (driving > 0) summary += `, ${driving} driving`;
  summary += '.';

  // Create lodging type poll
  const lodgingOptions = ['Staying together (group rental)', 'Booking separately', 'Flights only (skip lodging)'];
  await createPoll(admin, session, 'lodging_type', 'How are we handling lodging?', lodgingOptions);

  return summary + '\n\nMoving to lodging \u2014 how are we handling it?\n\n1. Staying together (group rental)\n2. Booking separately\n3. Flights only (skip lodging)';
}

// ─── DECIDING_LODGING_TYPE → next phase based on choice ─────────────────────

async function advanceFromDecidingLodgingType(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  triggerUserId?: string,
  triggerMessageSid?: string,
): Promise<string | null> {
  const lodgingType = (session as Record<string, unknown>).lodging_type as string | null;

  if (lodgingType === 'GROUP') {
    await transitionPhase(admin, session, 'AWAITING_GROUP_BOOKING', triggerUserId, triggerMessageSid);
    const planner = participants.find((p) => p.is_planner);
    return `Group rental it is! ${planner?.display_name ?? 'Planner'} \u2014 book when you're ready and text "Booked [property] for $[total]" when it's done.`;
  }

  if (lodgingType === 'INDIVIDUAL') {
    await transitionPhase(admin, session, 'AWAITING_INDIVIDUAL_LODGING', triggerUserId, triggerMessageSid);
    return 'Everyone booking their own \u2014 text BOOKED when you\'ve sorted yours.';
  }

  // Flights only
  await transitionPhase(admin, session, 'AWAITING_INDIVIDUAL_FLIGHTS', triggerUserId, triggerMessageSid);
  return 'Flights only \u2014 text BOOKED when you\'ve got yours sorted.';
}

/**
 * Check if the current phase is ready to advance based on collected data.
 * Called after every message to see if we should auto-advance.
 */
export async function checkAutoAdvance(
  admin: SupabaseClient,
  session: TripSession,
): Promise<string | null> {
  const phase = session.phase;
  const participants = await getParticipants(admin, session.id);
  const active = participants.filter((p) => p.status === 'active');

  switch (phase) {
    case 'INTRO': {
      // Auto-advance when all active participants have names
      const allNamed = active.every((p) => p.display_name);
      if (allNamed && active.length >= 2) {
        return advancePhase(admin, session);
      }
      return null;
    }

    case 'COLLECTING_ORIGINS': {
      // Auto-advance when all have provided origins
      const allOrigins = active.every((p) => p.origin_airport || p.origin_city);
      if (allOrigins) {
        return advancePhase(admin, session);
      }
      return null;
    }

    default:
      return null;
  }
}
