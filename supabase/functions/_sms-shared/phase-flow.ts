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
import { estimateFlightCost, formatCostSummary, type FlightEstimate } from './cost-estimator.ts';

/**
 * Advance the session to the next phase and return the prompt message.
 * Always reloads session from DB to avoid stale phase/version issues.
 * Returns null if no transition is needed.
 */
export async function advancePhase(
  admin: SupabaseClient,
  session: TripSession,
  triggerUserId?: string,
  triggerMessageSid?: string,
): Promise<string | null> {
  // Reload session from DB to get current phase + version
  const { data: fresh } = await admin
    .from('trip_sessions')
    .select('*')
    .eq('id', session.id)
    .single();
  if (!fresh) return null;
  session = fresh;

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
  const named = participants.filter((p) => p.display_name && p.status === 'active');
  const active = participants.filter((p) => p.status === 'active');

  // Need at least 2 named participants to advance
  if (named.length < 2) return null;

  await transitionPhase(admin, session, 'COLLECTING_DESTINATIONS', triggerUserId, triggerMessageSid);

  // Reload to get fresh state
  const { data: freshSession } = await admin.from('trip_sessions').select('*').eq('id', session.id).single();
  const candidates = (freshSession?.destination_candidates as Array<{ label: string }>) ?? [];

  // If all participants already contributed destinations during INTRO,
  // auto-chain straight to dates
  if (candidates.length > 0 && named.length >= active.length) {
    const list = candidates.map((c) => c.label).join(', ');
    const datesMsg = await advanceFromCollectingDestinations(admin, freshSession!, participants, triggerUserId, triggerMessageSid);
    // Single destination = decided. Multiple = list as options to vote on later.
    if (candidates.length === 1) {
      // Lock in the destination immediately
      await admin.from('trip_sessions').update({ destination: candidates[0].label }).eq('id', session.id);
      return `${list} it is! \ud83c\udf89\n\n${datesMsg}`;
    }
    return `${list} on the table \u2014 we'll nail down dates and budget first, then vote on where.\n\n${datesMsg}`;
  }

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

  // Check if dates/budget are pre-filled (planner intake) — ask group to confirm
  const { data: fresh } = await admin.from('trip_sessions').select('*').eq('id', session.id).single();
  if (fresh?.dates || fresh?.budget_median) {
    const parts: string[] = [];
    const dest = (fresh.destination_candidates as Array<{ label: string }>)?.[0]?.label ?? fresh.destination;
    if (dest) parts.push(dest);
    if (fresh.dates) {
      const d = fresh.dates as { start: string; end: string };
      const start = new Date(d.start + 'T12:00:00');
      const end = new Date(d.end + 'T12:00:00');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      parts.push(`${months[start.getMonth()]} ${start.getDate()}\u2013${end.getDate()}`);
    }
    if (fresh.budget_median) parts.push(`~$${fresh.budget_median}/person`);

    const planner = participants.find(p => p.is_planner);
    const plannerName = planner?.display_name ?? 'The planner';

    // Auto-confirm the planner who proposed it
    if (planner) {
      await admin.from('trip_session_participants')
        .update({ phase_confirmation: 'PREFILL_CONFIRMED' })
        .eq('id', planner.id);
    }

    await admin.from('trip_sessions').update({
      phase_sub_state: 'PREFILL_CONFIRMATION',
    }).eq('id', session.id);

    return `${plannerName} proposed ${parts.join(', ')}. Everyone good? Reply YES to confirm or suggest changes.`;
  }

  return "When are you thinking? Drop your dates \u2014 exact or rough both work.";
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

  // Clear any raw date text that was stashed in budget_raw during DECIDING_DATES
  // so it doesn't leak into the budget poll, and clear per-participant phase
  // confirmation flags now that we're moving on.
  await admin
    .from('trip_session_participants')
    .update({ budget_raw: null, phase_confirmation: null })
    .eq('trip_session_id', session.id);

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
  let candidates = ((session as Record<string, unknown>).destination_candidates as Array<{ label: string; votes?: number }>) ?? [];

  // #21: Cap at 4 candidates — take the ones with the most mentions (votes)
  if (candidates.length > 4) {
    candidates = [...candidates]
      .sort((a, b) => (b.votes ?? 1) - (a.votes ?? 1))
      .slice(0, 4);
  }

  // If only one candidate, lock it in directly — still go through DECIDING_DESTINATION for valid transition chain
  if (candidates.length === 1) {
    await admin
      .from('trip_sessions')
      .update({ destination: candidates[0].label })
      .eq('id', session.id);
    // Transition through DECIDING_DESTINATION → COLLECTING_ORIGINS
    await transitionPhase(admin, session, 'DECIDING_DESTINATION', triggerUserId, triggerMessageSid);
    await transitionPhase(admin, session, 'COLLECTING_ORIGINS', triggerUserId, triggerMessageSid);
    return `Only one destination on the table \u2014 ${candidates[0].label} it is! Where is everyone flying from? Reply with your city or airport code.`;
  }

  // #62 — Zero destinations suggested: don't close brainstorm, prompt for ideas
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
  // Transition to ESTIMATING_COSTS
  await transitionPhase(admin, session, 'ESTIMATING_COSTS', triggerUserId, triggerMessageSid);

  // Fetch real flight estimates via Gemini
  const destination = session.destination ?? 'the destination';
  const dates = session.dates;
  const startDate = dates?.start ?? '';
  const endDate = dates?.end ?? '';

  // Group participants by origin
  const originGroups = new Map<string, string[]>();
  for (const p of participants) {
    const origin = p.origin_airport || p.origin_city || 'unknown';
    if (origin === 'unknown') continue;
    const existing = originGroups.get(origin) ?? [];
    existing.push(p.display_name ?? p.phone);
    originGroups.set(origin, existing);
  }

  // Fetch flight estimates per origin — all in parallel for speed
  const flightLines: string[] = [];
  if (startDate && endDate) {
    const originEntries = [...originGroups.entries()];
    const results = await Promise.all(
      originEntries.map(([origin]) => estimateFlightCost(origin, destination, startDate, endDate)),
    );
    for (let i = 0; i < originEntries.length; i++) {
      const [origin, names] = originEntries[i];
      const { estimate, example } = results[i];
      const nameStr = names.join(', ');
      if (example && example.airline && example.price > 0) {
        flightLines.push(`\u2708\uFE0F ${nameStr} from ${origin}: ${example.airline} ~$${example.price}/person rt`);
        if (example.booking_url) flightLines.push(example.booking_url);
      } else if (estimate && estimate.mid > 0) {
        flightLines.push(`\u2708\uFE0F ${nameStr} from ${origin}: ~$${estimate.mid}/person rt`);
        if (estimate.google_flights_url) flightLines.push(estimate.google_flights_url);
      } else {
        // Couldn't get pricing for this route — show a helpful fallback
        flightLines.push(`\u2708\uFE0F ${nameStr} from ${origin}: check Google Flights for prices`);
      }
    }
  }

  // Store estimates on session
  await admin.from('trip_sessions').update({
    cost_estimates: flightLines,
    updated_at: new Date().toISOString(),
  }).eq('id', session.id);

  // Chain to COMMIT_POLL
  const { data: est } = await admin.from('trip_sessions').select('*').eq('id', session.id).single();
  if (!est) return null;
  await transitionPhase(admin, est, 'COMMIT_POLL', triggerUserId, triggerMessageSid);

  const { data: commitSession } = await admin.from('trip_sessions').select('*').eq('id', session.id).single();
  if (!commitSession) return null;
  const commitMsg = await launchCommitPoll(admin, commitSession, participants);

  let costNote: string;
  if (flightLines.length > 0) {
    costNote = `Here's what flights look like:\n\n${flightLines.join('\n')}\n\nThese are today's prices \u2014 I'll track them weekly and let you know if things shift.`;
  } else {
    costNote = `Couldn't pull live prices right now \u2014 check Google Flights for ${destination}. I'll keep trying.`;
  }

  return commitMsg ? costNote + '\n\n' + commitMsg : costNote;
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

  // #55 — Urgency note if trip is within 7 days
  const urgency = getUrgencyNote(session);

  return summary + '\n\nMoving to lodging \u2014 how are we handling it?\n\n1. Staying together (group rental)\n2. Booking separately\n3. Flights only (skip lodging)' + (urgency ? '\n\n' + urgency : '');
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

  // #55 — Urgency note if trip is within 7 days
  const urgency = getUrgencyNote(session);

  if (lodgingType === 'GROUP') {
    await transitionPhase(admin, session, 'AWAITING_GROUP_BOOKING', triggerUserId, triggerMessageSid);
    const planner = participants.find((p) => p.is_planner);
    const msg = `Group rental it is! ${planner?.display_name ?? 'Planner'} \u2014 book when you're ready and text "Booked [property] for $[total]" when it's done.`;
    return urgency ? msg + '\n\n' + urgency : msg;
  }

  if (lodgingType === 'INDIVIDUAL') {
    await transitionPhase(admin, session, 'AWAITING_INDIVIDUAL_LODGING', triggerUserId, triggerMessageSid);
    const msg = 'Everyone booking their own \u2014 text BOOKED when you\'ve sorted yours.';
    return urgency ? msg + '\n\n' + urgency : msg;
  }

  // Flights only
  await transitionPhase(admin, session, 'AWAITING_INDIVIDUAL_FLIGHTS', triggerUserId, triggerMessageSid);
  const msg = 'Flights only \u2014 text BOOKED when you\'ve got yours sorted.';
  return urgency ? msg + '\n\n' + urgency : msg;
}

// ─── #55 Helper: urgency note for trips starting within 7 days ──────────────

function getUrgencyNote(session: TripSession): string | null {
  const dates = session.dates as { start?: string } | null;
  if (!dates?.start) return null;
  const daysUntil = Math.round(
    (new Date(dates.start).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );
  if (daysUntil > 0 && daysUntil <= 7) {
    return `Trip is in ${daysUntil} day${daysUntil === 1 ? '' : 's'} \u2014 time to lock this in.`;
  }
  return null;
}

/**
 * Check if the current phase is ready to advance based on collected data.
 * Called after every message to see if we should auto-advance.
 *
 * Note: For poll phases (DECIDING_DESTINATION, DECIDING_DATES, BUDGET_POLL,
 * DECIDING_LODGING_TYPE), timeouts are handled by NudgeScheduler which sends
 * 24h/48h nudges and auto-closes polls after 48h with available votes.
 *
 * For non-poll collection phases (INTRO, COLLECTING_ORIGINS, AWAITING_FLIGHTS),
 * there is currently no automatic timeout for silent participants.
 * TODO: Add 48h auto-close for non-poll collection phases — after 48h with no
 * new responses, advance with whoever has responded (similar to poll nudge logic).
 */
export async function checkAutoAdvance(
  admin: SupabaseClient,
  session: TripSession,
): Promise<string | null> {
  // Reload to get fresh phase
  const { data: fresh } = await admin
    .from('trip_sessions')
    .select('*')
    .eq('id', session.id)
    .single();
  if (!fresh) return null;
  session = fresh;

  const phase = session.phase;
  const participants = await getParticipants(admin, session.id);
  const active = participants.filter((p) => p.status === 'active');

  switch (phase) {
    // INTRO: no auto-advance — waits for YES/"that's everyone" confirmation
    // (handled in message-router.ts INTRO handler)

    case 'COLLECTING_DESTINATIONS': {
      // Auto-advance when all participants have suggested a destination
      const candidates = ((session as Record<string, unknown>).destination_candidates as Array<{ label: string }>) ?? [];
      const allContributed = active.every((p) => p.display_name);
      if (candidates.length > 0 && allContributed && active.length >= 2) {
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
